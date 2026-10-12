import type { Job } from '@prisma/client';
import { db } from './db';
import { type Tx, orderLock, createCharge, syncPayment, enqueue } from './orders';
import { grantReader, drive, sendMail, validateDrive } from './providers';
import { SafeError } from './security';
import { canDeliver } from './payment-policy';
export async function itemLock(tx:Tx,id:string){await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`drive:${id}`},0))`;}
export const driveLink=(type:string,id:string)=>type==='bundle'?`https://drive.google.com/drive/folders/${id}`:`https://drive.google.com/file/d/${id}/view`;
async function revokeItem(tx:Tx,orderId:string,driveId:string,email:string){
  await itemLock(tx,driveId);
  const other=await tx.orderItem.count({where:{driveId,deliveredTo:email,orderId:{not:orderId},order:{paymentStatus:'approved'}}});
  if(other)return 'Mantida: outra compra válida depende do acesso.';
  const grant=await tx.grant.findUnique({where:{driveId_email:{driveId,email}}});
  if(!grant?.owned)return 'Acesso anterior ou de origem incerta preservado; revise manualmente no Google Drive.';
  // Listing makes a retry after a successful delete safe (including process crash).
  const {permissions}=await import('./providers');
  if((await permissions(driveId)).some(p=>p.id===grant.permissionId))await drive(`/files/${driveId}/permissions/${grant.permissionId}?supportsAllDrives=true`,{method:'DELETE'});
  await tx.grant.delete({where:{id:grant.id}});return 'Permissão criada pela loja revogada.';
}
export async function processJob(tx:Tx,job:Job){
  const o=await tx.order.findUniqueOrThrow({where:{id:job.orderId},include:{items:true}});
  if(job.kind==='charge'){await createCharge(tx,o.id);return;}
  if(job.kind==='correct-email'){
    if(o.paymentStatus!=='approved')throw new SafeError('Correção disponível apenas para pagamento aprovado.');
    const payload=job.payload as {email:string;oldEmail:string};
    for(const item of [...o.items].sort((a,b)=>a.driveId.localeCompare(b.driveId))){
      if(item.deliveredTo){const note=await revokeItem(tx,o.id,item.driveId,item.deliveredTo);await tx.attempt.create({data:{orderId:o.id,kind:'correction-revoke',success:true,message:note}});}
      await tx.orderItem.update({where:{id:item.id},data:{permissionId:null,deliveredTo:null,deliveredAt:null}});
    }
    const changed=await tx.order.update({where:{id:o.id},data:{email:payload.email,emailVersion:{increment:1},emailCorrectionPending:false,deliveryEmailId:null,deliveryStatus:'pending'}});
    await enqueue(tx,o.id,'deliver',`corrected-delivery:${o.id}:${changed.emailVersion}`);return;
  }
  if(job.kind==='revoke'){
    for(const item of [...o.items].sort((a,b)=>a.driveId.localeCompare(b.driveId)))if(item.deliveredTo){const note=await revokeItem(tx,o.id,item.driveId,item.deliveredTo);await tx.attempt.create({data:{orderId:o.id,kind:'refund-revoke',success:true,message:note}});}
    await tx.order.update({where:{id:o.id},data:{deliveryStatus:'revoked'}});return;
  }
  if(!canDeliver(o.paymentStatus,o.emailCorrectionPending)){if(o.emailCorrectionPending)throw new SafeError('Aguardando correção do e-mail.');return;}
  if(job.kind==='confirmation'){
    if(!o.confirmationEmailId){const result=await sendMail(o.email,'Pagamento confirmado',`Olá, ${o.name}.\nO pagamento do pedido ${o.id} foi confirmado. Estamos preparando o acesso aos seus produtos.\nConta Google autorizada: ${o.email}.`,`confirmation-${o.id}`);await tx.order.update({where:{id:o.id},data:{confirmationEmailId:result.id}});}return;
  }
  if(job.kind==='deliver'){
    for(const item of [...o.items].sort((a,b)=>a.driveId.localeCompare(b.driveId))){
      if(item.deliveredAt&&item.deliveredTo===o.email)continue;
      await itemLock(tx,item.driveId);await validateDrive(item.driveId,item.type);
      let grant=await tx.grant.findUnique({where:{driveId_email:{driveId:item.driveId,email:o.email}}});
      const actual=await grantReader(item.driveId,o.email);
      grant=await tx.grant.upsert({where:{driveId_email:{driveId:item.driveId,email:o.email}},create:{driveId:item.driveId,email:o.email,...actual},update:{permissionId:actual.permissionId,owned:grant?.permissionId===actual.permissionId?grant.owned:actual.owned}});
      await tx.orderItem.update({where:{id:item.id},data:{permissionId:grant.permissionId,deliveredTo:o.email,deliveredAt:new Date()}});
      // Commit each item independently to preserve progress on large orders.
      if(o.items.some(i=>i.id!==item.id&&(!i.deliveredAt||i.deliveredTo!==o.email))){
        await enqueue(tx,o.id,'deliver',`deliver-item:${o.id}:${o.emailVersion}:${item.id}`);return;
      }
    }
    await tx.order.update({where:{id:o.id},data:{deliveryStatus:'email_pending'}});
    await enqueue(tx,o.id,'delivery-email',`delivery-email:${o.id}:${o.emailVersion}`);return;
  }
  if(job.kind==='delivery-email'||job.kind==='resend'){
    if(o.items.some(i=>!i.deliveredAt||i.deliveredTo!==o.email))throw new SafeError('Aguardando liberação dos arquivos.');
    if(job.kind==='delivery-email'&&o.deliveryEmailId)return;
    const result=await sendMail(o.email,'Seus sons estão prontos',`Olá, ${o.name}.\n\nAbra o Google Drive com a Conta Google ${o.email}.\n\n${o.items.map(i=>`${i.name}\n${driveLink(i.type,i.driveId)}\nConteúdo: ${i.contents}\nCondições: ${i.license}`).join('\n\n')}\n\nNão funciona com outra conta conectada.`,job.key);
    await tx.order.update({where:{id:o.id},data:{deliveryStatus:'delivered',deliveryEmailId:result.id}});
  }
}
export async function runOne(){
  return db.$transaction(async tx=>{
    const jobs=await tx.$queryRaw<Job[]>`SELECT * FROM "Job" WHERE "status"='pending' AND "runAt"<=NOW() ORDER BY "runAt" ASC FOR UPDATE SKIP LOCKED LIMIT 1`;
    if(!jobs.length)return false;const job=jobs[0];await orderLock(tx,job.orderId);
    try{await processJob(tx,job);await tx.job.update({where:{id:job.id},data:{status:'done',attempts:{increment:1}}});await tx.attempt.create({data:{orderId:job.orderId,kind:job.kind,success:true,message:job.kind.includes('email')||job.kind==='confirmation'?'Envio aceito pelo serviço de e-mail.':'Etapa concluída.'}});}
    catch(e){const attempts=job.attempts+1;await tx.job.update({where:{id:job.id},data:{attempts,status:attempts>=8?'failed':'pending',runAt:new Date(Date.now()+Math.min(6*60*60*1000,60000*2**attempts))}});await tx.attempt.create({data:{orderId:job.orderId,kind:job.kind,success:false,message:e instanceof SafeError?e.message:'Falha interna. Verifique o serviço e tente novamente pelo painel.'}});}
    return true;
  },{timeout:120000,maxWait:10000});
}
export async function reconcile(){
  // Rotation by updatedAt prevents a permanently pending first page starving later orders.
  const orders=await db.order.findMany({where:{paymentId:{not:null},OR:[{paymentStatus:{in:['pending','approved']}},{updatedAt:{gt:new Date(Date.now()-7*86400000)}}]},orderBy:{updatedAt:'asc'},take:100});
  for(const o of orders){try{await syncPayment(o.paymentId!);}catch(e){await db.attempt.create({data:{orderId:o.id,kind:'reconcile',success:false,message:e instanceof SafeError?e.message:'Reconciliação temporariamente indisponível.'}});}finally{await db.order.update({where:{id:o.id},data:{updatedAt:new Date()}});}}
}

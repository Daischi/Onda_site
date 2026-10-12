import type { Prisma } from '@prisma/client';
import { db } from './db';
import { checkoutSchema } from './validation';
import { config, mp, type MPConfig, type Payment } from './providers';
import { digest, SafeError, encrypt, decrypt } from './security';
import { paymentMatches, paymentState } from './payment-policy';
export type Tx=Prisma.TransactionClient;
export async function orderLock(tx:Tx,id:string){await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`order:${id}`},0))`;}
export async function enqueue(tx:Tx,orderId:string,kind:string,key:string,payload?:Prisma.InputJsonValue){return tx.job.upsert({where:{key},create:{key,orderId,kind,payload},update:{}});}
export async function createOrder(raw:unknown){
  const input=checkoutSchema.parse(raw);const hash=digest(input.token);
  const existing=await db.order.findUnique({where:{checkoutKey:input.key}});if(existing){if(existing.tokenHash!==hash)throw new SafeError('Chave de checkout já utilizada.',409);return existing;}
  const ready=await db.integration.count({where:{id:{in:['pix','drive','email']},status:'working'}});
  const settings=await db.settings.findUnique({where:{id:'store'}});const worker=await db.heartbeat.findUnique({where:{id:'worker'}});
  if(ready!==3||!settings?.support||settings.terms.length<20||settings.privacy.length<20||settings.usage.length<20||!worker||Date.now()-+worker.at>120000)throw new SafeError('A loja está em preparação. Tente novamente mais tarde.',503);
  const c=await config<MPConfig>('pix');if(c.mode==='production'&&process.env.ALLOW_LIVE_PAYMENTS!=='true')throw new SafeError('Pagamentos reais ainda não foram habilitados pelo desenvolvedor.',503);
  return db.$transaction(async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`checkout:${input.key}`},0))`;
    const duplicate=await tx.order.findUnique({where:{checkoutKey:input.key}});if(duplicate){if(duplicate.tokenHash!==hash)throw new SafeError('Chave de checkout já utilizada.',409);return duplicate;}
    const products=await tx.product.findMany({where:{id:{in:input.ids},status:'published',validatedAt:{not:null}}});
    if(products.length!==input.ids.length)throw new SafeError('Um produto não está disponível. Atualize o carrinho.');
    const order=await tx.order.create({data:{checkoutKey:input.key,tokenHash:hash,name:input.name,email:input.email,payerDocumentEncrypted:encrypt({cpf:input.cpf}),total:products.reduce((s,p)=>s+p.price,0),collectorId:c.collectorId,liveMode:c.mode==='production',expiresAt:new Date(Date.now()+24*60*60*1000),items:{create:products.map(p=>({productId:p.id,name:p.name,price:p.price,driveId:p.driveId,type:p.type,license:p.license,contents:p.contents}))}}});
    await enqueue(tx,order.id,'charge',`charge:${order.id}`);return order;
  });
}
export async function createCharge(tx:Tx,orderId:string){
  const o=await tx.order.findUniqueOrThrow({where:{id:orderId}});if(o.paymentId)return;
  const c=await config<MPConfig>('pix');if(c.collectorId!==o.collectorId||(c.mode==='production')!==o.liveMode)throw new SafeError('A configuração PIX mudou. Restaure a conta original para reconciliar este pedido.');
  if(o.liveMode&&process.env.ALLOW_LIVE_PAYMENTS!=='true')throw new SafeError('Cobranças reais desabilitadas.');
  if(!o.payerDocumentEncrypted)throw new SafeError('Documento do pagador indisponível. Procure o suporte.');
  const document=decrypt<{cpf:string}>(o.payerDocumentEncrypted);
  const p=await mp<Payment>('/v1/payments',{method:'POST',headers:{'X-Idempotency-Key':o.checkoutKey},body:JSON.stringify({transaction_amount:o.total/100,description:`Pedido ${o.id}`,payment_method_id:'pix',external_reference:o.id,date_of_expiration:o.expiresAt!.toISOString(),notification_url:`${process.env.APP_URL}/api/webhooks/mercadopago`,payer:{email:o.email,first_name:o.name.split(' ')[0],last_name:o.name.split(' ').slice(1).join(' ')||o.name,identification:{type:'CPF',number:document.cpf}}})});
  if(!paymentMatches(p,o))throw new SafeError('A cobrança retornada não corresponde ao pedido.');
  await tx.order.update({where:{id:o.id},data:{paymentId:String(p.id),payerDocumentEncrypted:null,pix:p.point_of_interaction?.transaction_data?.qr_code,qr:p.point_of_interaction?.transaction_data?.qr_code_base64}});
  await applyPayment(tx,p);
}
export async function applyPayment(tx:Tx,p:Payment){
  const o=await tx.order.findUnique({where:{id:p.external_reference}});if(!o)return;
  if(!paymentMatches(p,o))throw new SafeError('Pagamento com referência, valor, moeda ou recebedor incompatível.',409);
  const updated=new Date(p.date_last_updated);if(!Number.isFinite(+updated))throw new SafeError('Data do pagamento inválida.');
  if(o.paymentUpdatedAt&&+updated<+o.paymentUpdatedAt)return;
  const status=paymentState(p);
  // Never regress an accepted or refunded payment to pending on delayed events.
  if(o.paymentStatus==='refunded'||(o.paymentStatus==='approved'&&status==='pending'))return;
  await tx.order.update({where:{id:o.id},data:{paymentId:String(p.id),payerDocumentEncrypted:null,paymentStatus:status,paymentUpdatedAt:updated,pix:p.point_of_interaction?.transaction_data?.qr_code??o.pix,qr:p.point_of_interaction?.transaction_data?.qr_code_base64??o.qr}});
  if(status==='approved'){
    await enqueue(tx,o.id,'confirmation',`confirmation:${o.id}`);
    await enqueue(tx,o.id,'deliver',`deliver:${o.id}`);
  }
  if(status==='refunded')await enqueue(tx,o.id,'revoke',`refund:${o.id}`);
}
export async function syncPayment(id:string){
  const p=await mp<Payment>(`/v1/payments/${encodeURIComponent(id)}`);if(!p.external_reference)return;
  await db.$transaction(async tx=>{await orderLock(tx,p.external_reference);await applyPayment(tx,p);},{timeout:30000});
}

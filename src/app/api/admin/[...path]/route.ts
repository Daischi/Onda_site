import { NextResponse } from 'next/server';
import { z, ZodError } from 'zod';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { productSchema, settingsSchema, mpSchema, mailSchema, email } from '@/lib/validation';
import { config, saveIntegration, testIntegration, validateDrive, googleOAuth, type DriveConfig } from '@/lib/providers';
import { SafeError, sameOrigin, mediaAllowed, digest, limit } from '@/lib/security';
import { enqueue, orderLock } from '@/lib/orders';
import { googleOAuthReady } from '@/lib/drive-oauth';
type Context={params:Promise<{path:string[]}>};
function failure(e:unknown){return NextResponse.json({error:e instanceof SafeError?e.message:e instanceof ZodError?e.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; '):'Não foi possível concluir. Confira os dados e a disponibilidade dos serviços.'},{status:e instanceof SafeError?e.status:400});}
export async function GET(req:Request,{params}:Context){try{
  await requireAdmin();const {path}=await params;
  if(path[0]==='data'){
    const [products,categories,integrations,settings,orders,heartbeat,revenue,paid,pending]=await Promise.all([
      db.product.findMany({include:{category:true},orderBy:{createdAt:'desc'}}),db.category.findMany({orderBy:{position:'asc'}}),db.integration.findMany({select:{id:true,status:true,checkedAt:true,message:true}}),db.settings.findUnique({where:{id:'store'}}),db.order.findMany({orderBy:{createdAt:'desc'},take:100,select:{id:true,name:true,email:true,total:true,paymentStatus:true,deliveryStatus:true,createdAt:true,liveMode:true}}),db.heartbeat.findUnique({where:{id:'worker'}}),db.order.aggregate({where:{paymentStatus:'approved',liveMode:true},_sum:{total:true}}),db.order.count({where:{paymentStatus:'approved',liveMode:true}}),db.order.count({where:{paymentStatus:'approved',deliveryStatus:{not:'delivered'}}})]);
    return NextResponse.json({products,categories,integrations,settings,orders,workerOnline:!!heartbeat&&Date.now()-+heartbeat.at<120000,revenue:revenue._sum.total||0,paid,pending,developerReady:{google:googleOAuthReady(),googleCallbackUrl:`${process.env.APP_URL||'http://localhost:3000'}/api/drive/callback`,encryption:!!process.env.ENCRYPTION_KEY,live:process.env.ALLOW_LIVE_PAYMENTS==='true',https:process.env.APP_URL?.startsWith('https://')}},{headers:{'Cache-Control':'no-store'}});
  }
  if(path[0]==='orders'&&!path[1]){const params=new URL(req.url).searchParams;const search=(params.get('q')||'').trim().slice(0,150);const status=params.get('status')||'all';const page=Math.min(10000,Math.max(0,Number(params.get('page')||0)||0));const where={...(status==='all'?{}:{paymentStatus:z.enum(['pending','approved','cancelled','expired','refunded']).parse(status)}),...(search?{OR:[{name:{contains:search,mode:'insensitive' as const}},{email:{contains:search,mode:'insensitive' as const}},{id:{contains:search,mode:'insensitive' as const}}]}:{})};const [orders,total]=await Promise.all([db.order.findMany({where,orderBy:{createdAt:'desc'},skip:page*50,take:50,select:{id:true,name:true,email:true,total:true,paymentStatus:true,deliveryStatus:true,createdAt:true,liveMode:true}}),db.order.count({where})]);return NextResponse.json({orders,total,page,pageSize:50},{headers:{'Cache-Control':'no-store'}});}
  if(path[0]==='orders'&&path[1]){const o=await db.order.findUniqueOrThrow({where:{id:path[1]},include:{items:true,attempts:{orderBy:{createdAt:'desc'},take:100},jobs:{select:{id:true,kind:true,status:true,attempts:true,runAt:true}}}});const {tokenHash,checkoutKey,payerDocumentEncrypted,...safe}=o;void tokenHash;void checkoutKey;void payerDocumentEncrypted;return NextResponse.json(safe,{headers:{'Cache-Control':'no-store'}});}
  throw new SafeError('Não encontrado.',404);
}catch(e){return failure(e);}}
export async function POST(req:Request,{params}:Context){try{
  sameOrigin(req);const admin=await requireAdmin();await limit(`admin:${admin.id}`,100,60);
  if(Number(req.headers.get('content-length')||0)>100000)throw new SafeError('Solicitação muito grande.',413);
  const {path}=await params;const raw=await req.text();if(raw.length>100000)throw new SafeError('Solicitação muito grande.',413);const b=JSON.parse(raw);
  if(path[0]==='products'){
    const p=productSchema.parse(b);mediaAllowed(p.cover);mediaAllowed(p.preview);
    if(p.preview&&p.preview===p.cover)throw new SafeError('Informe a URL de uma prévia de áudio separada.');
    const {id,...data}=p;const previous=id?await db.product.findUniqueOrThrow({where:{id}}):null;
    let validatedAt=previous?.driveId===p.driveId&&previous?.type===p.type?previous.validatedAt:null;
    if(p.status==='published'){await validateDrive(p.driveId,p.type);validatedAt=new Date();if(!p.cover||!p.preview)throw new SafeError('Inclua uma capa e uma prévia pública antes de publicar.');}
    const result=id?await db.product.update({where:{id},data:{...data,validatedAt}}):await db.product.create({data:{...data,validatedAt}});return NextResponse.json({id:result.id,message:'Produto salvo.'});
  }
  if(path[0]==='validate-product'){const b2=z.object({driveId:z.string().regex(/^[\w-]{10,200}$/),type:z.enum(['track','bundle'])}).parse(b);const result=await validateDrive(b2.driveId,b2.type);return NextResponse.json({message:`${result.name}: acessível, restrito e compartilhável. A publicação repete esta verificação.`});}
  if(path[0]==='categories'){const c=z.object({id:z.string().optional(),name:z.string().trim().min(2).max(80),position:z.number().int().min(0).max(10000)}).parse(b);const {id,...data}=c;if(id)await db.category.update({where:{id},data});else await db.category.create({data});return NextResponse.json({message:'Categoria salva.'});}
  if(path[0]==='settings'){const s=settingsSchema.parse(b);mediaAllowed(s.logo);mediaAllowed(s.banner);await db.settings.upsert({where:{id:'store'},create:{id:'store',...s},update:s});await db.integration.updateMany({where:{id:'email'},data:{status:'saved',message:'Dados alterados. Teste o envio novamente.'}});return NextResponse.json({message:'Dados da loja salvos.'});}
  if(path[0]==='integrations'){
    const id=path[1];if(path[2]==='test')return NextResponse.json({message:await testIntegration(id)});
    if(id==='pix'){
      const c=mpSchema.parse(b);if(await db.order.count({where:{paymentStatus:{in:['pending','approved']}}}))throw new SafeError('Há pedidos ativos. A troca da credencial PIX exige manutenção pelo desenvolvedor para preservar reconciliação e reembolsos.');
      await saveIntegration(id,c);
    }else if(id==='email')await saveIntegration(id,mailSchema.parse(b));
    else if(id==='drive'){
      const c=await config<DriveConfig>('drive');
      if(path[2]==='disconnect'){const oauth=googleOAuth();oauth.setCredentials(c.tokens);await oauth.revokeCredentials();await db.integration.delete({where:{id:'drive'}});await db.product.updateMany({data:{validatedAt:null,status:'draft'}});return NextResponse.json({message:'Google Drive desconectado; produtos voltaram para rascunho.'});}
      const rootId=z.string().regex(/^[\w-]{10,200}$/).parse(b.rootId);await saveIntegration(id,{...c,rootId});await db.product.updateMany({data:{validatedAt:null,status:'draft'}});
    }else throw new SafeError('Integração inválida.');return NextResponse.json({message:'Credencial salva e protegida. Execute o teste.'});
  }
  if(path[0]==='orders'&&path[1]){
    await db.$transaction(async tx=>{
      await orderLock(tx,path[1]);const o=await tx.order.findUniqueOrThrow({where:{id:path[1]},include:{items:true}});if(o.paymentStatus!=='approved')throw new SafeError('Esta ação exige pagamento confirmado.');
      const action=z.enum(['retry','resend','correct-email']).parse(b.action);
      if(action==='correct-email'){
        const address=email.parse(b.email);if(b.confirm!=='REVOGAR E REENVIAR')throw new SafeError('Digite REVOGAR E REENVIAR para confirmar.');if(o.emailCorrectionPending||address===o.email)throw new SafeError('Correção já pendente ou e-mail sem alteração.');
        await tx.order.update({where:{id:o.id},data:{emailCorrectionPending:true,deliveryStatus:'correction_pending'}});
        await enqueue(tx,o.id,'correct-email',`correction:${o.id}:${crypto.randomUUID()}`,{email:address,oldEmail:o.email});
        await tx.audit.create({data:{actorId:admin.id,action,targetId:o.id,detail:`Email anterior SHA256 ${digest(o.email)}; novo SHA256 ${digest(address)}. Revogar permissões exclusivas criadas pela loja e entregar novamente.`}});
      }else if(action==='resend'){
        if(o.emailCorrectionPending||o.items.some(i=>!i.deliveredAt))throw new SafeError('Conclua a entrega antes de reenviar o e-mail.');
        await enqueue(tx,o.id,'resend',`resend:${o.id}:${crypto.randomUUID()}`);
      }else{
        await tx.job.updateMany({where:{orderId:o.id,status:'failed'},data:{status:'pending',attempts:0,runAt:new Date()}});
        if(!o.emailCorrectionPending)await enqueue(tx,o.id,'deliver',`retry:${o.id}:${crypto.randomUUID()}`);
      }
      if(action!=='correct-email')await tx.audit.create({data:{actorId:admin.id,action,targetId:o.id,detail:'Ação manual enfileirada; nenhuma cobrança criada.'}});
    });return NextResponse.json({message:'Ação registrada. O worker continuará o processamento.'});
  }
  throw new SafeError('Ação não encontrada.',404);
}catch(e){return failure(e);}}

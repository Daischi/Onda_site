import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { readFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import { hashPassword } from 'better-auth/crypto';
import type { Payment } from '../../src/lib/providers';
let db:typeof import('../../src/lib/db').db;
let encrypt:typeof import('../../src/lib/security').encrypt;
let createOrder:typeof import('../../src/lib/orders').createOrder;
let createCharge:typeof import('../../src/lib/orders').createCharge;
let applyPayment:typeof import('../../src/lib/orders').applyPayment;
let orderLock:typeof import('../../src/lib/orders').orderLock;
let runOne:typeof import('../../src/lib/delivery').runOne;
let validateDrive:typeof import('../../src/lib/providers').validateDrive;
let cluster:EmbeddedPostgres;let started=false;let app:ChildProcess;let base='';let cookie='';let orderId='';
let failDrive=false,failEmail=false,grantCount=0,emailCount=0;const grants=new Map<string,{id:string;type:string;role:string;emailAddress:string}[]>();
let chargeCalls=0;
const nativeFetch=globalThis.fetch;
const rootId='root1234567890',fileId='file1234567890',folderId='folder1234567890';
const token=randomBytes(32).toString('hex');
const credentials={email:'admin@example.test',password:randomBytes(24).toString('base64url')};
async function freePort(){const s=createServer();await new Promise<void>(r=>s.listen(0,'127.0.0.1',r));const p=(s.address() as {port:number}).port;await new Promise<void>(r=>s.close(()=>r()));return p;}
before(async()=>{try{
  const port=await freePort();process.env.DATABASE_URL=`postgresql://postgres:test-local-only@127.0.0.1:${port}/postgres`;process.env.ENCRYPTION_KEY=randomBytes(32).toString('base64');process.env.BETTER_AUTH_SECRET=randomBytes(40).toString('base64');process.env.GOOGLE_CLIENT_ID='test';process.env.GOOGLE_CLIENT_SECRET='test';process.env.MEDIA_HOSTS='media.example.test';process.env.ALLOW_LIVE_PAYMENTS='false';
  ({db}=await import('../../src/lib/db'));({encrypt}=await import('../../src/lib/security'));({createOrder,createCharge,applyPayment,orderLock}=await import('../../src/lib/orders'));({runOne}=await import('../../src/lib/delivery'));({validateDrive}=await import('../../src/lib/providers'));
  const dir=path.resolve('work',`test-db-${Date.now()}`);await mkdir(path.dirname(dir),{recursive:true});
  cluster=new EmbeddedPostgres({databaseDir:dir,port,user:'postgres',password:'test-local-only',persistent:true,onLog:()=>{},onError:()=>{},postgresFlags:['-h','127.0.0.1'],initdbFlags:['--encoding=UTF8','--locale=C']});await cluster.initialise();await cluster.start();started=true;
  const client=cluster.getPgClient();await client.connect();for(const folder of (await readdir('prisma/migrations',{withFileTypes:true})).filter(entry=>entry.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name)))await client.query(await readFile(`prisma/migrations/${folder.name}/migration.sql`,'utf8'));await client.end();
  await db.settings.create({data:{id:'store',support:'support@example.test',senderEmail:'hello@example.test',terms:'Condições de compra para teste isolado.',privacy:'Política de privacidade para teste isolado.',usage:'Condições de uso para teste isolado.'}});
  await db.heartbeat.create({data:{id:'worker'}});
  await db.integration.createMany({data:[{id:'pix',status:'working',encrypted:encrypt({token:'TEST-test-token',collectorId:'123',mode:'test',webhookSecret:'test-webhook-secret'})},{id:'email',status:'working',encrypted:encrypt({apiKey:'re_test'})},{id:'drive',status:'working',encrypted:encrypt({rootId,tokens:{access_token:'test-access',refresh_token:'test-refresh',expiry_date:Date.now()+3600000}})}]});
  const shared={description:'Descrição para teste automatizado',price:1990,cover:'https://media.example.test/cover.jpg',preview:'https://media.example.test/preview.mp3',formats:'WAV',contents:'Conteúdo de teste',license:'Licença de teste isolado',status:'published',validatedAt:new Date()};
  await db.product.createMany({data:[{...shared,id:'track1',name:'Faixa de teste',type:'track',driveId:fileId},{...shared,id:'bundle1',name:'Pacote de teste',type:'bundle',driveId:folderId}]});
  await db.user.create({data:{id:'admin-test',name:'Teste',email:credentials.email,username:'teste_admin',role:'admin',emailVerified:true,accounts:{create:{id:'account-test',accountId:'admin-test',providerId:'credential',password:await hashPassword(credentials.password)}}}});
  globalThis.fetch=async(input,init)=>{
    const url=String(input);if(url.startsWith('http://127.0.0.1'))return nativeFetch(input,init);
    if(url==='https://api.mercadopago.com/v1/payments'){
      const body=JSON.parse(init?.body as string);chargeCalls++;assert.equal(body.payment_method_id,'pix');assert.equal(body.payer.identification.type,'CPF');assert.equal(body.payer.identification.number,'52998224725');assert.ok(new Date(body.date_of_expiration).getTime()-Date.now()>30*60000);assert.ok(new Headers(init?.headers).get('X-Idempotency-Key'));
      return Response.json({id:'98766',status:'pending',transaction_amount:body.transaction_amount,currency_id:'BRL',collector_id:123,external_reference:body.external_reference,live_mode:false,date_last_updated:new Date().toISOString(),point_of_interaction:{transaction_data:{qr_code:'test-qr-not-payable',qr_code_base64:'test-only'}}});
    }
    if(url.startsWith('https://www.googleapis.com/drive/v3/')){
      if(failDrive)return Response.json({error:'quota'},{status:429});
      const id=url.match(/\/files\/([^/?]+)/)?.[1]||'';
      if(url.includes('/permissions')){
        if(init?.method==='POST'){const body=JSON.parse(init.body as string);assert.equal(body.role,'reader');assert.equal(body.type,'user');assert.notEqual(id,rootId);grantCount++;const p={id:`perm-${grantCount}`,type:'user',role:'reader',emailAddress:body.emailAddress};grants.set(id,[...(grants.get(id)||[]),p]);return Response.json({id:p.id});}
        if(init?.method==='DELETE'){const pid=url.match(/\/permissions\/([^?]+)/)?.[1];grants.set(id,(grants.get(id)||[]).filter(p=>p.id!==pid));return new Response(null,{status:204});}
        return Response.json({permissions:grants.get(id)||[]});
      }
      return Response.json({id,name:'Test item',mimeType:id===folderId||id===rootId?'application/vnd.google-apps.folder':'audio/mpeg',trashed:false,parents:[rootId],capabilities:{canShare:true}});
    }
    if(url==='https://api.resend.com/emails'){if(failEmail)return Response.json({error:'down'},{status:503});emailCount++;return Response.json({id:`email-${emailCount}`});}
    throw new Error(`Unexpected provider request to ${new URL(url).hostname}`);
  };
  const appPort=await freePort();base=`http://127.0.0.1:${appPort}`;process.env.APP_URL=base;process.env.BETTER_AUTH_URL=base;
  app=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p',String(appPort),'-H','127.0.0.1'],{env:{...process.env,NODE_ENV:'production'},stdio:'pipe',windowsHide:true});
  let ready=false;for(let i=0;i<120;i++){try{const r=await nativeFetch(base+'/login');if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}if(!ready)throw new Error('Next server did not start');
}catch(e){console.error('Isolated test setup failed:',e);throw e;}},{timeout:120000});
after(async()=>{globalThis.fetch=nativeFetch;if(app?.pid){try{execFileSync('taskkill',['/pid',String(app.pid),'/t','/f'],{windowsHide:true,stdio:'ignore'});}catch{}app.stdout?.destroy();app.stderr?.destroy();app.unref();}await Promise.race([db.$disconnect(),new Promise(r=>setTimeout(r,1000))]);if(started){const internal=cluster as unknown as {process?:ChildProcess};const proc=internal.process;if(proc?.pid){try{execFileSync('taskkill',['/pid',String(proc.pid),'/t','/f'],{windowsHide:true,stdio:'ignore'});}catch{}}await Promise.race([cluster.stop(),new Promise(r=>setTimeout(r,1000))]);proc?.stdout?.destroy();proc?.stderr?.destroy();proc?.unref();internal.process=undefined;}console.log('Integration fixtures and server stopped.');},{timeout:10000});
function approved(reference:string):Payment{return {id:'98765',external_reference:reference,status:'approved',transaction_amount:39.8,currency_id:'BRL',collector_id:123,live_mode:false,date_last_updated:new Date().toISOString()};}
async function pump(){for(let i=0;i<20;i++){if(!await runOne())break;}}
test('health confirma conexão com o banco sem autenticação ou exposição de configurações',async()=>{
  const response=await nativeFetch(base+'/api/health');
  assert.equal(response.status,200);
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.deepEqual(await response.json(),{status:'ok'});
});
test('rotas administrativas rejeitam visitante e cadastro público permanece fechado',async()=>{const r=await nativeFetch(base+'/api/admin/data');assert.equal(r.status,401);const create=await nativeFetch(base+'/api/auth/sign-up/email',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({email:'evil@example.test',password:'long-random-test-password',name:'Unauthorized'})});assert.ok(create.status>=400);});
test('admin autentica e cadastra música e pacote em rascunho pelo endpoint do painel',async()=>{
  const login=await nativeFetch(base+'/api/auth/sign-in/email',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify(credentials)});assert.equal(login.status,200);cookie=login.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');assert.ok(cookie);
  const usernameLogin=await nativeFetch(base+'/api/auth/sign-in/username',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({username:'teste_admin',password:credentials.password})});assert.equal(usernameLogin.status,200);const usernameCookie=usernameLogin.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');assert.equal((await nativeFetch(base+'/api/admin/data',{headers:{Cookie:usernameCookie}})).status,200);
  for(const type of ['track','bundle']){const r=await nativeFetch(base+'/api/admin/products',{method:'POST',headers:{'Content-Type':'application/json',Origin:base,Cookie:cookie},body:JSON.stringify({name:`Cadastro ${type}`,description:'Produto criado pelo painel administrativo',price:2990,cover:'',preview:'',type,categoryId:null,featured:false,status:'draft',driveId:type==='track'?fileId:folderId,formats:'WAV',contents:'Arquivos originais',license:'Uso pessoal autorizado.'})});assert.equal(r.status,200,await r.text());}
  assert.equal(await db.product.count(),4);
});
test('checkout usa preços do banco e persiste snapshots; repetição não duplica pedido',async()=>{
  const body={cpf:'52998224725',ids:['track1','bundle1'],name:'Cliente de teste',email:'buyer@example.test',googleAccount:true,acceptTerms:true,key:crypto.randomUUID(),token};
  await assert.rejects(()=>createOrder({...body,total:1}));
  const o=await createOrder(body);orderId=o.id;assert.equal(o.total,3980);assert.equal((await createOrder(body)).id,o.id);assert.equal(await db.order.count(),1);assert.equal(await db.orderItem.count({where:{orderId}}),2);
  // Isolated tests do not create PIX charges. Simulate provider retrieval, not a customer action.
  await db.job.updateMany({where:{orderId,kind:'charge'},data:{status:'done'}});
  const page=await nativeFetch(base+`/api/admin/orders?q=${encodeURIComponent(o.name)}&status=pending&page=0`,{headers:{Cookie:cookie}});assert.equal(page.status,200);const result=await page.json();assert.equal(result.total,1);assert.equal(result.orders[0].id,o.id);assert.equal(result.pageSize,50);
});
test('pedido privado não pode ser lido sem seu token e vínculos pagos ficam ocultos',async()=>{const denied=await nativeFetch(base+`/api/shop/orders/${orderId}`);assert.equal(denied.status,404);const allowed=await nativeFetch(base+`/api/shop/orders/${orderId}`,{headers:{Authorization:`Bearer ${token}`}});assert.equal(allowed.status,200);const body=await allowed.json();assert.ok(body.items.every((i:{link:null})=>i.link===null));assert.ok(!JSON.stringify(body).includes(fileId));});
test('webhook inválido é rejeitado sem entregar ou consultar provedor',async()=>{const r=await nativeFetch(base+'/api/webhooks/mercadopago?data.id=98765',{method:'POST',headers:{'x-signature':'bad','x-request-id':'invalid'}});assert.equal(r.status,401);assert.equal(grantCount,0);});
test('pagamento incompatível é rejeitado; duplicado gera uma única entrega durável',async()=>{
  await assert.rejects(()=>db.$transaction(tx=>applyPayment(tx,{...approved(orderId),transaction_amount:1})));
  await assert.rejects(()=>db.$transaction(tx=>applyPayment(tx,{...approved(orderId),collector_id:999})));
  for(let i=0;i<2;i++)await db.$transaction(async tx=>{await orderLock(tx,orderId);await applyPayment(tx,approved(orderId));});
  assert.equal(await db.job.count({where:{orderId,kind:'deliver'}}),1);assert.equal((await db.order.findUniqueOrThrow({where:{id:orderId}})).paymentStatus,'approved');assert.equal(grantCount,0);
});
test('falha do Drive preserva pagamento, registra tentativa e recupera arquivo e pasta',async()=>{
  failDrive=true;await pump();assert.equal(grantCount,0);assert.equal((await db.order.findUniqueOrThrow({where:{id:orderId}})).paymentStatus,'approved');assert.ok(await db.attempt.count({where:{orderId,success:false}}));
  failDrive=false;failEmail=true;await db.job.updateMany({where:{orderId,status:'pending'},data:{runAt:new Date()}});await pump();assert.equal(grantCount,2);assert.equal(grants.get(fileId)?.length,1);assert.equal(grants.get(folderId)?.length,1);assert.ok(!grants.has(rootId));assert.equal((await db.order.findUniqueOrThrow({where:{id:orderId}})).deliveryStatus,'email_pending');
});
test('falha de e-mail repete apenas o envio; permissões não são duplicadas',async()=>{const before=grantCount;failEmail=false;await db.job.updateMany({where:{orderId,status:'pending'},data:{runAt:new Date()}});await pump();assert.equal(grantCount,before);assert.equal((await db.order.findUniqueOrThrow({where:{id:orderId}})).deliveryStatus,'delivered');const r=await nativeFetch(base+`/api/shop/orders/${orderId}`,{headers:{Authorization:`Bearer ${token}`}});assert.ok((await r.json()).items.every((i:{link:string})=>i.link?.startsWith('https://drive.google.com/')));});
test('evento atrasado não regride pagamento confirmado',async()=>{await db.$transaction(tx=>applyPayment(tx,{...approved(orderId),status:'pending',date_last_updated:new Date(Date.now()-60000).toISOString()}));assert.equal((await db.order.findUniqueOrThrow({where:{id:orderId}})).paymentStatus,'approved');});
test('arquivo e pasta precisam corresponder ao tipo e pasta principal é proibida',async()=>{await validateDrive(fileId,'track');await validateDrive(folderId,'bundle');await assert.rejects(()=>validateDrive(fileId,'bundle'));await assert.rejects(()=>validateDrive(rootId,'bundle'));});
test('correção exige confirmação explícita, é auditada e revoga permissões exclusivas',async()=>{const request=async(confirm:string)=>nativeFetch(base+`/api/admin/orders/${orderId}`,{method:'POST',headers:{'Content-Type':'application/json',Origin:base,Cookie:cookie},body:JSON.stringify({action:'correct-email',email:'newbuyer@example.test',confirm})});assert.equal((await request('')).status,400);assert.equal((await request('REVOGAR E REENVIAR')).status,200);await pump();const o=await db.order.findUniqueOrThrow({where:{id:orderId}});assert.equal(o.email,'newbuyer@example.test');assert.equal(o.deliveryStatus,'delivered');assert.equal(grants.get(fileId)?.[0].emailAddress,o.email);assert.ok(await db.audit.count({where:{targetId:orderId,action:'correct-email'}}));});
test('reembolso impede reentrega e revoga apenas acessos criados pela loja',async()=>{await db.$transaction(tx=>applyPayment(tx,{...approved(orderId),status:'refunded'}));await pump();assert.equal(grants.get(fileId)?.length,0);assert.equal(grants.get(folderId)?.length,0);const r=await nativeFetch(base+`/api/admin/orders/${orderId}`,{method:'POST',headers:{'Content-Type':'application/json',Origin:base,Cookie:cookie},body:JSON.stringify({action:'retry'})});assert.equal(r.status,400);});
test('cobrança envia identificação e vencimento válidos; repetição não cria cobrança extra',async()=>{await db.integration.updateMany({data:{status:'working',message:'Teste isolado.'}});await db.heartbeat.update({where:{id:'worker'},data:{at:new Date()}});const order=await createOrder({cpf:'52998224725',ids:['track1'],name:'Comprador Teste',email:'pix@example.test',googleAccount:true,acceptTerms:true,key:crypto.randomUUID(),token:randomBytes(32).toString('hex')});assert.ok(order.payerDocumentEncrypted&&!order.payerDocumentEncrypted.includes('52998224725'));for(let i=0;i<2;i++)await db.$transaction(async tx=>{await orderLock(tx,order.id);await createCharge(tx,order.id);});assert.equal(chargeCalls,1);const saved=await db.order.findUniqueOrThrow({where:{id:order.id}});assert.equal(saved.pix,'test-qr-not-payable');assert.equal(saved.payerDocumentEncrypted,null);assert.equal(saved.paymentStatus,'pending');assert.equal(await db.job.count({where:{orderId:order.id,kind:'deliver'}}),0);});
test('OAuth Drive usa redirecionamento completo e state de uso único; cancelamento e expiração não alteram a conexão',async()=>{
  const request=(url:string,authenticated=true)=>nativeFetch(base+url,{redirect:'manual',...(authenticated?{headers:{Cookie:cookie}}:{})});
  const denied=await request('/api/drive/connect',false);assert.equal(new URL(denied.headers.get('location')!).pathname,'/login');
  const original=await db.integration.findUniqueOrThrow({where:{id:'drive'}});
  const connect=await request('/api/drive/connect');assert.equal(connect.status,307);assert.equal(connect.headers.get('cache-control'),'no-store');
  const google=new URL(connect.headers.get('location')!);assert.equal(google.hostname,'accounts.google.com');assert.equal(google.searchParams.get('redirect_uri'),base+'/api/drive/callback');assert.equal(google.searchParams.get('client_id'),'test');assert.ok(!google.searchParams.has('client_secret'));assert.equal(google.searchParams.get('access_type'),'offline');
  const state=google.searchParams.get('state')!;assert.match(state,/^[a-f0-9]{64}$/);const identifier='drive:'+createHash('sha256').update(state).digest('hex');assert.equal(await db.verification.count({where:{identifier}}),1);
  const cancel=await request('/api/drive/callback?'+new URLSearchParams({state,error:'access_denied'}));assert.equal(new URL(cancel.headers.get('location')!).searchParams.get('driveError'),'cancelled');assert.equal(await db.verification.count({where:{identifier}}),0);
  const reused=await request('/api/drive/callback?'+new URLSearchParams({state,code:'never-exchange-this'}));assert.equal(new URL(reused.headers.get('location')!).searchParams.get('driveError'),'state_invalid');
  const expired=randomBytes(32).toString('hex');await db.verification.create({data:{id:crypto.randomUUID(),identifier:'drive:'+createHash('sha256').update(expired).digest('hex'),value:'admin-test',expiresAt:new Date(Date.now()-1000)}});
  const stale=await request('/api/drive/callback?'+new URLSearchParams({state:expired,code:'never-exchange-this'}));assert.equal(new URL(stale.headers.get('location')!).searchParams.get('driveError'),'state_invalid');
  const current=await db.integration.findUniqueOrThrow({where:{id:'drive'}});assert.equal(current.encrypted,original.encrypted);assert.equal(current.status,original.status);
});
test('OAuth não configurado informa o motivo no painel sem tentar abrir autorização nem criar state',async()=>{
  const port=await freePort();const localBase=`http://127.0.0.1:${port}`;
  const unconfigured=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p',String(port),'-H','127.0.0.1'],{env:{...process.env,NODE_ENV:'production',APP_URL:localBase,BETTER_AUTH_URL:localBase,GOOGLE_CLIENT_ID:'',GOOGLE_CLIENT_SECRET:''},stdio:'ignore',windowsHide:true});
  try{
    let ready=false;for(let i=0;i<50;i++){try{if((await nativeFetch(localBase+'/login',{signal:AbortSignal.timeout(1000)})).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}assert.ok(ready);
    const count=await db.verification.count({where:{identifier:{startsWith:'drive:'}}});
    const result=await nativeFetch(localBase+'/api/drive/connect',{headers:{Cookie:cookie},redirect:'manual'});assert.equal(result.status,307);assert.equal(result.headers.get('cache-control'),'no-store');
    const location=new URL(result.headers.get('location')!);assert.equal(location.origin,localBase);assert.equal(location.pathname,'/admin');assert.equal(location.searchParams.get('driveError'),'oauth_missing');assert.equal(location.searchParams.get('step'),'2');assert.equal(await db.verification.count({where:{identifier:{startsWith:'drive:'}}}),count);
    const data=await (await nativeFetch(localBase+'/api/admin/data',{headers:{Cookie:cookie}})).json();assert.equal(data.developerReady.google,false);assert.equal(data.developerReady.googleCallbackUrl,localBase+'/api/drive/callback');assert.ok(!JSON.stringify(data).includes('GOOGLE_CLIENT_SECRET'));
  }finally{unconfigured.kill('SIGTERM');}
});

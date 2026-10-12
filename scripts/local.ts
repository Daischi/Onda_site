import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import EmbeddedPostgres from 'embedded-postgres';
import { PrismaClient } from '@prisma/client';

const root=process.cwd();
const execute=promisify(execFile);
const setup=process.argv.includes('--setup');
const check=process.argv.includes('--check');
const openBrowser=process.argv.includes('--open');
const children:ChildProcess[]=[];
let cluster:EmbeddedPostgres|undefined;
let ownsDatabase=false;
let db:PrismaClient|undefined;
let stopping=false;

async function freePort(){
  const server=createServer();
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=(server.address() as {port:number}).port;
  await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  return port;
}

async function configure(){
  const envPath=path.join(root,'.env');
  if(!existsSync(envPath)){
    const port=await freePort();
    const password=randomBytes(32).toString('base64url');
    const text=[
      '# Configuração local privada. Não publicar nem incluir no ZIP.',
      'ONDA_LOCAL_PREVIEW=true',
      `DATABASE_URL=postgresql://postgres:${password}@127.0.0.1:${port}/postgres`,
      'APP_URL=http://localhost:3000',
      'BETTER_AUTH_URL=http://localhost:3000',
      `BETTER_AUTH_SECRET=${randomBytes(40).toString('base64')}`,
      `ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`,
      'ALLOW_LIVE_PAYMENTS=false',
      'MEDIA_HOSTS=images.unsplash.com',
      'GOOGLE_CLIENT_ID=',
      'GOOGLE_CLIENT_SECRET=',
      ''
    ].join('\n');
    writeFileSync(envPath,text,{flag:'wx'});
  }
  process.loadEnvFile(envPath);
  const app=new URL(process.env.APP_URL||'');
  const database=new URL(process.env.DATABASE_URL||'');
  if(process.env.ONDA_LOCAL_PREVIEW!=='true'||!['localhost','127.0.0.1'].includes(app.hostname)||process.env.ALLOW_LIVE_PAYMENTS==='true'||database.hostname!=='127.0.0.1'){
    throw new Error('Este iniciador aceita somente o banco e a configuração de desenvolvimento local.');
  }
  const databaseDir=path.join(root,'.local','postgres');
  mkdirSync(path.dirname(databaseDir),{recursive:true});
  cluster=new EmbeddedPostgres({databaseDir,port:Number(database.port),user:decodeURIComponent(database.username),password:decodeURIComponent(database.password),persistent:true,authMethod:'scram-sha-256',postgresFlags:['-h','127.0.0.1'],initdbFlags:['--encoding=UTF8','--locale=C'],onLog:()=>{},onError:()=>{}});
  if(process.platform==='win32')cluster.stop=async()=>{
    if(!ownsDatabase)return;
    const pgctl=path.join(root,'node_modules','@embedded-postgres','windows-x64','native','bin','pg_ctl.exe');
    await execute(pgctl,['stop','-D',databaseDir,'-m','fast','-w','-t','15'],{windowsHide:true,timeout:20000});
    ownsDatabase=false;
  };
  let alreadyRunning=false;
  const probe=cluster.getPgClient('postgres','127.0.0.1');
  try{await probe.connect();alreadyRunning=true;}catch{}finally{await probe.end().catch(()=>{});}
  if(!alreadyRunning){if(!existsSync(path.join(databaseDir,'PG_VERSION')))await cluster.initialise();await cluster.start();ownsDatabase=true;}
  console.log('Banco local pronto. Os dados ficam preservados na pasta .local.');
  await execute(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{cwd:root,env:process.env,windowsHide:true,timeout:60000});
  db=new PrismaClient();
  if(!await db.user.count({where:{role:'admin'}})){
    if(!process.env.ADMIN_USERNAME||!process.env.ADMIN_PASSWORD)throw new Error('A primeira conta precisa de ADMIN_USERNAME e ADMIN_PASSWORD no comando de configuração.');
    const address=process.env.ADMIN_EMAIL||`${process.env.ADMIN_USERNAME}@onda.local.invalid`;
    await execute(process.execPath,['--import','tsx','scripts/create-admin.ts'],{cwd:root,env:{...process.env,ADMIN_EMAIL:address,ADMIN_NAME:process.env.ADMIN_NAME||process.env.ADMIN_USERNAME},windowsHide:true,timeout:30000});
    console.log('Conta administrativa criada.');
  }
  await db.settings.upsert({where:{id:'store'},create:{id:'store'},update:{}});
  delete process.env.ADMIN_PASSWORD;
  delete process.env.ADMIN_EMAIL;
  delete process.env.ADMIN_NAME;
  delete process.env.ADMIN_USERNAME;
}

function launch(args:string[]){
  const child=spawn(process.execPath,args,{cwd:root,env:{...process.env,NODE_ENV:'production'},windowsHide:true,stdio:['ignore','pipe','pipe']});
  children.push(child);
  child.stdout?.on('data',chunk=>process.stdout.write(chunk));
  child.stderr?.on('data',chunk=>process.stderr.write(chunk));
  return child;
}

async function ready(base:string,child:ChildProcess){
  for(let i=0;i<100;i++){
    if(child.exitCode!==null)throw new Error('O servidor local encerrou antes de ficar pronto.');
    try{const result=await fetch(`${base}/login`,{signal:AbortSignal.timeout(2000)});if(result.ok)return;}catch{}
    await new Promise(resolve=>setTimeout(resolve,300));
  }
  throw new Error('Não foi possível acessar o servidor local.');
}

async function checkAccess(base:string){
  const username=process.env.ONDA_CHECK_USERNAME||'capo';
  const password=process.env.ONDA_CHECK_PASSWORD;
  if(!password)throw new Error('Defina ONDA_CHECK_PASSWORD para conferir o acesso.');
  const headers={'Content-Type':'application/json',Origin:base};
  const denied=await fetch(`${base}/api/admin/data`);
  if(denied.status!==401)throw new Error('O painel deve exigir autenticação.');
  const wrong=await fetch(`${base}/api/auth/sign-in/username`,{method:'POST',headers,body:JSON.stringify({username,password:randomBytes(20).toString('hex')})});
  if(wrong.ok)throw new Error('Uma senha incorreta foi aceita.');
  const login=await fetch(`${base}/api/auth/sign-in/username`,{method:'POST',headers,body:JSON.stringify({username,password})});
  if(!login.ok)throw new Error(`O login por usuário não foi aceito (${login.status}).`);
  const cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
  if(!cookie)throw new Error('O login não criou uma sessão.');
  const result=await fetch(`${base}/api/admin/data`,{headers:{Cookie:cookie}});
  if(!result.ok)throw new Error('A sessão não abriu as configurações administrativas.');
  const data=await result.json();
  if(!data.settings||data.developerReady.live!==false)throw new Error('O ambiente local não ficou configurado corretamente.');
  const page=await fetch(`${base}/admin`,{headers:{Cookie:cookie},redirect:'manual'});
  if(page.status!==200||(await page.text()).includes('NEXT_REDIRECT'))throw new Error('A página administrativa não abriu.');
  const saved=await fetch(`${base}/api/admin/settings`,{method:'POST',headers:{...headers,Cookie:cookie},body:JSON.stringify(data.settings)});
  if(!saved.ok)throw new Error('Não foi possível salvar as configurações com a conta administrativa.');
  console.log('Verificação aprovada: senha incorreta rejeitada, login por usuário válido, sessão e painel administrativo funcionando.');
}

async function cleanup(){
  if(stopping)return;
  stopping=true;
  for(const child of children){
    if(child.exitCode===null&&child.pid){
      child.kill('SIGTERM');
      await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,2000))]);
    }
  }
  await db?.$disconnect();
  if(ownsDatabase)await cluster?.stop();
}

process.once('SIGINT',()=>{void cleanup().finally(()=>process.exit(0));});
process.once('SIGTERM',()=>{void cleanup().finally(()=>process.exit(0));});
async function main(){
  await configure();
  if(setup&&!check){console.log('Configuração local concluída.');return;}
  if(!existsSync(path.join(root,'.next','BUILD_ID')))throw new Error('Execute o build antes de iniciar a loja.');
  const port=check?await freePort():Number(new URL(process.env.APP_URL!).port||3000);
  const base=check?`http://127.0.0.1:${port}`:process.env.APP_URL!;
  process.env.APP_URL=base;
  process.env.BETTER_AUTH_URL=base;
  const app=launch(['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)]);
  await ready(base,app);
  if(check){await checkAccess(base);return;}
  const worker=launch(['--import','tsx','scripts/worker.ts']);
  if(openBrowser&&process.platform==='win32')spawn('cmd.exe',['/c','start','',`${new URL(base).origin}/admin`],{windowsHide:true,stdio:'ignore'}).unref();
  console.log(`\nLoja: ${base}\nPainel: ${base}/admin\nMantenha esta janela aberta. Ctrl+C encerra o servidor e preserva o banco.\n`);
  await new Promise<void>(resolve=>{app.once('exit',()=>resolve());worker.once('exit',()=>resolve());});
}
main().catch(()=>{console.error('Não foi possível iniciar/configurar a loja local. Confira a configuração e se outra instância já está aberta.');process.exitCode=1;}).finally(async()=>{await cleanup();process.exit(process.exitCode||0);});

import { PrismaClient } from '@prisma/client';
import { hashPassword } from 'better-auth/crypto';
import { randomUUID } from 'node:crypto';
import { email } from '../src/lib/validation';
const db=new PrismaClient();
function isLocalPreview(){
  if(process.env.ONDA_LOCAL_PREVIEW!=='true'||process.env.ALLOW_LIVE_PAYMENTS==='true')return false;
  try{
    const urls=[new URL(process.env.APP_URL||''),new URL(process.env.BETTER_AUTH_URL||process.env.APP_URL||'')];
    return urls.every(url=>['http:','https:'].includes(url.protocol)&&['localhost','127.0.0.1'].includes(url.hostname));
  }catch{return false;}
}
async function main(){
  const address=email.parse(process.env.ADMIN_EMAIL);const name=process.env.ADMIN_NAME||'Administrador';const password=process.env.ADMIN_PASSWORD||'';
  const username=process.env.ADMIN_USERNAME?.trim().toLowerCase()||undefined;
  if(username&&(!/^[a-z0-9_.]+$/.test(username)||username.length<3||username.length>30))throw new Error('ADMIN_USERNAME precisa ter 3 a 30 letras, números, pontos ou sublinhados.');
  const minPasswordLength=isLocalPreview()?5:14;
  if(password.length<minPasswordLength)throw new Error(`Defina ADMIN_PASSWORD com pelo menos ${minPasswordLength} caracteres, sem senha padrão.`);
  const hashed=await hashPassword(password);
  await db.$transaction(async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(8216743)`;
    if(await tx.user.count({where:{role:'admin'}}))throw new Error('Administrador já existe. Use a conta existente.');
    const id=randomUUID();await tx.user.create({data:{id,email:address,username,name,role:'admin',emailVerified:true,accounts:{create:{id:randomUUID(),accountId:id,providerId:'credential',password:hashed}}}});
  });console.log('Administrador criado. Remova ADMIN_PASSWORD do ambiente.');
}
main().catch(()=>{console.error('Não foi possível criar o administrador. Verifique as variáveis e se já existe uma conta.');process.exitCode=1;}).finally(()=>db.$disconnect());

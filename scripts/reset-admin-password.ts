import { PrismaClient } from '@prisma/client';
import { hashPassword } from 'better-auth/crypto';
const db=new PrismaClient();
function isLocalPreview(){
  if(process.env.ONDA_LOCAL_PREVIEW!=='true'||process.env.ALLOW_LIVE_PAYMENTS==='true')return false;
  try{
    const urls=[new URL(process.env.APP_URL||''),new URL(process.env.BETTER_AUTH_URL||process.env.APP_URL||'')];
    return urls.every(url=>['http:','https:'].includes(url.protocol)&&['localhost','127.0.0.1'].includes(url.hostname));
  }catch{return false;}
}
async function main(){
  if(process.env.CONFIRM_RESET!=='RESET_ADMIN_PASSWORD'||(!process.env.ADMIN_EMAIL&&!process.env.ADMIN_USERNAME)||(process.env.ADMIN_PASSWORD||'').length<(isLocalPreview()?5:14))throw new Error();
  const where=process.env.ADMIN_USERNAME?{username:process.env.ADMIN_USERNAME.trim().toLowerCase()}:{email:process.env.ADMIN_EMAIL!.trim().toLowerCase()};
  const user=await db.user.findUniqueOrThrow({where});if(user.role!=='admin')throw new Error();
  const password=await hashPassword(process.env.ADMIN_PASSWORD!);
  await db.$transaction(async tx=>{await tx.account.updateMany({where:{userId:user.id,providerId:'credential'},data:{password}});await tx.session.deleteMany({where:{userId:user.id}});await tx.audit.create({data:{actorId:user.id,action:'password-recovery',targetId:user.id,detail:'Recuperação local pelo operador autorizado. Todas as sessões revogadas.'}});});
  console.log('Senha atualizada; sessões encerradas. Remova as variáveis de recuperação do ambiente.');
}
main().catch(()=>{console.error('Recuperação não executada. Verifique ADMIN_EMAIL ou ADMIN_USERNAME, ADMIN_PASSWORD e CONFIRM_RESET.');process.exitCode=1;}).finally(()=>db.$disconnect());

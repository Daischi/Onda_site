import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { username } from 'better-auth/plugins';
import { headers } from 'next/headers';
import { db } from './db';
import { SafeError } from './security';
function isLocalPreview(){
  if(process.env.ONDA_LOCAL_PREVIEW!=='true'||process.env.ALLOW_LIVE_PAYMENTS==='true')return false;
  try{
    const urls=[new URL(process.env.APP_URL||''),new URL(process.env.BETTER_AUTH_URL||process.env.APP_URL||'')];
    return urls.every(url=>['http:','https:'].includes(url.protocol)&&['localhost','127.0.0.1'].includes(url.hostname));
  }catch{return false;}
}
const localPreview=isLocalPreview();
const authURL=process.env.BETTER_AUTH_URL||'http://localhost:3000';
export const auth=betterAuth({
  database:prismaAdapter(db,{provider:'postgresql'}),
  baseURL:authURL,
  secret:process.env.BETTER_AUTH_SECRET,
  emailAndPassword:{enabled:true,disableSignUp:true,minPasswordLength:localPreview?5:14},
  plugins:[username({minUsernameLength:3,maxUsernameLength:30,displayUsername:false})],
  session:{expiresIn:60*60*8,updateAge:60*30},
  rateLimit:{enabled:true,storage:'database',window:60,max:30},
  user:{additionalFields:{role:{type:'string',defaultValue:'user',input:false}}},
  advanced:{useSecureCookies:new URL(authURL).protocol==='https:'}
});
export async function requireAdmin(){const session=await auth.api.getSession({headers:await headers()});if(!session||session.user.role!=='admin')throw new SafeError('Faça login como administrador.',401);return session.user;}

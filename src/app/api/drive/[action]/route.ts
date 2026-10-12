import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { requireAdmin } from '@/lib/auth';
import { db } from '@/lib/db';
import { googleOAuth, saveIntegration } from '@/lib/providers';
import { digest, SafeError } from '@/lib/security';
import { googleOAuthReady } from '@/lib/drive-oauth';
const redirect=(url:string|URL)=>NextResponse.redirect(url,{headers:{'Cache-Control':'no-store'}});
export async function GET(req:Request,{params}:{params:Promise<{action:string}>}){
let reason='connection_failed';
const base=process.env.APP_URL||'http://localhost:3000';
try{
  const user=await requireAdmin();const {action}=await params;
  if(!googleOAuthReady()){reason='oauth_missing';throw new SafeError('OAuth Google não configurado.');}
  const oauth=googleOAuth();
  if(action==='connect'){
    await db.verification.deleteMany({where:{identifier:{startsWith:'drive:'},expiresAt:{lt:new Date()}}});
    const state=randomBytes(32).toString('hex');await db.verification.create({data:{id:crypto.randomUUID(),identifier:`drive:${digest(state)}`,value:user.id,expiresAt:new Date(Date.now()+10*60*1000)}});
    return redirect(oauth.generateAuthUrl({access_type:'offline',prompt:'consent',scope:['https://www.googleapis.com/auth/drive'],state}));
  }
  if(action==='callback'){
    const url=new URL(req.url);const state=url.searchParams.get('state')||'';
    if(!/^[a-f0-9]{64}$/.test(state)){reason='state_invalid';throw new SafeError('Autorização inválida.');}
    const valid=await db.$transaction(async tx=>{const v=await tx.verification.findFirst({where:{identifier:`drive:${digest(state)}`,value:user.id,expiresAt:{gt:new Date()}}});if(!v)return false;const deleted=await tx.verification.deleteMany({where:{id:v.id}});return deleted.count===1;});
    if(!valid){reason='state_invalid';throw new SafeError('Autorização expirada ou já utilizada.');}
    if(url.searchParams.has('error')){reason=url.searchParams.get('error')==='access_denied'?'cancelled':'provider_denied';throw new SafeError('Autorização não concedida.');}
    const code=url.searchParams.get('code');if(!code){reason='cancelled';throw new SafeError('Autorização cancelada.');}
    const {tokens}=await oauth.getToken(code);if(!tokens.refresh_token){reason='offline_missing';throw new SafeError('Acesso offline não concedido.');}
    await saveIntegration('drive',{tokens});return redirect(`${base}/admin?tab=setup&step=2&driveConnected=1`);
  }
  throw new SafeError('Página não encontrada.',404);
}catch(error){
  if(error instanceof SafeError&&error.status===401)return redirect(`${base}/login`);
  const url=new URL('/admin',base);url.searchParams.set('tab','setup');url.searchParams.set('step','2');url.searchParams.set('driveError',reason);return redirect(url);
}}

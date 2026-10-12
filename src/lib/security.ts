import { createCipheriv, createDecipheriv, randomBytes, createHash, timingSafeEqual, createHmac } from 'node:crypto';
import { db } from './db';
export class SafeError extends Error { constructor(message:string,public status=400){super(message);} }
export const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
function encryptionKey(){const key=Buffer.from(process.env.ENCRYPTION_KEY||'','base64');if(key.length!==32)throw new SafeError('O desenvolvedor precisa configurar ENCRYPTION_KEY com 32 bytes.',503);return key;}
export function encrypt(value:unknown){const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',encryptionKey(),iv);const content=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return [iv,cipher.getAuthTag(),content].map(v=>v.toString('base64')).join('.');}
export function decrypt<T>(value:string):T{const [iv,tag,content]=value.split('.').map(v=>Buffer.from(v,'base64'));const cipher=createDecipheriv('aes-256-gcm',encryptionKey(),iv);cipher.setAuthTag(tag);return JSON.parse(Buffer.concat([cipher.update(content),cipher.final()]).toString('utf8'));}
export function verifyWebhook(id:string,requestId:string,signature:string,secret:string,now=Date.now()){
  const parts=Object.fromEntries(signature.split(',').map(v=>v.trim().split('=')));
  if(!id||!requestId||!/^\d+$/.test(parts.ts||'')||! /^[a-f0-9]{64}$/i.test(parts.v1||''))return false;
  const ts=Number(parts.ts);const millis=ts<1e12?ts*1000:ts;
  if(Math.abs(now-millis)>5*60*1000)return false;
  const expected=createHmac('sha256',secret).update(`id:${id.toLowerCase()};request-id:${requestId};ts:${parts.ts};`).digest();
  return timingSafeEqual(expected,Buffer.from(parts.v1,'hex'));
}
export function sameOrigin(req:Request){const origin=req.headers.get('origin');if(origin!==new URL(process.env.APP_URL||'http://localhost:3000').origin)throw new SafeError('Origem não autorizada.',403);}
export async function limit(key:string,max=20,seconds=60){
  const hashed=digest(key);const now=new Date();
  const result=await db.$queryRaw<{count:number}[]>`INSERT INTO "Throttle" ("key","count","expiresAt") VALUES (${hashed},1,${new Date(+now+seconds*1000)}) ON CONFLICT ("key") DO UPDATE SET "count"=CASE WHEN "Throttle"."expiresAt"<${now} THEN 1 ELSE "Throttle"."count"+1 END,"expiresAt"=CASE WHEN "Throttle"."expiresAt"<${now} THEN ${new Date(+now+seconds*1000)} ELSE "Throttle"."expiresAt" END RETURNING "count"`;
  if(result[0].count>max)throw new SafeError('Muitas tentativas. Aguarde um minuto.',429);
}
export function mediaAllowed(url:string){if(!url)return;const hosts=(process.env.MEDIA_HOSTS||'').split(',').map(v=>v.trim());if(!hosts.includes(new URL(url).hostname))throw new SafeError('Peça ao desenvolvedor para autorizar o domínio desta mídia em MEDIA_HOSTS.');}
export const orderTokenValid=(token:string,hash:string)=> /^[a-f0-9]{64}$/.test(token)&&timingSafeEqual(Buffer.from(digest(token),'hex'),Buffer.from(hash,'hex'));

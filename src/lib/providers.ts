import { OAuth2Client, type Credentials } from 'google-auth-library';
import { db } from './db';
import { decrypt, encrypt, SafeError } from './security';
import type { z } from 'zod';
import { mpSchema, mailSchema } from './validation';
export type MPConfig=z.infer<typeof mpSchema>;
export type DriveConfig={tokens:Credentials;rootId?:string};
export type Payment={id:number|string;status:string;status_detail?:string;transaction_amount:number;transaction_amount_refunded?:number;currency_id:string;collector_id:number;external_reference:string;live_mode:boolean;date_last_updated:string;date_of_expiration?:string;point_of_interaction?:{transaction_data?:{qr_code:string;qr_code_base64:string}}};
export async function config<T>(id:string){const row=await db.integration.findUnique({where:{id}});if(!row)throw new SafeError(`Configure a integração ${id} no painel.`,503);return decrypt<T>(row.encrypted);}
export async function saveIntegration(id:string,value:unknown){await db.integration.upsert({where:{id},create:{id,encrypted:encrypt(value)},update:{encrypted:encrypt(value),status:'saved',checkedAt:null,message:'Salvo. Execute o teste de conexão.'}});}
export async function markIntegration(id:string,ok:boolean,message:string){await db.integration.update({where:{id},data:{status:ok?'working':'error',checkedAt:new Date(),message}});}
async function providerFetch<T>(url:string,init:RequestInit,provider:string):Promise<T>{
  let response:Response;try { response=await fetch(url,{...init,signal:AbortSignal.timeout(15000),cache:'no-store'}); }catch {throw new SafeError(`${provider}: conexão indisponível. Tente novamente.`,503);}
  if(!response.ok){const message=response.status===429?'limite de requisições atingido; aguarde e tente novamente':response.status===401?'credencial expirada ou revogada; reconecte a conta':response.status===403?'acesso negado; confira permissões e configuração':`solicitação recusada (${response.status}); confira a configuração`;
    const key=provider==='Google Drive'?'drive':provider==='Resend'?'email':provider==='Mercado Pago'?'pix':'';
    if(key)await markIntegration(key,false,`${provider}: ${message}.` ).catch(()=>{});
    throw new SafeError(`${provider}: ${message}.`,503);}
  const connected=provider==='Google Drive'?'drive':provider==='Resend'?'email':provider==='Mercado Pago'?'pix':'';
  if(connected)await db.integration.updateMany({where:{id:connected,status:'error'},data:{status:'working',checkedAt:new Date(),message:'Conexão recuperada durante uma operação real.'}}).catch(()=>{});
  if(response.status===204)return undefined as T;
  return response.json();
}
export async function mp<T>(path:string,init:RequestInit={}){const c=await config<MPConfig>('pix');return providerFetch<T>('https://api.mercadopago.com'+path,{...init,headers:{Authorization:`Bearer ${c.token}`,'Content-Type':'application/json',...init.headers}},'Mercado Pago');}
export const googleOAuth=()=>new OAuth2Client(process.env.GOOGLE_CLIENT_ID,process.env.GOOGLE_CLIENT_SECRET,`${process.env.APP_URL}/api/drive/callback`);
async function driveToken(){
  const c=await config<DriveConfig>('drive');const auth=googleOAuth();auth.setCredentials(c.tokens);
  try{const result=await auth.getAccessToken();if(!result.token)throw new Error();
    // Refresh token remains server-side. Google generally preserves the refresh token.
    if(auth.credentials.access_token!==c.tokens.access_token)await db.integration.update({where:{id:'drive'},data:{encrypted:encrypt({...c,tokens:{...c.tokens,...auth.credentials}})}});
    return result.token;
  }catch {await markIntegration('drive',false,'Autorização indisponível. Reconecte o Google Drive.');throw new SafeError('Google Drive: reconecte a conta no painel.',503);}
}
export async function drive<T>(path:string,init:RequestInit={}){return providerFetch<T>('https://www.googleapis.com/drive/v3'+path,{...init,headers:{Authorization:`Bearer ${await driveToken()}`,'Content-Type':'application/json',...init.headers}},'Google Drive');}
type Permission={id:string;type:string;role:string;emailAddress?:string;permissionDetails?:{inherited:boolean}[]};
export async function permissions(id:string){let page='';const all:Permission[]=[];do{const r: {permissions:Permission[];nextPageToken?:string}=await drive(`/files/${id}/permissions?supportsAllDrives=true&pageSize=100&fields=permissions(id,type,role,emailAddress,permissionDetails),nextPageToken${page?'&pageToken='+encodeURIComponent(page):''}`);all.push(...r.permissions);page=r.nextPageToken||'';}while(page);return all;}
export async function validateDrive(id:string,type:string){
  const c=await config<DriveConfig>('drive');if(!c.rootId)throw new SafeError('Informe a pasta principal do catálogo na etapa Google Drive.');
  if(id===c.rootId)throw new SafeError('A pasta principal do catálogo nunca pode ser vendida.');
  const item=await drive<{id:string;name:string;mimeType:string;trashed:boolean;parents?:string[];capabilities:{canShare:boolean}}> (`/files/${id}?supportsAllDrives=true&fields=id,name,mimeType,trashed,parents,capabilities(canShare)`);
  if(item.trashed||!item.capabilities.canShare)throw new SafeError('O item está na lixeira ou a conta conectada não pode compartilhá-lo.');
  if(!item.parents?.includes(c.rootId))throw new SafeError('Coloque este arquivo ou pacote diretamente dentro da pasta principal do catálogo.');
  if((type==='bundle')!==(item.mimeType==='application/vnd.google-apps.folder'))throw new SafeError('Selecione um arquivo para música ou uma pasta para pacote.');
  if(type==='track'&&(!item.mimeType.startsWith('audio/')&&!['application/zip','application/x-zip-compressed','application/octet-stream'].includes(item.mimeType)))throw new SafeError('Use um arquivo de áudio ou ZIP. Atalhos e documentos Google não são aceitos.');
  if((await permissions(id)).some(p=>p.type==='anyone'||p.type==='domain'))throw new SafeError('Remova o acesso público ou por domínio do item e de suas pastas superiores.');
  return item;
}
export async function grantReader(id:string,email:string){
  const found=(await permissions(id)).find(p=>p.type==='user'&&p.emailAddress?.toLowerCase()===email);
  if(found)return {permissionId:found.id,owned:false};
  const created=await drive<{id:string}>(`/files/${id}/permissions?supportsAllDrives=true&sendNotificationEmail=false&fields=id`,{method:'POST',body:JSON.stringify({type:'user',role:'reader',emailAddress:email})});
  return {permissionId:created.id,owned:true};
}
export async function sendMail(to:string,subject:string,text:string,key:string){
  const c=await config<z.infer<typeof mailSchema>>('email');const store=await db.settings.findUniqueOrThrow({where:{id:'store'}});
  if(!store.senderEmail)throw new SafeError('Configure o remetente dos e-mails.');
  return providerFetch<{id:string}>('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${c.apiKey}`,'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify({from:`${store.senderName.replace(/[<>\r\n]/g,'')} <${store.senderEmail}>`,to:[to],reply_to:store.support,subject,text:`${text}\n\nSuporte: ${store.support}\n${store.signature}`})},'Resend');
}
export async function testIntegration(id:string){
  try{
    if(id==='pix'){const c=await config<MPConfig>('pix');const account=await mp<{id:number}>('/users/me');if(String(account.id)!==c.collectorId)throw new SafeError('O ID da conta recebedora não corresponde ao Access Token.');if(c.mode==='test'&&!c.token.startsWith('TEST-'))throw new SafeError('Use credenciais de teste para o ambiente de teste.');if(c.mode==='production'&&c.token.startsWith('TEST-'))throw new SafeError('Use credenciais de produção para este ambiente.');}
    else if(id==='drive'){const c=await config<DriveConfig>('drive');if(!c.rootId)throw new SafeError('Informe o ID da pasta principal do catálogo.');const root=await drive<{mimeType:string;capabilities:{canShare:boolean}}>(`/files/${c.rootId}?fields=mimeType,capabilities(canShare)&supportsAllDrives=true`);if(root.mimeType!=='application/vnd.google-apps.folder'||!root.capabilities.canShare)throw new SafeError('Escolha uma pasta que a conta conectada pode compartilhar.');if((await permissions(c.rootId)).some(p=>['anyone','domain'].includes(p.type)))throw new SafeError('Mantenha a pasta principal restrita.');}
    else if(id==='email'){const s=await db.settings.findUniqueOrThrow({where:{id:'store'}});await sendMail(s.support,'Teste de configuração da loja','O serviço aceitou este envio de teste. Confira a caixa de entrada e o spam.',`test-${crypto.randomUUID()}`);}
    else throw new SafeError('Integração desconhecida.');
    const message=id==='email'?'Envio de teste aceito pelo Resend. Confirme o recebimento na caixa de suporte.':id==='pix'?'Credencial e conta recebedora verificadas. O webhook será validado na compra de teste.':'Pasta acessível e restrita. Valide também cada produto.';
    await markIntegration(id,true,message);return message;
  }catch(e){const message=e instanceof SafeError?e.message:'Não foi possível testar. Confira os dados e tente novamente.';await markIntegration(id,false,message);throw new SafeError(message,503);}
}

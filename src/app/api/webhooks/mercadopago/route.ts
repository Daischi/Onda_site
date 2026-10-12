import { NextResponse } from 'next/server';
import { config, type MPConfig } from '@/lib/providers';
import { verifyWebhook, SafeError } from '@/lib/security';
import { syncPayment } from '@/lib/orders';
export async function POST(req:Request){try{
  const id=new URL(req.url).searchParams.get('data.id')||'';const c=await config<MPConfig>('pix');
  if(!/^\d+$/.test(id)||!verifyWebhook(id,req.headers.get('x-request-id')||'',req.headers.get('x-signature')||'',c.webhookSecret))return NextResponse.json({error:'Assinatura inválida.'},{status:401});
  await syncPayment(id);return NextResponse.json({received:true});
}catch(e){return NextResponse.json({error:e instanceof SafeError&&e.status===409?'Pagamento incompatível.':'Não foi possível processar; a notificação deve ser repetida.'},{status:503});}}

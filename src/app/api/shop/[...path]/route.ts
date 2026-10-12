import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { db } from '@/lib/db';
import { createOrder } from '@/lib/orders';
import { limit, SafeError, sameOrigin, orderTokenValid } from '@/lib/security';
import { driveLink } from '@/lib/delivery';
export async function POST(req:Request,{params}:{params:Promise<{path:string[]}>}){try{
  if((await params).path.join('/')!=='checkout')throw new SafeError('Não encontrado.',404);
  sameOrigin(req);if(Number(req.headers.get('content-length')||0)>20000)throw new SafeError('Solicitação muito grande.',413);
  await limit('checkout-global',100,60);const raw=await req.text();if(raw.length>20000)throw new SafeError('Solicitação muito grande.',413);const body=JSON.parse(raw);await limit(`checkout:${String(body.email).toLowerCase()}`,5,60);const o=await createOrder(body);
  return NextResponse.json({id:o.id},{status:201});
}catch(e){return NextResponse.json({error:e instanceof SafeError?e.message:e instanceof ZodError?'Confira os campos do checkout.':'Não foi possível criar o pedido. Tente novamente com o mesmo carrinho.'},{status:e instanceof SafeError?e.status:400});}}
export async function GET(req:Request,{params}:{params:Promise<{path:string[]}>}){try{
  const {path}=await params;if(path[0]!=='orders'||!path[1])throw new SafeError('Pedido não encontrado.',404);
  await limit('order-read-global',1000,60);const token=req.headers.get('authorization')?.replace(/^Bearer /,'')||'';
  const o=await db.order.findUnique({where:{id:path[1]},include:{items:true}});if(!o||!orderTokenValid(token,o.tokenHash))throw new SafeError('Pedido não encontrado ou link de acesso inválido.',404);
  return NextResponse.json({id:o.id,total:o.total,name:o.name,email:o.email,paymentStatus:o.paymentStatus,deliveryStatus:o.deliveryStatus,pix:o.pix,qr:o.qr,expiresAt:o.expiresAt,liveMode:o.liveMode,createdAt:o.createdAt,items:o.items.map(i=>({name:i.name,price:i.price,link:o.paymentStatus==='approved'&&i.deliveredAt&&i.deliveredTo===o.email&&!o.emailCorrectionPending?driveLink(i.type,i.driveId):null}))},{headers:{'Cache-Control':'no-store'}});
}catch(e){return NextResponse.json({error:e instanceof SafeError?e.message:'Consulta indisponível.'},{status:e instanceof SafeError?e.status:503});}}

import { catalog } from '@/lib/catalog';
import { Storefront } from '@/components/storefront';
import { notFound } from 'next/navigation';
export const dynamic='force-dynamic';
export default async function Page({params}:{params:Promise<{path:string[]}>}){const {path}=await params;const modes:Record<string,string>={catalogo:'catalog',produto:'product',carrinho:'cart',checkout:'checkout',pedido:'order',termos:'terms',privacidade:'privacy',licencas:'usage'};if(!modes[path[0]])notFound();const data=await catalog();return <Storefront data={JSON.parse(JSON.stringify(data))} mode={modes[path[0]]} id={path[1]}/>;}

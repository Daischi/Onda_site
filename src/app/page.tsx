import { catalog } from '@/lib/catalog';
import { Storefront } from '@/components/storefront';
export const dynamic='force-dynamic';
export default async function Page(){const data=await catalog();return <Storefront data={JSON.parse(JSON.stringify(data))} mode="home"/>;}

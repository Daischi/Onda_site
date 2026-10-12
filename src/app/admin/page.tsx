import { requireAdmin } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { Admin } from '@/components/admin';
export const dynamic='force-dynamic';
export default async function AdminPage(){try{await requireAdmin();}catch{redirect('/login');}return <Admin/>;}

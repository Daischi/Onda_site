import type { Metadata } from 'next';
import './globals.css';
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'ONDA — Sons para criar',description:'Músicas e coleções independentes para sua próxima ideia.'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="pt-BR"><body>{children}</body></html>;}

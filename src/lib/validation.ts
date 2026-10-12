import { z } from 'zod';
export const email = z.email().max(254).transform(v => v.trim().toLowerCase());
const publicUrl = z.union([z.literal(''), z.url().max(2048).refine(v => {
  const u = new URL(v);
  return u.protocol === 'https:' && !u.username && !u.password && !/^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[)/.test(u.hostname) && !u.hostname.endsWith('.local') && !['drive.google.com','docs.google.com'].includes(u.hostname);
}, 'Use uma URL HTTPS pública de mídia; links do Drive não são permitidos.')]);
export const productSchema = z.object({
  id: z.string().optional(), name:z.string().trim().min(2).max(120), description:z.string().min(10).max(5000),
  price:z.number().int().min(100).max(10000000), type:z.enum(['track','bundle']),
  categoryId:z.string().nullable().optional(), cover:publicUrl, preview:publicUrl,
  featured:z.boolean(), status:z.enum(['draft','published','archived']),
  driveId:z.string().regex(/^[\w-]{10,200}$/, 'Informe um ID válido do Drive.'),
  formats:z.string().min(2).max(100), contents:z.string().min(3).max(4000), license:z.string().min(10).max(5000)
});
export const checkoutSchema = z.object({
  ids:z.array(z.string().min(1).max(100)).min(1).max(30).refine(v=>new Set(v).size===v.length),
  name:z.string().trim().min(3).max(120), email,
  cpf:z.string().transform(v=>v.replace(/[.\-\s]/g,'')).pipe(z.string().regex(/^\d{11}$/, 'Informe os 11 dígitos do CPF do pagador.')),
  googleAccount:z.literal(true), acceptTerms:z.literal(true),
  key:z.string().uuid(), token:z.string().regex(/^[a-f0-9]{64}$/)
}).strict();
export const settingsSchema = z.object({name:z.string().min(2).max(80),description:z.string().max(400),support:email.or(z.literal('')),
  logo:publicUrl,banner:publicUrl,terms:z.string().max(20000),privacy:z.string().max(20000),usage:z.string().max(20000),senderName:z.string().min(2).max(80),senderEmail:email.or(z.literal('')),signature:z.string().max(200)});
export const mpSchema=z.object({token:z.string().min(10).max(500),webhookSecret:z.string().min(10).max(500),collectorId:z.string().regex(/^\d+$/),mode:z.enum(['test','production'])});
export const mailSchema=z.object({apiKey:z.string().startsWith('re_').max(500)});
export const money=(cents:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(cents/100);
export function driveIdFromInput(value:string) {
  if (/^[\w-]{10,200}$/.test(value)) return value;
  try { const u=new URL(value); if(!['drive.google.com','docs.google.com'].includes(u.hostname)) return ''; return u.pathname.match(/\/(?:d|folders)\/([\w-]+)/)?.[1] || u.searchParams.get('id') || ''; } catch { return ''; }
}

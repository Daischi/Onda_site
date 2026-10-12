import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const headers = { 'Cache-Control': 'no-store' };
  try {
    await Promise.race([
      db.$queryRaw`SELECT 1`,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Health check timed out')), 2500);
      }),
    ]);
    return NextResponse.json({ status: 'ok' }, { headers });
  } catch {
    return NextResponse.json({ status: 'unavailable' }, { status: 503, headers });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

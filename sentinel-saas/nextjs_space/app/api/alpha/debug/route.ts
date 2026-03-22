import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const engineUrl = (process.env.ALPHA_ENGINE_URL ?? '').trim();
  const key       = (process.env.ALPHA_INTERNAL_KEY ?? '').trim();

  let fetchResult: any = null;
  try {
    const res = await fetch(`${engineUrl}/alpha/health`, {
      headers: { 'X-Alpha-Key': key },
      cache: 'no-store',
    });
    fetchResult = { status: res.status, ok: res.ok, body: await res.text() };
  } catch (e: any) {
    fetchResult = { error: e.message };
  }

  return NextResponse.json({
    engineUrl:    engineUrl || '(not set)',
    keyLength:    key.length,
    keyPrefix:    key.slice(0, 8) || '(empty)',
    fetchResult,
  });
}

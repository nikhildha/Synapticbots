import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { getEngineUrl } from '@/lib/engine-url';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { action } = await req.json();
    if (action !== 'pause' && action !== 'resume') {
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    const paperUrl = getEngineUrl('paper');
    const liveUrl = getEngineUrl('live');
    
    const reqs = [];
    const endpoint = action === 'pause' ? '/api/pause' : '/api/resume';

    if (paperUrl) {
        reqs.push(fetch(`${paperUrl}${endpoint}`, { method: 'POST', body: JSON.stringify({}), headers: {'Content-Type': 'application/json'} }).catch(()=>null));
    }
    if (liveUrl) {
        reqs.push(fetch(`${liveUrl}${endpoint}`, { method: 'POST', body: JSON.stringify({}), headers: {'Content-Type': 'application/json'} }).catch(()=>null));
    }
    
    await Promise.all(reqs);

    return NextResponse.json({ success: true, action });
  } catch (error: any) {
    console.error('Toggle pause error:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

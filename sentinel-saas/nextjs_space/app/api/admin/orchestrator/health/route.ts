import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const session = await getServerSession(authOptions);
        // H1 FIX: Require admin role (was only checking for any session)
        if (!session?.user || (session.user as any)?.role !== 'admin') {
            return NextResponse.json({ error: 'Admin only' }, { status: 403 });
        }

        const orchestratorUrl = process.env.ORCHESTRATOR_URL || 'http://localhost:5000';
        const res = await fetch(`${orchestratorUrl}/api/health`, { signal: AbortSignal.timeout(3000) });

        if (res.ok) {
            const data = await res.json();
            return NextResponse.json({ online: true, ...data });
        }
        return NextResponse.json({ online: false }, { status: 503 });
    } catch {
        return NextResponse.json({ online: false }, { status: 503 });
    }
}

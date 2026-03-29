import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { redirect } from 'next/navigation';
import { SegmentIntelligenceClient } from './segment-intelligence-client';

export const dynamic = 'force-dynamic';

export default async function SegmentIntelligencePage() {
    const session = await getServerSession(authOptions);
    if (!session?.user || (session.user as any).role !== 'admin') {
        redirect('/dashboard');
    }

    // Fetch global intelligence data server-side
    let data: any = { segments: [], summary: {} };
    try {
        const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
        const res = await fetch(`${baseUrl}/api/admin/segment-intelligence`, {
            cache: 'no-store',
            headers: { Cookie: '' }, // server-to-server; admin session checked via route
        });
        if (res.ok) data = await res.json();
    } catch (e) {
        console.error('[segment-intelligence page] fetch error:', e);
    }

    return <SegmentIntelligenceClient segments={data.segments} summary={data.summary} />;
}

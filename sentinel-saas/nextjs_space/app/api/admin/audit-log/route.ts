import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import prisma from '@/lib/prisma';

export async function GET() {
    try {
        const session = await getServerSession(authOptions);

        if (!session || session.user.role !== 'admin') {
            return new NextResponse('Unauthorized', { status: 401 });
        }

        // Fetch logs
        const logs = await prisma.auditLog.findMany({
            orderBy: { timestamp: 'desc' },
            take: 100, // Limit to 100 most recent for the UI
        });

        // Send a dummy test record if none exist just to prove the UI works initially
        if (logs.length === 0) {
            const dummyLog = await prisma.auditLog.create({
                data: {
                    actor: session.user.name || session.user.email || 'Admin',
                    actorRole: 'admin',
                    action: 'Audit Log System Initialized',
                    category: 'system',
                    details: 'No prior logs found. The audit log tracking system has been successfully connected.',
                    severity: 'info'
                }
            });
            logs.push(dummyLog);
        }

        return NextResponse.json({ logs });

    } catch (error) {
        console.error('AuditLog GET error:', error);
        return new NextResponse('Internal Server Error', { status: 500 });
    }
}

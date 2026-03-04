import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { redirect } from 'next/navigation';
import { HowToClient } from './howto-client';

export default async function HowToPage() {
    const session = await getServerSession(authOptions);
    if (!session) redirect('/login');

    return <HowToClient />;
}

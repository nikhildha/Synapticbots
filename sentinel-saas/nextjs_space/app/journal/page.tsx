import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { redirect } from 'next/navigation';
import { JournalClient } from '@/components/journal/journal-client';

export const metadata = {
  title: 'Trade Journal | Synaptic',
  description: 'Paper and live trade journal with execution intelligence and fleet analytics',
};

export default async function JournalPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect('/login');

  return <JournalClient />;
}

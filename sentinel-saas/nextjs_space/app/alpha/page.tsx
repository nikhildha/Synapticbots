/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  ALPHA MODULE — PAGE (Server Component)                             ║
 * ║  Route: /alpha                                                      ║
 * ║  Auth-gated. Passes session user to AlphaClient.                   ║
 * ║                                                                     ║
 * ║  ISOLATION: no Prisma queries — Alpha data comes from              ║
 * ║  /api/alpha which reads alpha/data/*.json directly.                ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import { getServerSession } from 'next-auth';
import { redirect }         from 'next/navigation';
import { authOptions }      from '@/lib/auth-options';
import { AlphaClient }      from './alpha-client';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Alpha — Synaptic',
  description: 'Synaptic Alpha quant engine: QUAD vol strategy live dashboard',
};

export default async function AlphaPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect('/login');

  return <AlphaClient userName={(session.user as any)?.name ?? 'User'} />;
}

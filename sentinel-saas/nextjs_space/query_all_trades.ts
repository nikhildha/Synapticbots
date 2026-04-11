import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const trades = await prisma.trade.findMany({
    orderBy: { entryTime: 'desc' },
    take: 5,
    include: { bot: true }
  });
  console.log(JSON.stringify(trades, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());

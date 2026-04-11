import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const trades = await prisma.trade.findMany({
    where: { coin: 'FETUSDT' },
    orderBy: { entryTime: 'desc' },
    take: 10,
    include: { bot: true }
  });
  console.log(JSON.stringify(trades, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());

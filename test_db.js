const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const recentTrades = await prisma.trade.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5
  });
  console.log("Recent Trades from DB:", JSON.stringify(recentTrades, null, 2));
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());

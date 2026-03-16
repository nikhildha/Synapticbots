import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const bots = await prisma.bot.findMany({ include: { config: true } });
  console.log(JSON.stringify(bots, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());

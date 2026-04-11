import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const bots = await prisma.bot.findMany({
    where: { isActive: true },
  });
  console.log(bots.length + " active bots found");
}
main().catch(console.error).finally(() => prisma.$disconnect());

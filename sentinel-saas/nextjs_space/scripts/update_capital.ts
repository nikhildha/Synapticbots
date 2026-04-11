import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const updated = await prisma.botConfig.updateMany({
    data: {
      capitalPerTrade: 100,
    }
  });
  console.log(`Updated ${updated.count} bots to 3000 capitalPerTrade in the database.`);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

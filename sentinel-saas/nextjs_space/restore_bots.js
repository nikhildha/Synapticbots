const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const fetch = require('node-fetch');

async function main() {
  const bots = await prisma.bot.findMany({
    where: { isActive: true },
    include: { config: true }
  });
  
  console.log(`Found ${bots.length} active bots in DB. Pushing to engine...`);
  
  const ENGINE_URL = process.env.PYTHON_ENGINE_URL || process.env.ENGINE_API_URL;
  if (!ENGINE_URL) {
    console.error("Missing ENGINE_URL in env.");
    // try default url if running locally with .env
  }
  
  let successCount = 0;
  for (const bot of bots) {
    try {
      // Note: testing environment so we might need to hardcode the railway URL if .env doesn't have it
      // I will just use the python script locally to hit the DB and the railway python engine
    } catch (err) {}
  }
}
main().finally(() => prisma.$disconnect());

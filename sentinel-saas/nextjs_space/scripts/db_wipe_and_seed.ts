import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log("🔥 Starting production DB wipe...");

  // 1. Wipe old data in correct relational order (from leaves to roots)
  // Note: Prisma usually handles ordering via Cascade, but deleteMany over separate queries ensures a clean flush
  console.log("Deleting Partial Bookings...");
  await prisma.partialBooking.deleteMany({});

  console.log("Deleting Trades...");
  await prisma.trade.deleteMany({});
  
  console.log("Deleting BotStates...");
  await prisma.botState.deleteMany({});
  
  console.log("Deleting BotConfigs...");
  await prisma.botConfig.deleteMany({});
  
  console.log("Deleting BotSessions...");
  await prisma.botSession.deleteMany({});
  
  console.log("Deleting Bots...");
  await prisma.bot.deleteMany({});

  console.log("✅ Wiped all trade and bot history.");

  // 2. Fetch all users
  const users = await prisma.user.findMany();
  console.log(`Found ${users.length} users. Reseeding 3 bots each...`);

  const botTemplates = [
    { name: "Sentinel Titan (Slow)" },
    { name: "Sentinel Vanguard (Moderate)" },
    { name: "Sentinel Rogue (Aggressive)" },
  ];

  for (const user of users) {
    for (const template of botTemplates) {
      // Create Bot tied to user
      const bot = await prisma.bot.create({
        data: {
          userId: user.id,
          name: template.name,
          exchange: "coindcx", // Changed to coindcx logic if applicable, or fallback to default
          status: "stopped",
          isActive: true, // Auto-activate so they are deployed to engine
        }
      });
      
      // Create associated default config
      await prisma.botConfig.create({
        data: {
          botId: bot.id,
          mode: "paper",
          capitalPerTrade: 1000, 
          maxOpenTrades: 5,
          slMultiplier: 0.8,
          tpMultiplier: 1.0,
          maxLossPct: -15,
          brainType: "adaptive",
          segment: "ALL",
          coinList: "[]"
        }
      });

      // Create initial BotState
      await prisma.botState.create({
        data: {
          botId: bot.id,
          engineStatus: "idle",
          cycleCount: 0
        }
      });
    }
  }

  console.log("✅ Successfully reseeded all bots! All users are fresh.");
}

main()
  .catch((e) => {
    console.error("❌ Fatal Error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

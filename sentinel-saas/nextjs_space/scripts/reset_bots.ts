import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log("Wiping all bots...");
  await prisma.botState.deleteMany();
  await prisma.botConfig.deleteMany();
  await prisma.bot.deleteMany();

  console.log("Fetching users...");
  const users = await prisma.user.findMany();

  const templates = [
      { name: "Titan (Slow)",          mode: "paper", maxTrades: 5,  capital: 100, segment: "ALL" },
      { name: "Vanguard (Moderate)",   mode: "paper", maxTrades: 5,  capital: 100, segment: "ALL" },
      { name: "Rogue (Aggressive)",    mode: "paper", maxTrades: 5,  capital: 100, segment: "ALL" },
      { name: "Pyxis (Systematic) Paper", mode: "paper", maxTrades: 3, capital: 100, segment: "ALL" },
      { name: "Axiom (Momentum) Paper",   mode: "paper", maxTrades: 5, capital: 100, segment: "ALL" },
      { name: "Ratio (Stat Arb) Paper",   mode: "paper", maxTrades: 4, capital: 100, segment: "ALL" },
  ];

  let created = 0;
  for (const user of users) {
      for (const t of templates) {
          const bot = await prisma.bot.create({
              data: {
                  userId: user.id,
                  name: t.name,
                  exchange: "coindcx",
                  status: "running",
                  isActive: true,
              }
          });
          await prisma.botConfig.create({
              data: {
                  botId: bot.id,
                  mode: t.mode,
                  capitalPerTrade: t.capital,
                  maxOpenTrades: t.maxTrades,
                  slMultiplier: 0.8,
                  tpMultiplier: 1.0,
                  maxLossPct: -15,
                  brainType: "adaptive",
                  segment: t.segment,
                  coinList: "[]"
              }
          });
          await prisma.botState.create({
              data: { botId: bot.id, engineStatus: "running", cycleCount: 0 }
          });
          created++;
      }
  }
  console.log(`Created ${created} paper bots across ${users.length} users.`);
}
main().catch(console.error).finally(() => prisma.$disconnect());

const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgresql://postgres:ubQTkzHaYpuSzXcSlWcMeakRjALoBmDq@shuttle.proxy.rlwy.net:29302/railway'
});

async function main() {
  await client.connect();
  const res = await client.query('SELECT coin, "entryPrice", status, "activePnl", regime FROM "Trade" ORDER BY "createdAt" DESC LIMIT 5');
  console.log("Recent Trades:", JSON.stringify(res.rows, null, 2));

  const bs = await client.query('SELECT "botId", "coinStates" FROM "BotState" ORDER BY "updatedAt" DESC LIMIT 5');
  console.log("Recent BotStates:", JSON.stringify(bs.rows, null, 2));
  await client.end();
}
main().catch(console.error);

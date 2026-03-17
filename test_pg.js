const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgresql://postgres:ubQTkzHaYpuSzXcSlWcMeakRjALoBmDq@shuttle.proxy.rlwy.net:29302/railway'
});

async function main() {
  await client.connect();
  const res = await client.query('SELECT id, symbol, status, "engineOutput" FROM "Trade" ORDER BY "createdAt" DESC LIMIT 5');
  console.log(JSON.stringify(res.rows, null, 2));
  await client.end();
}
main().catch(console.error);

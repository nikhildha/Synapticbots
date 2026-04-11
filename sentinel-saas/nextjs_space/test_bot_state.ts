import { GET } from './app/api/bot-state/route';

async function run() {
  const req = new Request('http://localhost:3000/api/bot-state');
  const res = await GET(req as any);
  const data = await res.json();
  console.log("Total Engine Trades in API:", data.tradebook.summary.total_trades);
  console.log("Unique DB Trades per Bot:", Object.keys(data.tradesByBot).map(k => data.tradesByBot[k].length));
}
run();

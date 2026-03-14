import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";

import fs from "fs";
import path from "path";

// ── SIGNAL BYPASS API ──────────────────────────────────────────────────
// EXPERIMENT ONLY — remove this file when done with bypass testing.
//
// Reads/writes data/bypass_state.json which is picked up by the Python
// engine every 5-min cycle. No engine restart required.
// ───────────────────────────────────────────────────────────────────────

const BYPASS_FILE = process.env.BYPASS_STATE_PATH
  || path.join(process.cwd(), "..", "data", "bypass_state.json");

function readBypassState() {
  try {
    if (fs.existsSync(BYPASS_FILE)) {
      return JSON.parse(fs.readFileSync(BYPASS_FILE, "utf-8"));
    }
  } catch {}
  return { bypass_enabled: false, bypass_symbol: "BTCUSDT", bypass_side: "BUY", bypass_segment: "layer1", bypass_conviction: 65 };
}

// GET → return current bypass state
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  return NextResponse.json(readBypassState());
}

// POST → update bypass state
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const body = await req.json();
  const current = readBypassState();
  const updated = { ...current, ...body };
  try {
    const dir = path.dirname(BYPASS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(BYPASS_FILE, JSON.stringify(updated, null, 2));
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, state: updated });
}

import { NextResponse } from 'next/server'
import { getBotState } from '@/lib/data'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  try {
    const state = getBotState()
    return NextResponse.json({
      symbol: state.symbol ?? 'BTCUSDT',
      regime: state.regime ?? 'UNKNOWN',
      confidence: state.confidence ?? 0,
      action: state.action ?? '',
      trade_count: state.trade_count ?? 0,
      paper_mode: state.paper_mode ?? true,
      timestamp: state.timestamp ?? new Date().toISOString(),
    })
  } catch (err) {
    return NextResponse.json({ regime: 'UNKNOWN', confidence: 0, error: String(err) }, { status: 200 })
  }
}

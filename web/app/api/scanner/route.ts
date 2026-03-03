import { NextResponse } from 'next/server'
import { getScannerState, getMultiState } from '@/lib/data'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  try {
    const scanner = getScannerState()
    const multi = getMultiState()

    // Merge coin_states from scanner + multi_state
    const coinStates = {
      ...(scanner.coin_states ?? {}),
      ...(multi.coin_states ?? {}),
    }

    // Build a clean array of top coins for the landing page heatmap
    const coins = Object.entries(coinStates)
      .map(([symbol, state]) => ({
        symbol: symbol.replace('USDT', ''),
        regime: state.regime ?? 'UNKNOWN',
        confidence: state.confidence ?? 0,
        action: state.action ?? '',
      }))
      .filter((c) => c.regime !== 'UNKNOWN')
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 15)

    return NextResponse.json({
      coins,
      coin_states: coinStates,
      total_scanned: Object.keys(coinStates).length,
      timestamp: scanner.timestamp ?? new Date().toISOString(),
    })
  } catch (err) {
    return NextResponse.json({ coins: [], coin_states: {}, error: String(err) }, { status: 200 })
  }
}

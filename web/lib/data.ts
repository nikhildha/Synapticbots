import fs from 'fs'
import path from 'path'

const DATA_DIR = path.join(process.cwd(), '..', 'data')

function readJson<T>(filename: string, fallback: T): T {
  try {
    const filePath = path.join(DATA_DIR, filename)
    if (!fs.existsSync(filePath)) return fallback
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T
  } catch {
    return fallback
  }
}

export interface BotState {
  timestamp?: string
  symbol?: string
  regime?: string
  confidence?: number
  action?: string
  trade_count?: number
  paper_mode?: boolean
}

export interface CoinState {
  regime: string
  confidence: number
  timestamp?: string
  trend?: string
  action?: string
}

export interface MultiState {
  timestamp?: string
  cycle?: number
  coins_scanned?: number
  eligible_count?: number
  deployed_count?: number
  total_trades?: number
  active_positions?: Record<string, CoinState>
  coin_states?: Record<string, CoinState>
}

export interface ScannerState {
  timestamp?: string
  coins?: Array<{ symbol: string; regime: string; confidence: number }>
  coin_states?: Record<string, CoinState>
}

export function getBotState(): BotState {
  return readJson<BotState>('bot_state.json', {})
}

export function getMultiState(): MultiState {
  return readJson<MultiState>('multi_bot_state.json', {})
}

export function getScannerState(): ScannerState {
  return readJson<ScannerState>('scanner_state.json', {})
}

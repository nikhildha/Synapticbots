import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount)
}

export function regimeClass(regime: string): string {
  const r = regime?.toUpperCase() ?? ''
  if (r === 'BULLISH') return 'regime-bull'
  if (r === 'BEARISH') return 'regime-bear'
  if (r.includes('CHOP') || r.includes('SIDEWAYS')) return 'regime-chop'
  if (r.includes('CRASH') || r.includes('PANIC')) return 'regime-crash'
  return 'regime-chop'
}

export function regimeDotClass(regime: string): string {
  const r = regime?.toUpperCase() ?? ''
  if (r === 'BULLISH') return 'dot-bull'
  if (r === 'BEARISH') return 'dot-bear'
  if (r.includes('CHOP') || r.includes('SIDEWAYS')) return 'dot-chop'
  if (r.includes('CRASH') || r.includes('PANIC')) return 'dot-crash'
  return 'dot-chop'
}

export function regimeLabel(regime: string): string {
  const r = regime?.toUpperCase() ?? ''
  if (r === 'BULLISH') return 'BULL'
  if (r === 'BEARISH') return 'BEAR'
  if (r.includes('CHOP') || r.includes('SIDEWAYS')) return 'CHOP'
  if (r.includes('CRASH') || r.includes('PANIC')) return 'CRASH'
  return regime || '—'
}

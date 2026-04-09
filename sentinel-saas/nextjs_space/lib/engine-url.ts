/**
 * Dual-engine URL resolver.
 * Routes API calls to the correct engine based on trading mode.
 *
 * - ENGINE_API_URL       → live engine (CoinDCX, real orders)
 * - ENGINE_API_URL_PAPER → paper engine (simulated trades)
 *
 * Falls back to ENGINE_API_URL if paper URL is not configured.
 */

const LIVE_URL = process.env.ENGINE_API_URL || process.env.PYTHON_ENGINE_URL || '';
// Revert M1 FIX: In the current single-engine infrastructure, PAPER trades and LIVE trades
// are served from the same Engine API. Removing the fallback broke the dashboard sync
// because ENGINE_API_URL_PAPER is not set in Railway.
const PAPER_URL = process.env.ENGINE_API_URL_PAPER || LIVE_URL;

export type EngineMode = 'live' | 'paper';

/**
 * Get the engine URL for the given mode.
 * @param mode - 'live' or 'paper' (default: 'live')
 */
export function getEngineUrl(mode: EngineMode = 'live'): string {
    return mode === 'paper' ? PAPER_URL : LIVE_URL;
}

/**
 * Get both engine URLs (for admin operations that need to talk to both).
 */
export function getAllEngineUrls(): { live: string; paper: string } {
    return { live: LIVE_URL, paper: PAPER_URL };
}

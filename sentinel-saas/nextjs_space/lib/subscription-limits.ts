// ─── Subscription Tier Limits ───────────────────────────────────────────────
// Central config for feature gating based on subscription tier.

export type TierName = 'free' | 'pro' | 'ultra';

export interface TierLimits {
    maxBots: number;
    coinScans: number;
    exportCSV: boolean;
    manualClose: boolean;
    apiAccess: boolean;
    customBots: boolean;
    label: string;
}

export const TIER_LIMITS: Record<TierName, TierLimits> = {
    free: {
        maxBots: 1,
        coinScans: 5,
        exportCSV: false,
        manualClose: false,
        apiAccess: false,
        customBots: false,
        label: 'Free Trial',
    },
    pro: {
        maxBots: 3,
        coinScans: 15,
        exportCSV: true,
        manualClose: true,
        apiAccess: false,
        customBots: false,
        label: 'Pro',
    },
    ultra: {
        maxBots: 10,
        coinScans: 50,
        exportCSV: true,
        manualClose: true,
        apiAccess: true,
        customBots: true,
        label: 'Ultra',
    },
};

export function getTierLimits(tier?: string | null): TierLimits {
    return TIER_LIMITS[(tier || 'free') as TierName] || TIER_LIMITS.free;
}

// M7 FIX: God account referral code from env var (not hardcoded)
export const GOD_REFERRAL_CODE = process.env.GOD_REFERRAL_CODE || '';

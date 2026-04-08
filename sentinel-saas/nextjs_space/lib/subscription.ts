/**
 * Subscription & tier enforcement utilities
 * Used across all protected API routes and pages
 */

import prisma from './prisma';

// ─── Tier Limits ────────────────────────────────────────────────────────────

export const TIER_LIMITS = {
    free: {
        maxBots: 1,
        maxCoinScans: 5,
        exchanges: 1,
        liveTrading: false,
        csvExport: false,
        telegramAlerts: false,
        trailingSl: false,
        killSwitch: false,
        apiAccess: false,
        multiBotMgmt: false,
    },
    pro: {
        maxBots: 1,
        maxCoinScans: 15,
        exchanges: 1,
        liveTrading: true,
        csvExport: true,
        telegramAlerts: true,
        trailingSl: true,
        killSwitch: true,
        apiAccess: false,
        multiBotMgmt: false,
    },
    ultra: {
        maxBots: 1,
        maxCoinScans: 50,
        exchanges: 2,
        liveTrading: true,
        csvExport: true,
        telegramAlerts: true,
        trailingSl: true,
        killSwitch: true,
        apiAccess: true,
        multiBotMgmt: false,
    },
} as const;

export type Tier = keyof typeof TIER_LIMITS;

// ─── Subscription Status Check ──────────────────────────────────────────────

export interface SubscriptionStatus {
    isActive: boolean;
    isExpired: boolean;
    tier: Tier;
    daysRemaining: number | null;
    expiresAt: Date | null;
    message: string;
}

/**
 * Checks the subscription status for a user.
 * Returns whether access should be allowed and the current tier.
 */
export async function checkSubscription(userId: string): Promise<SubscriptionStatus> {
    const sub = await prisma.subscription.findUnique({
        where: { userId },
    });

    // No subscription record
    if (!sub) {
        // Bypass subscription check ONLY for local development / admin
        if (process.env.NODE_ENV === 'development') {
            return {
                isActive: true,
                isExpired: false,
                tier: 'ultra',
                daysRemaining: 999,
                expiresAt: null,
                message: 'Local Admin Bypass — Ultra Tier Active',
            };
        }

        return {
            isActive: false,
            isExpired: true,
            tier: 'free',
            daysRemaining: 0,
            expiresAt: null,
            message: 'No subscription found. Please sign up for a plan.',
        };
    }

    const now = new Date();

    // ─── Trial users ────────────────────────
    if (sub.status === 'trial') {
        if (sub.trialEndsAt && sub.trialEndsAt > now) {
            const daysRemaining = Math.ceil(
                (sub.trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
            );
            return {
                isActive: true,
                isExpired: false,
                tier: 'free',
                daysRemaining,
                expiresAt: sub.trialEndsAt,
                message: `Free trial — ${daysRemaining} day${daysRemaining === 1 ? '' : 's'} remaining`,
            };
        }
        // Trial expired
        return {
            isActive: false,
            isExpired: true,
            tier: 'free',
            daysRemaining: 0,
            expiresAt: sub.trialEndsAt,
            message: 'Your free trial has expired. Upgrade to continue.',
        };
    }

    // ─── Active paid plans ──────────────────
    if (sub.status === 'active') {
        const tier = (sub.tier as Tier) || 'free';
        // No expiry (e.g. god account) = forever active
        if (!sub.currentPeriodEnd) {
            return {
                isActive: true,
                isExpired: false,
                tier,
                daysRemaining: null,
                expiresAt: null,
                message: `${tier.charAt(0).toUpperCase() + tier.slice(1)} plan — Lifetime access`,
            };
        }
        if (sub.currentPeriodEnd > now) {
            const daysRemaining = Math.ceil(
                (sub.currentPeriodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
            );
            return {
                isActive: true,
                isExpired: false,
                tier,
                daysRemaining,
                expiresAt: sub.currentPeriodEnd,
                message: `${tier.charAt(0).toUpperCase() + tier.slice(1)} plan — ${daysRemaining} day${daysRemaining === 1 ? '' : 's'} remaining`,
            };
        }
        // Period ended — mark as expired
        return {
            isActive: false,
            isExpired: true,
            tier,
            daysRemaining: 0,
            expiresAt: sub.currentPeriodEnd,
            message: 'Your subscription has expired. Please renew.',
        };
    }

    // ─── Expired / Cancelled ────────────────
    return {
        isActive: false,
        isExpired: true,
        tier: (sub.tier as Tier) || 'free',
        daysRemaining: 0,
        expiresAt: sub.currentPeriodEnd || sub.trialEndsAt,
        message: sub.status === 'cancelled'
            ? 'Your subscription was cancelled.'
            : 'Your subscription has expired. Please renew.',
    };
}

/**
 * Quick boolean check — can the user access the platform?
 */
export async function isSubscriptionActive(userId: string): Promise<boolean> {
    const status = await checkSubscription(userId);
    return status.isActive;
}

/**
 * Get the tier limits for a user
 */
export async function getUserTierLimits(userId: string) {
    const status = await checkSubscription(userId);
    return {
        ...TIER_LIMITS[status.tier],
        tier: status.tier,
        isActive: status.isActive,
        message: status.message,
    };
}

/**
 * Check if a specific feature is available for the user's tier
 */
export async function hasFeature(
    userId: string,
    feature: keyof typeof TIER_LIMITS.free
): Promise<boolean> {
    const status = await checkSubscription(userId);
    if (!status.isActive) return false;
    return !!TIER_LIMITS[status.tier][feature];
}

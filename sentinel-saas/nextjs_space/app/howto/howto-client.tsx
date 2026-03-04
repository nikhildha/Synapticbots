'use client';

import { Header } from '@/components/header';
import { motion } from 'framer-motion';
import {
    Rocket, Bot, BarChart3, TrendingUp, Shield, Eye,
    Settings, Zap, BookOpen, Target, ArrowRight, CheckCircle,
    AlertTriangle, Brain, LineChart, DollarSign, Activity,
} from 'lucide-react';
import Link from 'next/link';

/* ═══ Animation Variants ═══ */
const fadeUp = {
    hidden: { opacity: 0, y: 30 },
    visible: (i: number) => ({
        opacity: 1, y: 0,
        transition: { delay: i * 0.08, duration: 0.5, ease: [0.22, 1, 0.36, 1] },
    }),
};

const stagger = {
    visible: { transition: { staggerChildren: 0.06 } },
};

/* ═══ Styled Components ═══ */
function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
    return (
        <div className={className} style={{
            background: 'rgba(17, 24, 39, 0.8)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: '16px',
            padding: '24px',
        }}>{children}</div>
    );
}

function StepNumber({ n }: { n: number }) {
    return (
        <div style={{
            width: '36px', height: '36px', borderRadius: '50%',
            background: 'linear-gradient(135deg, #0891B2 0%, #06B6D4 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '15px', fontWeight: 700, color: '#fff',
            boxShadow: '0 0 20px rgba(8,145,178,0.3)',
            flexShrink: 0,
        }}>{n}</div>
    );
}

/* ═══ STEP DATA ═══ */
const steps = [
    {
        title: 'Create Your Account',
        icon: <Rocket className="w-5 h-5" />,
        color: '#22C55E',
        description: 'Sign up with your name, email, mobile number, and password. Choose a plan (Free Trial, Pro, or Ultra) on the pricing page.',
        tips: [
            'Free Trial gives you 14 days with 5 coin scans and 1 bot',
            'Use a referral code if you have one for special access',
            'Your account is secured with encrypted passwords',
        ],
        link: { href: '/pricing', label: 'View Plans' },
    },
    {
        title: 'Deploy Your First Bot',
        icon: <Bot className="w-5 h-5" />,
        color: '#0891B2',
        description: 'Navigate to the Bots page and create a new bot. Configure it with your preferred exchange (Binance) and trading mode (Paper or Live).',
        tips: [
            'Start with Paper mode — zero risk, real market data',
            'Set your capital per trade, max open positions, and leverage tiers',
            'The bot uses HMM (Hidden Markov Models) to detect market regimes',
        ],
        link: { href: '/bots', label: 'Go to Bots' },
    },
    {
        title: 'Configure Bot Settings',
        icon: <Settings className="w-5 h-5" />,
        color: '#F59E0B',
        description: 'Fine-tune your bot\'s parameters: coin watchlist, risk management (SL/TP multipliers), multi-target exits (T1/T2/T3), and trailing stop-loss.',
        tips: [
            'ATR-based stop-loss adapts to market volatility',
            'Multi-target exits book partial profits at T1 (25%), T2 (50%), and let T3 run',
            'Capital protection kicks in after T1 hits — locks in breakeven',
        ],
        link: null,
    },
    {
        title: 'Monitor the Dashboard',
        icon: <Activity className="w-5 h-5" />,
        color: '#06B6D4',
        description: 'Your dashboard shows live stats: active PNL, win rate, BTC regime, market sentiment, and all open positions refreshing every 15 seconds.',
        tips: [
            'The BTC Regime card shows current market state (Bullish/Bearish/Sideways)',
            'Paper vs Live PNL are tracked separately for clean performance analysis',
            'Recent Trades table shows your latest 10 entries with live PNL',
        ],
        link: { href: '/dashboard', label: 'Dashboard' },
    },
    {
        title: 'Check Trade Journal',
        icon: <BookOpen className="w-5 h-5" />,
        color: '#8B5CF6',
        description: 'The Tradebook page gives you a full history of all trades — active, closed, and cancelled. Filter by status, coin, or mode.',
        tips: [
            'View entry/exit prices, PNL %, exit reason (SL, T1, T2, T3)',
            'P&L Timeline chart shows your cumulative performance vs BTC price',
            'Bot Performance section shows win rate, profit factor, risk/reward, max drawdown',
        ],
        link: { href: '/trades', label: 'Tradebook' },
    },
    {
        title: 'Close Trades Manually',
        icon: <Target className="w-5 h-5" />,
        color: '#EF4444',
        description: 'You can manually close any active trade from the Tradebook. Use "Book Profit" (green) when in profit, or "Close" (red) to cut losses.',
        tips: [
            'Available for both Paper and Live trades (Pro/Ultra only)',
            'PNL is calculated including commissions and funding costs',
            'Closed trades immediately appear in your trade journal',
        ],
        link: null,
    },
    {
        title: 'Market Intelligence',
        icon: <Brain className="w-5 h-5" />,
        color: '#0891B2',
        description: 'The Intelligence page gives institutional-grade market analysis: sentiment scores, order flow, funding rates, and regime drivers for all tracked coins.',
        tips: [
            'Sentiment Bias uses VADER NLP across crypto news sources',
            'Funding Rates identify overleveraged positions (contrarian signals)',
            'Regime Drivers Heatmap shows HMM features (volatility, RSI, log return)',
        ],
        link: { href: '/intelligence', label: 'Intelligence' },
    },
    {
        title: 'Upgrade Your Plan',
        icon: <DollarSign className="w-5 h-5" />,
        color: '#22C55E',
        description: 'Upgrade to Pro or Ultra for more bots, coin scans, live trading, CSV export, and API access. Payment is handled securely via Razorpay.',
        tips: [
            'Pro: 3 bots, 15 coin scans, live trading, CSV export',
            'Ultra: Unlimited bots, 50 coin scans, API access, priority support',
            'Upgrade anytime from the Pricing page',
        ],
        link: { href: '/pricing', label: 'Pricing' },
    },
];

const proTips = [
    { icon: <Zap className="w-4 h-4" />, tip: 'Start with Paper mode for at least 2 weeks before going Live' },
    { icon: <Shield className="w-4 h-4" />, tip: 'Never risk more than 2-5% of your total capital per trade' },
    { icon: <Eye className="w-4 h-4" />, tip: 'Check the BTC Regime card before deploying — avoid trading in Sideways/Chop' },
    { icon: <TrendingUp className="w-4 h-4" />, tip: 'Use multi-target exits (T1/T2/T3) to lock in profits while letting winners run' },
    { icon: <AlertTriangle className="w-4 h-4" />, tip: 'Monitor funding rates — extreme values often signal reversals' },
    { icon: <LineChart className="w-4 h-4" />, tip: 'Review your P&L Timeline weekly to identify patterns in winning vs losing trades' },
];

/* ═══ MAIN COMPONENT ═══ */
export function HowToClient() {
    return (
        <div className="min-h-screen">
            <Header />
            <main className="pt-24 pb-16 px-4">
                <div className="max-w-4xl mx-auto">

                    {/* ─── Hero ─── */}
                    <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
                        <div className="text-center mb-12">
                            <div style={{
                                display: 'inline-flex', alignItems: 'center', gap: '8px',
                                padding: '6px 16px', borderRadius: '20px',
                                background: 'rgba(8,145,178,0.12)', border: '1px solid rgba(8,145,178,0.3)',
                                fontSize: '12px', fontWeight: 600, color: '#06B6D4',
                                marginBottom: '16px',
                            }}>
                                <BookOpen className="w-4 h-4" /> GETTING STARTED GUIDE
                            </div>
                            <h1 style={{ fontSize: '36px', fontWeight: 700, color: '#0891B2', marginBottom: '8px' }}>
                                How to Use Sentinel
                            </h1>
                            <p style={{ fontSize: '16px', color: '#6B7280', maxWidth: '600px', margin: '0 auto' }}>
                                Your step-by-step guide to deploying AI-powered crypto trading bots,
                                monitoring trades, and maximizing your performance.
                            </p>
                        </div>
                    </motion.div>

                    {/* ─── Steps ─── */}
                    <motion.div variants={stagger} initial="hidden" animate="visible">
                        {steps.map((step, i) => (
                            <motion.div key={step.title} custom={i} variants={fadeUp} className="mb-6">
                                <Card>
                                    <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                                        <StepNumber n={i + 1} />
                                        <div style={{ flex: 1 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                                                <div style={{
                                                    width: '32px', height: '32px', borderRadius: '10px',
                                                    background: step.color + '18',
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    color: step.color,
                                                }}>{step.icon}</div>
                                                <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#F0F4F8', margin: 0 }}>{step.title}</h2>
                                            </div>
                                            <p style={{ fontSize: '14px', color: '#9CA3AF', marginBottom: '12px', lineHeight: 1.6 }}>
                                                {step.description}
                                            </p>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                {step.tips.map((tip, j) => (
                                                    <div key={j} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                                                        <CheckCircle className="w-4 h-4 flex-shrink-0" style={{ color: step.color, marginTop: '2px' }} />
                                                        <span style={{ fontSize: '13px', color: '#D1D5DB' }}>{tip}</span>
                                                    </div>
                                                ))}
                                            </div>
                                            {step.link && (
                                                <Link href={step.link.href} style={{
                                                    display: 'inline-flex', alignItems: 'center', gap: '6px',
                                                    marginTop: '14px', padding: '8px 16px', borderRadius: '10px',
                                                    background: step.color + '15', color: step.color,
                                                    fontSize: '13px', fontWeight: 600, textDecoration: 'none',
                                                    border: `1px solid ${step.color}30`,
                                                    transition: 'all 0.2s',
                                                }}>
                                                    {step.link.label} <ArrowRight className="w-4 h-4" />
                                                </Link>
                                            )}
                                        </div>
                                    </div>
                                </Card>
                            </motion.div>
                        ))}
                    </motion.div>

                    {/* ─── Pro Tips ─── */}
                    <motion.div
                        initial={{ opacity: 0, y: 30 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.6, duration: 0.5 }}
                        className="mt-12"
                    >
                        <div style={{
                            background: 'rgba(17, 24, 39, 0.85)', backdropFilter: 'blur(16px)',
                            border: '1px solid rgba(245,158,11,0.2)', borderRadius: '16px', overflow: 'hidden',
                        }}>
                            <div style={{
                                padding: '18px 24px',
                                background: 'linear-gradient(135deg, rgba(245,158,11,0.08) 0%, rgba(8,145,178,0.06) 100%)',
                                borderBottom: '1px solid rgba(255,255,255,0.06)',
                            }}>
                                <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#F59E0B', margin: 0 }}>
                                    ⚡ Pro Tips
                                </h2>
                                <p style={{ fontSize: '12px', color: '#6B7280', marginTop: '4px' }}>
                                    Best practices from experienced Sentinel traders
                                </p>
                            </div>
                            <div style={{ padding: '20px 24px', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '14px' }}>
                                {proTips.map((tip, i) => (
                                    <motion.div
                                        key={i}
                                        initial={{ opacity: 0, x: -10 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        transition={{ delay: 0.7 + i * 0.06 }}
                                        style={{
                                            display: 'flex', alignItems: 'flex-start', gap: '10px',
                                            padding: '12px 14px', borderRadius: '10px',
                                            background: 'rgba(255,255,255,0.02)',
                                            border: '1px solid rgba(255,255,255,0.04)',
                                        }}
                                    >
                                        <div style={{
                                            width: '28px', height: '28px', borderRadius: '8px',
                                            background: 'rgba(245,158,11,0.12)',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            color: '#F59E0B', flexShrink: 0,
                                        }}>{tip.icon}</div>
                                        <span style={{ fontSize: '13px', color: '#D1D5DB', lineHeight: 1.5 }}>{tip.tip}</span>
                                    </motion.div>
                                ))}
                            </div>
                        </div>
                    </motion.div>

                    {/* ─── CTA ─── */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.8, duration: 0.5 }}
                        className="mt-12 text-center"
                    >
                        <Card>
                            <div style={{ textAlign: 'center', padding: '20px 0' }}>
                                <h3 style={{ fontSize: '22px', fontWeight: 700, color: '#F0F4F8', marginBottom: '8px' }}>
                                    Ready to Start Trading?
                                </h3>
                                <p style={{ fontSize: '14px', color: '#6B7280', marginBottom: '20px' }}>
                                    Deploy your first bot and let Sentinel&apos;s HMM engine find opportunities for you.
                                </p>
                                <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                                    <Link href="/bots" style={{
                                        display: 'inline-flex', alignItems: 'center', gap: '8px',
                                        padding: '12px 24px', borderRadius: '12px',
                                        background: 'linear-gradient(135deg, #0891B2, #06B6D4)',
                                        color: '#fff', fontSize: '14px', fontWeight: 600,
                                        textDecoration: 'none', boxShadow: '0 4px 15px rgba(8,145,178,0.3)',
                                    }}>
                                        <Bot className="w-5 h-5" /> Deploy a Bot
                                    </Link>
                                    <Link href="/dashboard" style={{
                                        display: 'inline-flex', alignItems: 'center', gap: '8px',
                                        padding: '12px 24px', borderRadius: '12px',
                                        background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                                        color: '#D1D5DB', fontSize: '14px', fontWeight: 600,
                                        textDecoration: 'none',
                                    }}>
                                        <BarChart3 className="w-5 h-5" /> Go to Dashboard
                                    </Link>
                                </div>
                            </div>
                        </Card>
                    </motion.div>

                </div>
            </main>
        </div>
    );
}

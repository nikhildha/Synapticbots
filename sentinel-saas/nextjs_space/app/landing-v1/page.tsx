'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

/**
 * DESIGN 1: DEEP SPACE
 * Dark navy + cyan aurora gradients + floating particles + glassmorphism cards
 */
export default function LandingV1() {
    const [mounted, setMounted] = useState(false);
    const [particles] = useState(() =>
        Array.from({ length: 40 }, (_, i) => ({
            x: Math.random() * 100,
            y: Math.random() * 100,
            size: 1 + Math.random() * 3,
            dur: 3 + Math.random() * 4,
            delay: Math.random() * 3,
        }))
    );

    useEffect(() => { setMounted(true); }, []);
    if (!mounted) return null;

    return (
        <div style={{
            minHeight: '100vh',
            background: 'linear-gradient(180deg, #020817 0%, #0A1628 30%, #071420 60%, #020817 100%)',
            color: '#F9FAFB',
            fontFamily: "'Inter', -apple-system, sans-serif",
            overflow: 'hidden', position: 'relative',
        }}>
            {/* Background image */}
            <div style={{
                position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none',
                backgroundImage: 'url(/bg-deep-space.png)',
                backgroundSize: 'cover', backgroundPosition: 'center top',
                opacity: 0.7,
            }} />

            {/* Aurora background */}
            <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
                <div style={{
                    position: 'absolute', top: '-20%', left: '10%', width: '60%', height: '50%',
                    background: 'radial-gradient(ellipse, rgba(6,182,212,0.08) 0%, transparent 70%)',
                    filter: 'blur(80px)',
                }} />
                <div style={{
                    position: 'absolute', top: '30%', right: '5%', width: '40%', height: '40%',
                    background: 'radial-gradient(ellipse, rgba(59,130,246,0.06) 0%, transparent 70%)',
                    filter: 'blur(80px)',
                }} />
                <div style={{
                    position: 'absolute', bottom: '0%', left: '30%', width: '50%', height: '30%',
                    background: 'radial-gradient(ellipse, rgba(139,92,246,0.05) 0%, transparent 70%)',
                    filter: 'blur(80px)',
                }} />
                {/* Floating particles */}
                <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
                    {particles.map((p, i) => (
                        <circle key={i} cx={`${p.x}%`} cy={`${p.y}%`} r={p.size} fill="#06B6D4" opacity="0">
                            <animate attributeName="opacity" values="0;0.4;0" dur={`${p.dur}s`} begin={`${p.delay}s`} repeatCount="indefinite" />
                        </circle>
                    ))}
                </svg>
            </div>

            {/* Nav */}
            <nav style={{
                position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50,
                padding: '16px 40px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                background: 'rgba(2,8,23,0.7)', backdropFilter: 'blur(20px)',
                borderBottom: '1px solid rgba(6,182,212,0.1)',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{
                        width: '36px', height: '36px', borderRadius: '10px',
                        background: 'linear-gradient(135deg, #06B6D4, #3B82F6)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '18px', fontWeight: 900, color: '#020817',
                    }}>S</div>
                    <span style={{ fontSize: '20px', fontWeight: 800, color: '#F9FAFB', letterSpacing: '-0.5px' }}>Synaptic</span>
                </div>
                <div style={{ display: 'flex', gap: '32px', alignItems: 'center' }}>
                    <a href="#features" style={{ fontSize: '14px', color: '#9CA3AF', textDecoration: 'none', fontWeight: 500 }}>Features</a>
                    <a href="#how" style={{ fontSize: '14px', color: '#9CA3AF', textDecoration: 'none', fontWeight: 500 }}>How It Works</a>
                    <Link href="/pricing" style={{ fontSize: '14px', color: '#9CA3AF', textDecoration: 'none', fontWeight: 500 }}>Pricing</Link>
                    <Link href="/login" style={{
                        padding: '8px 20px', borderRadius: '10px', fontSize: '14px', fontWeight: 600,
                        background: 'linear-gradient(135deg, #06B6D4, #3B82F6)', color: '#020817',
                        textDecoration: 'none',
                    }}>Launch App</Link>
                </div>
            </nav>

            {/* Hero */}
            <section style={{ position: 'relative', zIndex: 1, paddingTop: '160px', paddingBottom: '100px', textAlign: 'center' }}>
                <motion.div initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8 }}>
                    <div style={{
                        display: 'inline-block', padding: '6px 20px', borderRadius: '20px', marginBottom: '20px',
                        background: 'rgba(6,182,212,0.1)', border: '1px solid rgba(6,182,212,0.2)',
                        fontSize: '13px', fontWeight: 600, color: '#06B6D4', letterSpacing: '0.5px',
                    }}>
                        🏛️ Powered by Athena AI + HMM Regime Detection
                    </div>
                    <h1 style={{
                        fontSize: '72px', fontWeight: 900, lineHeight: 1.05, maxWidth: '900px', margin: '0 auto 24px',
                        background: 'linear-gradient(135deg, #F9FAFB 0%, #06B6D4 50%, #3B82F6 100%)',
                        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                        letterSpacing: '-2px',
                    }}>
                        Institutional-Grade Crypto Intelligence
                    </h1>
                    <p style={{ fontSize: '20px', color: '#9CA3AF', maxWidth: '600px', margin: '0 auto 36px', lineHeight: 1.6 }}>
                        AI agents that detect market regimes, validate trade signals, and execute with conviction — so you don't have to stare at charts all day.
                    </p>
                    <div style={{ display: 'flex', gap: '16px', justifyContent: 'center' }}>
                        <Link href="/signup" style={{
                            padding: '16px 40px', borderRadius: '14px', fontSize: '17px', fontWeight: 700,
                            background: 'linear-gradient(135deg, #06B6D4, #3B82F6)', color: '#020817',
                            textDecoration: 'none', boxShadow: '0 0 40px rgba(6,182,212,0.3)',
                        }}>Start 14-Day Free Trial</Link>
                        <Link href="/pricing" style={{
                            padding: '16px 40px', borderRadius: '14px', fontSize: '17px', fontWeight: 700,
                            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                            color: '#F9FAFB', textDecoration: 'none',
                        }}>View Pricing</Link>
                    </div>
                </motion.div>

                {/* Trust bar */}
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
                    style={{ display: 'flex', justifyContent: 'center', gap: '40px', marginTop: '60px' }}>
                    {[
                        { val: '15+', label: 'Coins Scanned' },
                        { val: '24/7', label: 'Autonomous' },
                        { val: '<50ms', label: 'Signal Latency' },
                        { val: 'Gemini', label: 'AI Backbone' },
                    ].map((s, i) => (
                        <div key={i} style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '28px', fontWeight: 800, color: '#06B6D4' }}>{s.val}</div>
                            <div style={{ fontSize: '12px', color: '#6B7280', fontWeight: 500 }}>{s.label}</div>
                        </div>
                    ))}
                </motion.div>
            </section>

            {/* Features */}
            <section id="features" style={{ position: 'relative', zIndex: 1, padding: '80px 40px' }}>
                <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
                    <h2 style={{ fontSize: '40px', fontWeight: 800, textAlign: 'center', marginBottom: '12px', color: '#F9FAFB' }}>
                        Your AI Trading Team
                    </h2>
                    <p style={{ textAlign: 'center', color: '#9CA3AF', marginBottom: '48px', fontSize: '16px' }}>
                        Every trade goes through multiple layers of intelligence
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '24px' }}>
                        {[
                            { icon: '📊', title: 'HMM Regime Detection', desc: 'Hidden Markov Models identify whether BTC is bullish, bearish, or ranging — before price confirms it.', color: '#06B6D4' },
                            { icon: '🏛️', title: 'Athena AI Reasoning', desc: 'Gemini-powered LLM validates every signal with macro analysis, conviction scoring, and risk assessment.', color: '#A78BFA' },
                            { icon: '⚡', title: 'Autonomous Execution', desc: 'Approved trades execute instantly on Binance with ATR-based stop-loss and dynamic position sizing.', color: '#22C55E' },
                            { icon: '🔄', title: 'Multi-Coin Scanning', desc: 'Continuously scans 15+ coins per cycle, ranking opportunities by conviction and regime alignment.', color: '#F59E0B' },
                            { icon: '🛡️', title: 'Veto Protection', desc: 'Athena can VETO risky trades even when technicals say BUY — saving you from false breakouts.', color: '#EF4444' },
                            { icon: '📈', title: 'Adaptive Strategy', desc: 'Strategy parameters shift based on market regime — aggressive in trends, conservative in chop.', color: '#3B82F6' },
                        ].map((f, i) => (
                            <motion.div key={i} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true }} transition={{ delay: i * 0.1 }}
                                style={{
                                    padding: '28px', borderRadius: '16px',
                                    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                                    backdropFilter: 'blur(10px)',
                                }}>
                                <span style={{ fontSize: '32px', display: 'block', marginBottom: '12px' }}>{f.icon}</span>
                                <h3 style={{ fontSize: '18px', fontWeight: 700, color: f.color, marginBottom: '8px' }}>{f.title}</h3>
                                <p style={{ fontSize: '14px', color: '#9CA3AF', lineHeight: 1.6 }}>{f.desc}</p>
                            </motion.div>
                        ))}
                    </div>
                </div>
            </section>

            {/* How It Works */}
            <section id="how" style={{ position: 'relative', zIndex: 1, padding: '80px 40px' }}>
                <div style={{ maxWidth: '900px', margin: '0 auto' }}>
                    <h2 style={{ fontSize: '40px', fontWeight: 800, textAlign: 'center', marginBottom: '48px', color: '#F9FAFB' }}>
                        How Synaptic Works
                    </h2>
                    {[
                        { step: '01', title: 'Scan', desc: 'Engine scans 15+ coins across multiple timeframes every cycle', color: '#06B6D4' },
                        { step: '02', title: 'Analyze', desc: 'HMM detects regime + Athena AI validates with macro reasoning', color: '#A78BFA' },
                        { step: '03', title: 'Execute', desc: 'Approved trades deploy automatically with risk management', color: '#22C55E' },
                        { step: '04', title: 'Protect', desc: 'ATR-based stops, trailing profit, and Athena VETO protection', color: '#F59E0B' },
                    ].map((s, i) => (
                        <motion.div key={i} initial={{ opacity: 0, x: -30 }} whileInView={{ opacity: 1, x: 0 }}
                            viewport={{ once: true }} transition={{ delay: i * 0.15 }}
                            style={{
                                display: 'flex', alignItems: 'center', gap: '24px', marginBottom: '32px',
                                padding: '24px', borderRadius: '16px',
                                background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)',
                            }}>
                            <div style={{
                                fontSize: '32px', fontWeight: 900, color: s.color, fontFamily: 'monospace',
                                minWidth: '60px',
                            }}>{s.step}</div>
                            <div>
                                <h3 style={{ fontSize: '20px', fontWeight: 700, color: '#F9FAFB', marginBottom: '4px' }}>{s.title}</h3>
                                <p style={{ fontSize: '15px', color: '#9CA3AF' }}>{s.desc}</p>
                            </div>
                        </motion.div>
                    ))}
                </div>
            </section>

            {/* CTA */}
            <section style={{ position: 'relative', zIndex: 1, padding: '80px 40px' }}>
                <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
                    style={{
                        maxWidth: '800px', margin: '0 auto', textAlign: 'center', padding: '60px 40px',
                        borderRadius: '24px',
                        background: 'linear-gradient(135deg, rgba(6,182,212,0.1), rgba(59,130,246,0.05))',
                        border: '1px solid rgba(6,182,212,0.15)',
                    }}>
                    <h2 style={{ fontSize: '36px', fontWeight: 800, marginBottom: '16px', color: '#F9FAFB' }}>
                        Stop Watching Charts. Start Trading Smart.
                    </h2>
                    <p style={{ fontSize: '17px', color: '#9CA3AF', marginBottom: '32px' }}>
                        14-day free trial. No credit card required. Cancel anytime.
                    </p>
                    <Link href="/signup" style={{
                        padding: '16px 48px', borderRadius: '14px', fontSize: '17px', fontWeight: 700,
                        background: 'linear-gradient(135deg, #06B6D4, #3B82F6)', color: '#020817',
                        textDecoration: 'none', display: 'inline-block',
                        boxShadow: '0 0 40px rgba(6,182,212,0.25)',
                    }}>Get Started Free</Link>
                </motion.div>
            </section>

            {/* Footer */}
            <footer style={{
                position: 'relative', zIndex: 1, padding: '24px 40px',
                borderTop: '1px solid rgba(255,255,255,0.05)', textAlign: 'center',
                fontSize: '13px', color: '#4B5563',
            }}>
                © 2026 Synaptic Bots. All rights reserved.
            </footer>
        </div>
    );
}

'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

/**
 * DESIGN 3: MIDNIGHT GOLD
 * Pure black + gold accents + luxury/fintech aesthetic + clean typography
 */
export default function LandingV3() {
    const [mounted, setMounted] = useState(false);
    useEffect(() => { setMounted(true); }, []);
    if (!mounted) return null;

    return (
        <div style={{
            minHeight: '100vh',
            background: '#000000',
            color: '#F9FAFB',
            fontFamily: "'Inter', -apple-system, sans-serif",
            overflow: 'hidden', position: 'relative',
        }}>
            {/* Background image */}
            <div style={{
                position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none',
                backgroundImage: 'url(/bg-midnight-gold.png)',
                backgroundSize: 'cover', backgroundPosition: 'center center',
                opacity: 0.6,
            }} />

            {/* Subtle gold radials */}
            <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
                <div style={{
                    position: 'absolute', top: '10%', left: '50%', transform: 'translateX(-50%)',
                    width: '80%', height: '40%',
                    background: 'radial-gradient(ellipse, rgba(234,179,8,0.04) 0%, transparent 60%)',
                    filter: 'blur(80px)',
                }} />
                <div style={{
                    position: 'absolute', bottom: '0%', left: '50%', transform: 'translateX(-50%)',
                    width: '60%', height: '30%',
                    background: 'radial-gradient(ellipse, rgba(234,179,8,0.03) 0%, transparent 60%)',
                    filter: 'blur(60px)',
                }} />
                {/* Diagonal lines */}
                <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, opacity: 0.015 }}>
                    {Array.from({ length: 20 }, (_, i) => (
                        <line key={i} x1="0" y1={`${i * 80}`} x2="100%" y2={`${i * 80 + 400}`}
                            stroke="#EAB308" strokeWidth="0.5" />
                    ))}
                </svg>
            </div>

            {/* Nav */}
            <nav style={{
                position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50,
                padding: '20px 48px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(20px)',
                borderBottom: '1px solid rgba(234,179,8,0.08)',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{
                        width: '32px', height: '32px', borderRadius: '8px',
                        border: '2px solid #EAB308',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '16px', fontWeight: 900, color: '#EAB308',
                    }}>S</div>
                    <span style={{ fontSize: '20px', fontWeight: 300, color: '#F9FAFB', letterSpacing: '4px', textTransform: 'uppercase' }}>
                        Synaptic
                    </span>
                </div>
                <div style={{ display: 'flex', gap: '36px', alignItems: 'center' }}>
                    <a href="#about" style={{ fontSize: '13px', color: '#9CA3AF', textDecoration: 'none', fontWeight: 400, letterSpacing: '1px', textTransform: 'uppercase' }}>About</a>
                    <a href="#tech" style={{ fontSize: '13px', color: '#9CA3AF', textDecoration: 'none', fontWeight: 400, letterSpacing: '1px', textTransform: 'uppercase' }}>Technology</a>
                    <Link href="/pricing" style={{ fontSize: '13px', color: '#9CA3AF', textDecoration: 'none', fontWeight: 400, letterSpacing: '1px', textTransform: 'uppercase' }}>Pricing</Link>
                    <Link href="/login" style={{
                        padding: '10px 24px', borderRadius: '4px', fontSize: '13px', fontWeight: 600,
                        background: 'transparent', border: '1px solid #EAB308', color: '#EAB308',
                        textDecoration: 'none', letterSpacing: '1px', textTransform: 'uppercase',
                    }}>Access Platform</Link>
                </div>
            </nav>

            {/* Hero */}
            <section style={{ position: 'relative', zIndex: 1, paddingTop: '200px', paddingBottom: '100px', textAlign: 'center' }}>
                <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1 }}>
                    {/* Gold line accent */}
                    <div style={{ width: '60px', height: '2px', background: '#EAB308', margin: '0 auto 32px' }} />

                    <h1 style={{
                        fontSize: '64px', fontWeight: 200, lineHeight: 1.15, maxWidth: '800px', margin: '0 auto 20px',
                        color: '#F9FAFB', letterSpacing: '-1px',
                    }}>
                        Algorithmic Precision.{' '}
                        <span style={{ fontWeight: 700, color: '#EAB308' }}>AI Intelligence.</span>
                    </h1>
                    <p style={{
                        fontSize: '18px', color: '#6B7280', maxWidth: '480px', margin: '0 auto 48px',
                        lineHeight: 1.7, fontWeight: 300,
                    }}>
                        Institutional-grade crypto trading powered by Hidden Markov Models and Gemini AI reasoning.
                    </p>
                    <div style={{ display: 'flex', gap: '20px', justifyContent: 'center' }}>
                        <Link href="/signup" style={{
                            padding: '16px 48px', fontSize: '14px', fontWeight: 600,
                            background: '#EAB308', color: '#000000', borderRadius: '4px',
                            textDecoration: 'none', letterSpacing: '1px', textTransform: 'uppercase',
                        }}>Begin 14-Day Trial</Link>
                        <Link href="/pricing" style={{
                            padding: '16px 48px', fontSize: '14px', fontWeight: 600,
                            background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', color: '#9CA3AF',
                            borderRadius: '4px', textDecoration: 'none', letterSpacing: '1px', textTransform: 'uppercase',
                        }}>View Plans</Link>
                    </div>
                </motion.div>
            </section>

            {/* About */}
            <section id="about" style={{ position: 'relative', zIndex: 1, padding: '100px 48px' }}>
                <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '80px', alignItems: 'center' }}>
                        <motion.div initial={{ opacity: 0, x: -30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }}>
                            <div style={{ width: '40px', height: '2px', background: '#EAB308', marginBottom: '20px' }} />
                            <h2 style={{ fontSize: '36px', fontWeight: 200, marginBottom: '16px', letterSpacing: '-0.5px' }}>
                                Why <span style={{ fontWeight: 700, color: '#EAB308' }}>Synaptic</span>
                            </h2>
                            <p style={{ fontSize: '15px', color: '#9CA3AF', lineHeight: 1.8, marginBottom: '24px' }}>
                                Most trading bots use simple rules that break in volatile markets. Synaptic is different — our HMM engine detects the market's hidden state, and Athena AI validates every signal before execution.
                            </p>
                            <p style={{ fontSize: '15px', color: '#9CA3AF', lineHeight: 1.8 }}>
                                The result: fewer false signals, smarter entries, and capital preservation when the market turns.
                            </p>
                        </motion.div>
                        <motion.div initial={{ opacity: 0, x: 30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }}>
                            <div style={{
                                display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px',
                                background: 'rgba(234,179,8,0.1)', borderRadius: '12px', overflow: 'hidden',
                            }}>
                                {[
                                    { val: '15+', label: 'Coins Scanned' },
                                    { val: '3-Layer', label: 'AI Validation' },
                                    { val: '24/7', label: 'Autonomous' },
                                    { val: '<50ms', label: 'Execution' },
                                ].map((s, i) => (
                                    <div key={i} style={{
                                        padding: '28px', background: '#000', textAlign: 'center',
                                    }}>
                                        <div style={{ fontSize: '28px', fontWeight: 700, color: '#EAB308', marginBottom: '4px' }}>{s.val}</div>
                                        <div style={{ fontSize: '11px', color: '#6B7280', letterSpacing: '1px', textTransform: 'uppercase' }}>{s.label}</div>
                                    </div>
                                ))}
                            </div>
                        </motion.div>
                    </div>
                </div>
            </section>

            {/* Technology */}
            <section id="tech" style={{ position: 'relative', zIndex: 1, padding: '100px 48px' }}>
                <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
                    <div style={{ textAlign: 'center', marginBottom: '60px' }}>
                        <div style={{ width: '40px', height: '2px', background: '#EAB308', margin: '0 auto 20px' }} />
                        <h2 style={{ fontSize: '36px', fontWeight: 200, letterSpacing: '-0.5px' }}>
                            The <span style={{ fontWeight: 700, color: '#EAB308' }}>Technology</span>
                        </h2>
                    </div>

                    {[
                        { num: '01', title: 'Hidden Markov Model Engine', desc: 'Detects bullish, bearish, and ranging market regimes across multiple timeframes — before price confirms the move.', color: '#EAB308' },
                        { num: '02', title: 'Athena AI Reasoning Layer', desc: 'Gemini-powered LLM validates every HMM signal with macro analysis, assigns conviction scores, and can VETO risky trades.', color: '#F59E0B' },
                        { num: '03', title: 'Adaptive Execution Engine', desc: 'Dynamic position sizing based on conviction, ATR-based stop-losses, and trailing profit that adapts to volatility.', color: '#D97706' },
                    ].map((t, i) => (
                        <motion.div key={i} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }} transition={{ delay: i * 0.15 }}
                            style={{
                                display: 'flex', gap: '24px', padding: '32px 0',
                                borderBottom: i < 2 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                            }}>
                            <div style={{ fontSize: '14px', fontWeight: 300, color: '#4B5563', fontFamily: 'monospace', minWidth: '40px' }}>{t.num}</div>
                            <div>
                                <h3 style={{ fontSize: '20px', fontWeight: 600, color: t.color, marginBottom: '8px' }}>{t.title}</h3>
                                <p style={{ fontSize: '15px', color: '#9CA3AF', lineHeight: 1.7 }}>{t.desc}</p>
                            </div>
                        </motion.div>
                    ))}
                </div>
            </section>

            {/* CTA */}
            <section style={{ position: 'relative', zIndex: 1, padding: '120px 48px', textAlign: 'center' }}>
                <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}>
                    <div style={{ width: '60px', height: '2px', background: '#EAB308', margin: '0 auto 32px' }} />
                    <h2 style={{ fontSize: '40px', fontWeight: 200, marginBottom: '16px', letterSpacing: '-0.5px' }}>
                        Ready to <span style={{ fontWeight: 700, color: '#EAB308' }}>Elevate</span> Your Trading?
                    </h2>
                    <p style={{ fontSize: '16px', color: '#6B7280', marginBottom: '36px' }}>
                        14 days free. No credit card required.
                    </p>
                    <Link href="/signup" style={{
                        padding: '16px 56px', fontSize: '14px', fontWeight: 600,
                        background: '#EAB308', color: '#000', borderRadius: '4px',
                        textDecoration: 'none', letterSpacing: '1px', textTransform: 'uppercase',
                        display: 'inline-block',
                    }}>Get Started</Link>
                </motion.div>
            </section>

            <footer style={{
                position: 'relative', zIndex: 1, padding: '24px 48px',
                borderTop: '1px solid rgba(234,179,8,0.08)', textAlign: 'center',
                fontSize: '12px', color: '#4B5563', letterSpacing: '1px',
            }}>
                © 2026 SYNAPTIC BOTS. ALL RIGHTS RESERVED.
            </footer>
        </div>
    );
}

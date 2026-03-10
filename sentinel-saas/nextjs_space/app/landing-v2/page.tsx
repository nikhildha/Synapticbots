'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

/**
 * DESIGN 2: NEURAL GRADIENT
 * Purple/violet mesh gradients + glass cards + animated orbs + warm premium feel
 */
export default function LandingV2() {
    const [mounted, setMounted] = useState(false);
    useEffect(() => { setMounted(true); }, []);
    if (!mounted) return null;

    return (
        <div style={{
            minHeight: '100vh',
            background: '#080012',
            color: '#F9FAFB',
            fontFamily: "'Inter', -apple-system, sans-serif",
            overflow: 'hidden', position: 'relative',
        }}>
            {/* Background image */}
            <div style={{
                position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none',
                backgroundImage: 'url(/bg-neural-gradient.png)',
                backgroundSize: 'cover', backgroundPosition: 'center center',
                opacity: 0.5,
            }} />

            {/* Mesh gradient background */}
            <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
                <div style={{
                    position: 'absolute', top: '-10%', left: '-10%', width: '60%', height: '60%',
                    background: 'radial-gradient(ellipse, rgba(139,92,246,0.15) 0%, transparent 60%)',
                    filter: 'blur(100px)', animation: 'float1 8s ease-in-out infinite',
                }} />
                <div style={{
                    position: 'absolute', top: '40%', right: '-10%', width: '50%', height: '50%',
                    background: 'radial-gradient(ellipse, rgba(236,72,153,0.1) 0%, transparent 60%)',
                    filter: 'blur(100px)', animation: 'float2 10s ease-in-out infinite',
                }} />
                <div style={{
                    position: 'absolute', bottom: '-10%', left: '20%', width: '60%', height: '40%',
                    background: 'radial-gradient(ellipse, rgba(59,130,246,0.08) 0%, transparent 60%)',
                    filter: 'blur(100px)',
                }} />
                {/* Grid overlay */}
                <div style={{
                    position: 'absolute', inset: 0, opacity: 0.03,
                    backgroundImage: 'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)',
                    backgroundSize: '60px 60px',
                }} />
            </div>

            <style jsx global>{`
        @keyframes float1 { 0%, 100% { transform: translate(0, 0); } 50% { transform: translate(30px, -20px); } }
        @keyframes float2 { 0%, 100% { transform: translate(0, 0); } 50% { transform: translate(-20px, 30px); } }
      `}</style>

            {/* Nav */}
            <nav style={{
                position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50,
                padding: '16px 40px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                background: 'rgba(8,0,18,0.6)', backdropFilter: 'blur(20px)',
                borderBottom: '1px solid rgba(139,92,246,0.1)',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{
                        width: '36px', height: '36px', borderRadius: '12px',
                        background: 'linear-gradient(135deg, #8B5CF6, #EC4899)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '18px', fontWeight: 900, color: '#fff',
                    }}>S</div>
                    <span style={{ fontSize: '20px', fontWeight: 800, color: '#F9FAFB' }}>Synaptic</span>
                    <span style={{
                        fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '6px',
                        background: 'rgba(139,92,246,0.2)', color: '#A78BFA', marginLeft: '4px',
                    }}>BETA</span>
                </div>
                <div style={{ display: 'flex', gap: '32px', alignItems: 'center' }}>
                    <a href="#stack" style={{ fontSize: '14px', color: '#9CA3AF', textDecoration: 'none' }}>Tech Stack</a>
                    <a href="#agents" style={{ fontSize: '14px', color: '#9CA3AF', textDecoration: 'none' }}>AI Agents</a>
                    <Link href="/pricing" style={{ fontSize: '14px', color: '#9CA3AF', textDecoration: 'none' }}>Pricing</Link>
                    <Link href="/login" style={{
                        padding: '8px 20px', borderRadius: '10px', fontSize: '14px', fontWeight: 600,
                        background: 'linear-gradient(135deg, #8B5CF6, #EC4899)', color: '#fff',
                        textDecoration: 'none',
                    }}>Launch App</Link>
                </div>
            </nav>

            {/* Hero */}
            <section style={{ position: 'relative', zIndex: 1, paddingTop: '180px', paddingBottom: '80px', textAlign: 'center' }}>
                <motion.div initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8 }}>
                    <div style={{
                        display: 'inline-block', padding: '6px 20px', borderRadius: '20px', marginBottom: '24px',
                        background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.2)',
                        fontSize: '13px', fontWeight: 600, color: '#A78BFA',
                    }}>
                        ✨ AI-First Trading Intelligence Platform
                    </div>
                    <h1 style={{
                        fontSize: '68px', fontWeight: 900, lineHeight: 1.05, maxWidth: '850px', margin: '0 auto 20px',
                        color: '#F9FAFB', letterSpacing: '-2px',
                    }}>
                        Your Money Deserves{' '}
                        <span style={{
                            background: 'linear-gradient(135deg, #8B5CF6, #EC4899, #F59E0B)',
                            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                        }}>Smarter Decisions</span>
                    </h1>
                    <p style={{ fontSize: '19px', color: '#9CA3AF', maxWidth: '550px', margin: '0 auto 40px', lineHeight: 1.7 }}>
                        Hidden Markov Models detect the regime. Athena AI validates the signal. You collect the alpha.
                    </p>
                    <div style={{ display: 'flex', gap: '16px', justifyContent: 'center' }}>
                        <Link href="/signup" style={{
                            padding: '16px 44px', borderRadius: '14px', fontSize: '17px', fontWeight: 700,
                            background: 'linear-gradient(135deg, #8B5CF6, #EC4899)', color: '#fff',
                            textDecoration: 'none', boxShadow: '0 0 50px rgba(139,92,246,0.3)',
                        }}>Start Free Trial →</Link>
                    </div>
                    <p style={{ fontSize: '13px', color: '#6B7280', marginTop: '12px' }}>14 days free · No credit card · Cancel anytime</p>
                </motion.div>
            </section>

            {/* Live Stats Ribbon */}
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }}
                style={{
                    position: 'relative', zIndex: 1, maxWidth: '900px', margin: '0 auto 80px',
                    display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1px',
                    background: 'rgba(255,255,255,0.05)', borderRadius: '16px', overflow: 'hidden',
                }}>
                {[
                    { val: '15+', sub: 'Coins Scanned', icon: '🔍' },
                    { val: '3 Layer', sub: 'AI Validation', icon: '🏛️' },
                    { val: '24/7', sub: 'Autonomous', icon: '⚡' },
                    { val: '93%', sub: 'Gross Margin', icon: '📊' },
                ].map((s, i) => (
                    <div key={i} style={{
                        padding: '24px', textAlign: 'center',
                        background: 'rgba(8,0,18,0.8)', backdropFilter: 'blur(10px)',
                    }}>
                        <span style={{ fontSize: '20px', display: 'block', marginBottom: '8px' }}>{s.icon}</span>
                        <div style={{ fontSize: '24px', fontWeight: 800, color: '#F9FAFB' }}>{s.val}</div>
                        <div style={{ fontSize: '12px', color: '#6B7280' }}>{s.sub}</div>
                    </div>
                ))}
            </motion.div>

            {/* AI Agents Section */}
            <section id="agents" style={{ position: 'relative', zIndex: 1, padding: '60px 40px' }}>
                <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
                    <h2 style={{ fontSize: '40px', fontWeight: 800, textAlign: 'center', marginBottom: '12px' }}>
                        Meet Your AI Trading Team
                    </h2>
                    <p style={{ textAlign: 'center', color: '#9CA3AF', marginBottom: '48px', fontSize: '16px' }}>
                        Three specialized agents working in perfect coordination
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '24px' }}>
                        {[
                            { name: 'HMM Engine', role: 'Regime Detection', desc: 'Identifies bullish, bearish, and ranging market conditions across multiple timeframes using Hidden Markov Models.', gradient: 'linear-gradient(135deg, rgba(6,182,212,0.15), rgba(6,182,212,0.02))', border: 'rgba(6,182,212,0.2)', color: '#06B6D4', icon: '📊' },
                            { name: 'Athena AI', role: 'Signal Validation', desc: 'Gemini-powered LLM that analyzes macro conditions, validates HMM signals, and assigns conviction scores.', gradient: 'linear-gradient(135deg, rgba(139,92,246,0.15), rgba(139,92,246,0.02))', border: 'rgba(139,92,246,0.2)', color: '#A78BFA', icon: '🏛️' },
                            { name: 'Execution Engine', role: 'Trade Deployment', desc: 'Handles position sizing, risk management, stop-loss placement, and autonomous execution on Binance.', gradient: 'linear-gradient(135deg, rgba(34,197,94,0.15), rgba(34,197,94,0.02))', border: 'rgba(34,197,94,0.2)', color: '#22C55E', icon: '⚡' },
                        ].map((a, i) => (
                            <motion.div key={i} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true }} transition={{ delay: i * 0.15 }}
                                style={{
                                    padding: '32px', borderRadius: '20px',
                                    background: a.gradient, border: `1px solid ${a.border}`,
                                }}>
                                <span style={{ fontSize: '36px', display: 'block', marginBottom: '16px' }}>{a.icon}</span>
                                <h3 style={{ fontSize: '22px', fontWeight: 800, color: a.color, marginBottom: '4px' }}>{a.name}</h3>
                                <div style={{ fontSize: '12px', fontWeight: 600, color: '#6B7280', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '1px' }}>{a.role}</div>
                                <p style={{ fontSize: '14px', color: '#9CA3AF', lineHeight: 1.7 }}>{a.desc}</p>
                            </motion.div>
                        ))}
                    </div>
                </div>
            </section>

            {/* Pipeline Visualization */}
            <section id="stack" style={{ position: 'relative', zIndex: 1, padding: '80px 40px' }}>
                <div style={{ maxWidth: '800px', margin: '0 auto', textAlign: 'center' }}>
                    <h2 style={{ fontSize: '36px', fontWeight: 800, marginBottom: '40px' }}>The Decision Pipeline</h2>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', flexWrap: 'wrap' }}>
                        {[
                            { label: 'Market Data', bg: 'rgba(6,182,212,0.1)', color: '#06B6D4' },
                            { label: '→' },
                            { label: 'HMM Regime', bg: 'rgba(59,130,246,0.1)', color: '#3B82F6' },
                            { label: '→' },
                            { label: 'Athena AI', bg: 'rgba(139,92,246,0.1)', color: '#A78BFA' },
                            { label: '→' },
                            { label: 'EXECUTE / VETO', bg: 'rgba(34,197,94,0.1)', color: '#22C55E' },
                        ].map((s, i) => s.bg ? (
                            <motion.div key={i} initial={{ opacity: 0, scale: 0.8 }} whileInView={{ opacity: 1, scale: 1 }}
                                viewport={{ once: true }} transition={{ delay: i * 0.1 }}
                                style={{
                                    padding: '14px 24px', borderRadius: '12px',
                                    background: s.bg, border: `1px solid ${s.color}33`,
                                    fontSize: '14px', fontWeight: 700, color: s.color,
                                }}>{s.label}</motion.div>
                        ) : (
                            <span key={i} style={{ fontSize: '20px', color: '#4B5563' }}>{s.label}</span>
                        ))}
                    </div>
                </div>
            </section>

            {/* CTA */}
            <section style={{ position: 'relative', zIndex: 1, padding: '80px 40px' }}>
                <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
                    style={{
                        maxWidth: '700px', margin: '0 auto', textAlign: 'center', padding: '60px 40px',
                        borderRadius: '24px',
                        background: 'linear-gradient(135deg, rgba(139,92,246,0.08), rgba(236,72,153,0.04))',
                        border: '1px solid rgba(139,92,246,0.15)',
                    }}>
                    <h2 style={{ fontSize: '36px', fontWeight: 800, marginBottom: '12px' }}>
                        Intelligence, Automated.
                    </h2>
                    <p style={{ fontSize: '16px', color: '#9CA3AF', marginBottom: '28px' }}>
                        Join the waitlist for institutional-grade crypto AI.
                    </p>
                    <Link href="/signup" style={{
                        padding: '16px 48px', borderRadius: '14px', fontSize: '17px', fontWeight: 700,
                        background: 'linear-gradient(135deg, #8B5CF6, #EC4899)', color: '#fff',
                        textDecoration: 'none', display: 'inline-block',
                        boxShadow: '0 0 50px rgba(139,92,246,0.25)',
                    }}>Get Early Access</Link>
                </motion.div>
            </section>

            <footer style={{ position: 'relative', zIndex: 1, padding: '24px', textAlign: 'center', fontSize: '13px', color: '#4B5563', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                © 2026 Synaptic Bots. All rights reserved.
            </footer>
        </div>
    );
}

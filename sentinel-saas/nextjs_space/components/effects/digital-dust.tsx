'use client';
import { useEffect, useRef } from 'react';

export function DigitalDust() {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let W = window.innerWidth;
        let H = window.innerHeight;
        canvas.width = W;
        canvas.height = H;

        const PARTICLE_COUNT = 40;
        interface Particle {
            x: number; y: number;
            vx: number; vy: number;
            opacity: number; size: number;
            drift: number; driftPhase: number;
        }

        const particles: Particle[] = Array.from({ length: PARTICLE_COUNT }, () => ({
            x: Math.random() * W,
            y: Math.random() * H,
            vx: (Math.random() - 0.5) * 0.18,
            vy: (Math.random() - 0.5) * 0.12,
            opacity: Math.random() * 0.12 + 0.02,
            size: Math.random() * 1.2 + 0.3,
            drift: Math.random() * 0.4 + 0.1,
            driftPhase: Math.random() * Math.PI * 2,
        }));

        let frame = 0;
        let raf: number;

        const draw = () => {
            ctx.clearRect(0, 0, W, H);
            frame++;

            for (const p of particles) {
                // Gentle sinusoidal drift
                p.x += p.vx + Math.sin(frame * 0.008 + p.driftPhase) * p.drift * 0.02;
                p.y += p.vy;

                // Wrap around
                if (p.x < 0) p.x = W;
                if (p.x > W) p.x = 0;
                if (p.y < 0) p.y = H;
                if (p.y > H) p.y = 0;

                // Flicker
                const flicker = 0.5 + 0.5 * Math.sin(frame * 0.03 + p.driftPhase * 2);
                const alpha = p.opacity * (0.7 + 0.3 * flicker);

                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                // Mix between cyan and amber for variety
                const isCyan = Math.sin(p.driftPhase) > 0;
                ctx.fillStyle = isCyan
                    ? `rgba(0, 229, 255, ${alpha})`
                    : `rgba(255, 179, 0, ${alpha * 0.6})`;
                ctx.fill();
            }

            raf = requestAnimationFrame(draw);
        };

        draw();

        const onResize = () => {
            W = window.innerWidth;
            H = window.innerHeight;
            canvas.width = W;
            canvas.height = H;
        };
        window.addEventListener('resize', onResize);

        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener('resize', onResize);
        };
    }, []);

    return (
        <canvas
            ref={canvasRef}
            style={{
                position: 'fixed', inset: 0, zIndex: 0,
                pointerEvents: 'none', opacity: 1,
            }}
        />
    );
}

export function PerspectiveGrid() {
    return (
        <div
            aria-hidden
            style={{
                position: 'fixed', bottom: 0, left: 0, right: 0,
                height: '35vh', zIndex: 0, pointerEvents: 'none',
                overflow: 'hidden',
            }}
        >
            {/* Grid lines via SVG */}
            <svg
                width="100%" height="100%"
                viewBox="0 0 1000 300"
                preserveAspectRatio="none"
                style={{ position: 'absolute', inset: 0 }}
            >
                <defs>
                    <linearGradient id="gridFadeV" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="rgba(0,229,255,0)" />
                        <stop offset="40%" stopColor="rgba(0,229,255,0.06)" />
                        <stop offset="100%" stopColor="rgba(0,229,255,0.14)" />
                    </linearGradient>
                    <linearGradient id="gridFadeH" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="rgba(0,229,255,0)" />
                        <stop offset="50%" stopColor="rgba(0,229,255,1)" />
                        <stop offset="100%" stopColor="rgba(0,229,255,0)" />
                    </linearGradient>
                    <mask id="gridMask">
                        <rect width="1000" height="300" fill="url(#gridFadeV)" />
                    </mask>
                </defs>

                <g mask="url(#gridMask)">
                    {/* Perspective horizontal lines */}
                    {[0.05, 0.12, 0.20, 0.30, 0.42, 0.57, 0.75, 1.0].map((frac, i) => {
                        const y = frac * 300;
                        return (
                            <line key={`h${i}`}
                                x1={500 - frac * 500} y1={y}
                                x2={500 + frac * 500} y2={y}
                                stroke="rgba(0,229,255,0.4)" strokeWidth="0.5"
                            />
                        );
                    })}

                    {/* Perspective vertical lines (vanish to center-top) */}
                    {[-4, -3, -2, -1, 0, 1, 2, 3, 4].map((n, i) => (
                        <line key={`v${i}`}
                            x1={500} y1={0}
                            x2={500 + n * 120} y2={300}
                            stroke="rgba(0,229,255,0.3)" strokeWidth="0.5"
                        />
                    ))}
                </g>
            </svg>

            {/* Fade overlay: dark at bottom, transparent at top */}
            <div style={{
                position: 'absolute', inset: 0,
                background: 'linear-gradient(to bottom, rgba(5,5,5,0) 0%, rgba(5,5,5,0.7) 60%, rgba(5,5,5,0.96) 100%)',
            }} />
        </div>
    );
}

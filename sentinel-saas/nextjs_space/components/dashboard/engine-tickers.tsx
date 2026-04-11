'use client';
import React, { useMemo } from 'react';
import { motion } from 'framer-motion';

export function EngineTickers({ multi }: { multi: any }) {
  // 1. HMM Shortlist (Top coins ranked by conviction)
  const hmmShortlist = useMemo(() => {
    if (!multi?.coin_states) return [];
    const coins = Object.entries(multi.coin_states)
      .map(([symbol, state]: [string, any]) => ({
        symbol,
        conviction: state.conviction || 0,
        regimeName: state.regime_name || 'UNKNOWN',
      }))
      .filter((c) => c.conviction > 0)
      .sort((a, b) => b.conviction - a.conviction);
    return coins.slice(0, 15); // Top 15 absolute best
  }, [multi?.coin_states]);

  // 2. Systematic 100 
  const systematicPool = useMemo(() => {
    return multi?.systematic_pool || [];
  }, [multi?.systematic_pool]);

  // CSS for seamless scrolling marquee
  const marqueeStyle = `
    @keyframes marquee {
      0% { transform: translateX(0); }
      100% { transform: translateX(-50%); }
    }
    .animate-marquee {
      display: inline-block;
      white-space: nowrap;
      animation: marquee 30s linear infinite;
    }
    .animate-marquee:hover {
      animation-play-state: paused;
    }
  `;

  return (
    <div className="flex flex-col gap-3 w-full font-mono text-xs overflow-hidden mb-8">
      <style>{marqueeStyle}</style>

      {/* Ticker 1: HMM Shortlist */}
      {hmmShortlist.length > 0 && (
        <div className="relative flex whitespace-nowrap overflow-hidden bg-black/40 border-y border-[#333] py-2">
          <div className="absolute left-0 top-0 bottom-0 w-16 bg-gradient-to-r from-[#0E1117] to-transparent z-10 pointer-events-none" />
          <div className="absolute right-0 top-0 bottom-0 w-16 bg-gradient-to-l from-[#0E1117] to-transparent z-10 pointer-events-none" />
          
          <div className="animate-marquee flex gap-6 pl-4">
            {/* Render twice for seamless infinite scroll */}
            {[...hmmShortlist, ...hmmShortlist].map((coin, i) => {
              const isBull = coin.regimeName === 'BULLISH';
              const isBear = coin.regimeName === 'BEARISH';
              return (
                <div key={i} className={`flex items-center gap-2 ${isBull ? 'text-green-400' : isBear ? 'text-red-400' : 'text-yellow-400'}`}>
                  <span className="font-bold">{coin.symbol}</span>
                  <span className="opacity-70">{coin.regimeName}</span>
                  <span className="bg-black/40 px-1 py-0.5 rounded text-[10px]">
                    {Math.round(coin.conviction * 100)}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Ticker 2: Systematic 100 */}
      {systematicPool.length > 0 && (
        <div className="relative flex whitespace-nowrap overflow-hidden bg-black/20 border-b border-[#222] py-1.5 opacity-60 hover:opacity-100 transition-opacity">
          <div className="absolute left-0 top-0 bottom-0 w-16 bg-gradient-to-r from-[#0E1117] to-transparent z-10 pointer-events-none" />
          <div className="absolute right-0 top-0 bottom-0 w-16 bg-gradient-to-l from-[#0E1117] to-transparent z-10 pointer-events-none" />
          
          <div className="animate-marquee flex gap-4 pl-4" style={{ animationDuration: '60s', animationDirection: 'reverse' }}>
            {[...systematicPool, ...systematicPool].map((sym: string, i: number) => {
               // See if we have state for it
               const state = multi?.coin_states?.[sym];
               const isBull = state?.regime_name === 'BULLISH';
               const isBear = state?.regime_name === 'BEARISH';
               const colorClass = isBull ? 'text-green-500' : isBear ? 'text-red-500' : 'text-gray-500';
               return (
                <span key={i} className={`flex items-center gap-1.5 ${colorClass}`}>
                  <span className="w-1.5 h-1.5 rounded-full currentColor bg-current opacity-50" />
                  {sym}
                </span>
               );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

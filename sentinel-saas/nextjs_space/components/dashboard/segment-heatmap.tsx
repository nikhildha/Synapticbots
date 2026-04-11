'use client';

import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, Activity, Zap } from 'lucide-react';

interface SegmentData {
  segment: string;
  vw_4h: number;
  breadth_1h: number;
  blended_score: number;
  abs_score: number;
  direction: string; // "LONG" | "SHORT"
  is_cooldown?: boolean;
  coin_count?: number;
}

interface SegmentHeatmapProps {
  heatmapData: {
    timestamp?: string;
    scoring?: string;
    segments?: SegmentData[];
  } | null;
  loading?: boolean;
}

export function SegmentHeatmap({ heatmapData, loading = false }: SegmentHeatmapProps) {
  if (loading) {
    return (
      <div className="w-full h-32 rounded-xl bg-white/5 animate-pulse mb-8 flex items-center justify-center">
        <span className="text-white/40 text-sm">Loading Market Flow...</span>
      </div>
    );
  }

  if (!heatmapData || !heatmapData.segments || heatmapData.segments.length === 0) {
    return (
      <div className="mb-8 p-6 rounded-2xl border border-[var(--color-border)]" style={{ background: 'var(--color-surface)', backdropFilter: 'blur(12px)' }}>
        <div className="flex items-start gap-3 mb-4">
          <div className="p-2 rounded-lg bg-cyan-500/10 mt-1">
            <Activity className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <h2 className="text-[17px] font-bold text-[var(--color-text)] flex items-center gap-2">
              Segment Heatmap
              <span className="px-2 py-[2px] rounded text-[10px] font-bold bg-[var(--color-text)]/10 text-[var(--color-text-secondary)] tracking-wider">LIVE</span>
            </h2>
            <p className="text-[12px] text-[var(--color-text-secondary)] mt-1 max-w-[90%] leading-relaxed">
              Ranks market sectors by blending 4h momentum with 1h breadth. Bots are dynamically routed to the strongest active sectors to optimize capital efficiency.
            </p>
          </div>
        </div>
        <div className="flex items-center justify-center h-24 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-light)]">
          <p className="text-[13px] text-[var(--color-text-secondary)] italic">Waiting for first engine cycle — heatmap will appear here</p>
        </div>
      </div>
    );
  }

  // Sort by blended_score descending (hottest long → left, coldest short → right)
  const sortedSegments = [...heatmapData.segments].sort((a, b) => b.blended_score - a.blended_score);

  // Top 2 by absolute score, EXCLUDING cooldown segments = the sectors the engine is actively scanning
  const unblockedRanked = [...heatmapData.segments]
    .filter(s => !s.is_cooldown)
    .sort((a, b) => b.abs_score - a.abs_score);
  const top2Targets = unblockedRanked.slice(0, 2).map((s) => s.segment);

  return (
    <div className="mb-8 p-6 rounded-2xl border border-[var(--color-border)]" style={{ background: 'var(--color-surface)', backdropFilter: 'blur(12px)' }}>
      {/* Header */}
      <div className="mb-4">
        <div className="flex items-start gap-3 mb-3">
          <div className="p-2 rounded-lg bg-cyan-500/10 mt-1">
            <Activity className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <h2 className="text-[15px] font-bold text-[var(--color-text)] flex items-center gap-2">
              Segment Heatmap
              <span className="px-2 py-[2px] rounded text-[10px] font-bold bg-[var(--color-text)]/10 text-[var(--color-text-secondary)] tracking-wider">LIVE</span>
            </h2>
            <p className="text-[11px] text-[var(--color-text-secondary)] mt-1 max-w-[90%] leading-relaxed">
              Ranks market sectors by blending 4h momentum with 1h breadth. Bots are dynamically routed to the strongest active sectors to optimize capital efficiency.
            </p>
          </div>
        </div>

        <div>
          <div className="text-[10px] text-gray-400 font-semibold tracking-wide uppercase mb-1">Active Targets</div>
          <div className="flex items-center gap-2 flex-wrap">
            {top2Targets.map((seg) => {
              const segData = heatmapData.segments!.find(s => s.segment === seg);
              const isLong = segData?.direction === 'LONG';
              return (
                <div key={seg} className={`flex items-center gap-1 px-2 py-0.5 rounded-full border ${isLong ? 'bg-green-500/10 border-green-500/20' : 'bg-red-500/10 border-red-500/20'}`}>
                  <Zap className={`w-3 h-3 ${isLong ? 'text-green-400' : 'text-red-400'}`} />
                  <span className={`text-[11px] font-bold ${isLong ? 'text-green-400' : 'text-red-400'}`}>{seg}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Heatmap Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-11 gap-2 overflow-x-auto pb-2">
        {sortedSegments.map((seg, i) => {
          const isHot = top2Targets.includes(seg.segment);
          const isCooldown = !!seg.is_cooldown;
          const isPositive = seg.blended_score >= 0;

          const magnitude = Math.min(Math.abs(seg.blended_score) / 3, 1);
          const bgOpacity = 0.05 + (magnitude * 0.15);

          const primaryColor = isCooldown ? 'rgba(107, 114, 128' : (isPositive ? 'rgba(34, 197, 94' : 'rgba(239, 68, 68');
          const bgColor = `${primaryColor}, ${isCooldown ? 0.05 : bgOpacity})`;
          const borderColor = isHot ? `${primaryColor}, 0.5)` : `${primaryColor}, 0.1)`;

          return (
            <motion.div
              key={seg.segment}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.05 }}
              className={`relative p-2 py-3 rounded-xl flex flex-col justify-between ${isCooldown ? 'opacity-50 grayscale select-none' : ''}`}
              style={{
                background: bgColor,
                border: `1px solid ${borderColor}`,
                boxShadow: isHot ? `0 0 15px ${primaryColor}, 0.15)` : 'none'
              }}
            >
              {isHot && (
                <div className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full animate-ping" style={{ background: `${primaryColor}, 0.8)` }} />
              )}
              {isHot && (
                <div className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full" style={{ background: `${primaryColor}, 1)` }} />
              )}

              <div className="flex flex-col items-center justify-center h-full gap-0.5 mt-1">
                <span className="text-[9px] font-bold text-[var(--color-text)] tracking-wider uppercase truncate max-w-full opacity-80" title={seg.segment}>
                  {seg.segment}
                </span>
                
                <div className="flex items-center justify-center my-1">
                   <span className={`text-sm md:text-base font-black tracking-tight ${isCooldown ? 'text-gray-400' : (isPositive ? 'text-green-400' : 'text-red-400')}`}>
                    {isPositive && !isCooldown ? '+' : ''}{seg.blended_score.toFixed(1)}
                  </span>
                </div>

                <div className="flex flex-col items-center gap-1 mt-1">
                   <div className="px-1 py-0.5 rounded bg-black/20 text-[8px] font-mono text-white/50 border border-white/5 whitespace-nowrap">
                      {seg.coin_count !== undefined ? `${seg.coin_count}` : '...'}
                   </div>
                   {isCooldown && <span className="px-1 py-0.5 rounded bg-red-900/40 border border-red-500/20 text-[7px] font-bold text-white/40 tracking-wider">COOL</span>}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

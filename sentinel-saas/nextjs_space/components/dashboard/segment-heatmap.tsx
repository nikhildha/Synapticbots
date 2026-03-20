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
      <div className="mb-8 p-6 rounded-2xl border border-white/5" style={{ background: 'rgba(17, 24, 39, 0.6)', backdropFilter: 'blur(12px)' }}>
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-cyan-500/10">
            <Activity className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <h2 className="text-[17px] font-bold text-white flex items-center gap-2">
              Segment Heatmap
              <span className="px-2 py-[2px] rounded text-[10px] font-bold bg-white/10 text-white/70 tracking-wider">LIVE</span>
            </h2>
            <p className="text-[12px] text-gray-400 mt-0.5">4h Momentum × 1h Breadth — Top 4 Active Sectors</p>
          </div>
        </div>
        <div className="flex items-center justify-center h-24 rounded-xl border border-white/5 bg-white/[0.02]">
          <p className="text-[13px] text-gray-500 italic">Waiting for first engine cycle — heatmap will appear here</p>
        </div>
      </div>
    );
  }

  // Sort by blended_score descending (hottest long → left, coldest short → right)
  const sortedSegments = [...heatmapData.segments].sort((a, b) => b.blended_score - a.blended_score);

  // Top 4 by absolute score = the sectors the engine is actively scanning
  const absSorted = [...heatmapData.segments].sort((a, b) => b.abs_score - a.abs_score);
  const top4Targets = absSorted.slice(0, 4).map((s) => s.segment);

  return (
    <div className="mb-8 p-6 rounded-2xl border border-white/5" style={{ background: 'rgba(17, 24, 39, 0.6)', backdropFilter: 'blur(12px)' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-cyan-500/10">
            <Activity className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <h2 className="text-[17px] font-bold text-white flex items-center gap-2">
              Segment Heatmap
              <span className="px-2 py-[2px] rounded text-[10px] font-bold bg-white/10 text-white/70 tracking-wider">LIVE</span>
            </h2>
            <p className="text-[12px] text-gray-400 mt-0.5">
              4h Momentum × 1h Breadth | Cycle-matched scoring
            </p>
          </div>
        </div>

        <div className="text-right">
          <div className="text-[11px] text-gray-400 font-semibold tracking-wide uppercase mb-1">Active Scan Targets</div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {top4Targets.map((seg) => {
              const segData = heatmapData.segments!.find(s => s.segment === seg);
              const isLong = segData?.direction === 'LONG';
              return (
                <div key={seg} className={`flex items-center gap-1.5 px-3 py-1 rounded-full border ${isLong ? 'bg-green-500/10 border-green-500/20' : 'bg-red-500/10 border-red-500/20'}`}>
                  <Zap className={`w-3 h-3 ${isLong ? 'text-green-400' : 'text-red-400'}`} />
                  <span className={`text-[12px] font-bold ${isLong ? 'text-green-400' : 'text-red-400'}`}>{seg}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Heatmap Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {sortedSegments.map((seg, i) => {
          const isHot = top4Targets.includes(seg.segment);
          const isPositive = seg.blended_score >= 0;

          const magnitude = Math.min(Math.abs(seg.blended_score) / 3, 1);
          const bgOpacity = 0.05 + (magnitude * 0.15);

          const primaryColor = isPositive ? 'rgba(34, 197, 94' : 'rgba(239, 68, 68';
          const bgColor = `${primaryColor}, ${bgOpacity})`;
          const borderColor = isHot ? `${primaryColor}, 0.5)` : `${primaryColor}, 0.1)`;

          return (
            <motion.div
              key={seg.segment}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.05 }}
              className="relative p-4 rounded-xl flex flex-col justify-between"
              style={{
                background: bgColor,
                border: `1px solid ${borderColor}`,
                boxShadow: isHot ? `0 0 15px ${primaryColor}, 0.15)` : 'none'
              }}
            >
              {isHot && (
                <div className="absolute -top-1.5 -right-1.5 w-3 h-3 rounded-full animate-ping" style={{ background: `${primaryColor}, 0.8)` }} />
              )}
              {isHot && (
                <div className="absolute -top-1.5 -right-1.5 w-3 h-3 rounded-full" style={{ background: `${primaryColor}, 1)` }} />
              )}

              <div className="flex justify-between items-start mb-3">
                <span className="text-sm font-bold text-white tracking-wide">{seg.segment}</span>
                <div className="flex items-center gap-1">
                  {isPositive ? <TrendingUp className="w-3.5 h-3.5 text-green-400" /> : <TrendingDown className="w-3.5 h-3.5 text-red-400" />}
                  <span className={`text-sm font-bold ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
                    {isPositive ? '+' : ''}{seg.blended_score.toFixed(2)}
                  </span>
                </div>
              </div>

              <div className="space-y-1.5 mt-auto">
                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-gray-400">4h Return</span>
                  <span className={`font-medium ${seg.vw_4h >= 0 ? 'text-green-400/80' : 'text-red-400/80'}`}>
                    {seg.vw_4h >= 0 ? '+' : ''}{seg.vw_4h.toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between items-center text-[11px] pt-1 mt-1 border-t border-white/5">
                  <span className="text-gray-400">1h Breadth</span>
                  <span className="text-white/80 font-medium">{seg.breadth_1h.toFixed(0)}%</span>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

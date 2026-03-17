'use client';

import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, Activity, ArrowRight, Zap } from 'lucide-react';

interface SegmentData {
  segment: string;
  vw_rr: number;
  btc_alpha: number;
  breadth_pct: number;
  composite_score: number;
  is_positive: boolean;
  abs_score: number;
}

interface SegmentHeatmapProps {
  heatmapData: {
    timestamp?: string;
    btc_24h?: number;
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
              Institutional Segment Heatmap
              <span className="px-2 py-[2px] rounded text-[10px] font-bold bg-white/10 text-white/70 tracking-wider">LIVE</span>
            </h2>
            <p className="text-[12px] text-gray-400 mt-0.5">3-Pillar Composite Momentum (VW-RR, BTC Alpha, Breadth)</p>
          </div>
        </div>
        <div className="flex items-center justify-center h-24 rounded-xl border border-white/5 bg-white/[0.02]">
          <p className="text-[13px] text-gray-500 italic">Waiting for first engine cycle — heatmap will appear here</p>
        </div>
      </div>
    );
  }


  // Sort by raw composite score (descending) to show hottest on left, coldest on right
  const sortedSegments = [...heatmapData.segments].sort((a, b) => b.composite_score - a.composite_score);
  const btc24h = heatmapData.btc_24h || 0;

  // Identify the Top Absolute Momentum segments (the engine scans config.SEGMENT_SCAN_LIMIT, which is 2)
  const absSorted = [...heatmapData.segments].sort((a, b) => b.abs_score - a.abs_score);
  const top2Targets = absSorted.slice(0, 2).map((s) => s.segment);

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
              Institutional Segment Heatmap
              <span className="px-2 py-[2px] rounded text-[10px] font-bold bg-white/10 text-white/70 tracking-wider">LIVE</span>
            </h2>
            <p className="text-[12px] text-gray-400 mt-0.5">
              3-Pillar Composite Momentum (VW-RR, BTC Alpha, Breadth) | BTC 24H: <span className={btc24h >= 0 ? "text-green-400" : "text-red-400"}>{btc24h > 0 ? "+" : ""}{btc24h.toFixed(2)}%</span>
            </p>
          </div>
        </div>
        
        <div className="text-right">
          <div className="text-[11px] text-gray-400 font-semibold tracking-wide uppercase mb-1">Active Scan Targets</div>
          <div className="flex items-center gap-2">
            {top2Targets.map((seg, idx) => (
              <div key={seg} className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20">
                <Zap className="w-3 h-3 text-cyan-400" />
                <span className="text-[12px] font-bold text-cyan-400">{seg}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Heatmap Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {sortedSegments.map((seg, i) => {
          const isHot = top2Targets.includes(seg.segment);
          const isPositive = seg.composite_score >= 0;
          
          // Color intensity based on 0-to-10 scale magnitude (clamped)
          const magnitude = Math.min(Math.abs(seg.composite_score) / 5, 1);
          const bgOpacity = 0.05 + (magnitude * 0.15); // ranges 0.05 -> 0.20
          
          const primaryColor = isPositive ? 'rgba(34, 197, 94' : 'rgba(239, 68, 68'; // green or red
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
                    {isPositive ? '+' : ''}{seg.composite_score.toFixed(2)}
                  </span>
                </div>
              </div>

              <div className="space-y-1.5 mt-auto">
                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-gray-400">Vol-W Return (VW-RR)</span>
                  <span className={`font-medium ${seg.vw_rr >= 0 ? 'text-green-400/80' : 'text-red-400/80'}`}>
                    {seg.vw_rr >= 0 ? '+' : ''}{seg.vw_rr.toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-gray-400">BTC Alpha</span>
                  <span className={`font-medium ${seg.btc_alpha >= 0 ? 'text-green-400/80' : 'text-red-400/80'}`}>
                    {seg.btc_alpha >= 0 ? '+' : ''}{seg.btc_alpha.toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between items-center text-[11px] pt-1 mt-1 border-t border-white/5">
                  <span className="text-gray-400">Breadth</span>
                  <span className="text-white/80 font-medium">{seg.breadth_pct.toFixed(0)}%</span>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

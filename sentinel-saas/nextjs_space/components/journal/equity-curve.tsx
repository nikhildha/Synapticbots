'use client';

interface EquityCurveProps {
  points: { ts: string; value: number }[];
  width?: number;
  height?: number;
  color?: string;
  label?: string;
}

export function EquityCurve({ points, width = 400, height = 80, color, label }: EquityCurveProps) {
  if (!points || points.length < 2) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height, color: '#4B5563', fontSize: '12px' }}>
        Not enough data
      </div>
    );
  }

  const values = points.map(p => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const padding = 4;

  const px = (i: number) => (i / (points.length - 1)) * (width - padding * 2) + padding;
  const py = (v: number) => height - padding - ((v - min) / range) * (height - padding * 2);

  const pathD = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${px(i).toFixed(1)},${py(p.value).toFixed(1)}`)
    .join(' ');

  // Fill area under curve
  const fillD = `${pathD} L${px(points.length - 1).toFixed(1)},${height - padding} L${padding},${height - padding} Z`;

  const lastValue = values[values.length - 1];
  const lineColor = color || (lastValue >= 0 ? '#1D9E75' : '#D85A30');
  const fillColor = lastValue >= 0 ? 'rgba(29,158,117,0.12)' : 'rgba(216,90,48,0.12)';

  return (
    <div style={{ width: '100%' }}>
      {label && (
        <div style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '1px', color: '#6B7280', marginBottom: '6px' }}>
          {label}
        </div>
      )}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: '100%', height, display: 'block' }}
        preserveAspectRatio="none"
      >
        {/* Fill */}
        <path d={fillD} fill={fillColor} />
        {/* Line */}
        <path d={pathD} fill="none" stroke={lineColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {/* Last point dot */}
        <circle
          cx={px(points.length - 1)}
          cy={py(lastValue)}
          r="3"
          fill={lineColor}
        />
        {/* Zero baseline */}
        {min < 0 && max > 0 && (
          <line
            x1={padding}
            x2={width - padding}
            y1={py(0)}
            y2={py(0)}
            stroke="rgba(255,255,255,0.15)"
            strokeWidth="1"
            strokeDasharray="4 3"
          />
        )}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px', fontSize: '10px', color: '#6B7280' }}>
        <span>{points[0]?.ts?.slice(0, 10) || '—'}</span>
        <span style={{ color: lineColor, fontWeight: 700 }}>
          {lastValue >= 0 ? '+' : ''}{lastValue.toFixed(2)} USDT
        </span>
      </div>
    </div>
  );
}

// Mini sparkline (no labels, for fleet cards)
export function Sparkline({ points, width = 80, height = 32, color }: {
  points: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  if (!points || points.length < 2) {
    return <div style={{ width, height, background: 'rgba(255,255,255,0.04)', borderRadius: 4 }} />;
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const px = (i: number) => (i / (points.length - 1)) * width;
  const py = (v: number) => height - ((v - min) / range) * height;
  const d = points.map((v, i) => `${i === 0 ? 'M' : 'L'}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  const lineColor = color || (last >= 0 ? '#1D9E75' : '#D85A30');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width, height, display: 'block' }}>
      <path d={d} fill="none" stroke={lineColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

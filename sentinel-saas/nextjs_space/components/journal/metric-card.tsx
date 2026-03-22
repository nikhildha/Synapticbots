'use client';

import { motion } from 'framer-motion';

interface MetricCardProps {
  label: string;
  value: string;
  sub?: string;
  color?: string;
  trend?: 'up' | 'down' | 'neutral';
  delay?: number;
}

export function MetricCard({ label, value, sub, color, trend, delay = 0 }: MetricCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
      style={{
        background: 'rgba(17,24,39,0.85)',
        backdropFilter: 'blur(14px)',
        border: '1px solid rgba(255,255,255,0.07)',
        borderRadius: '14px',
        padding: '16px 18px',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Subtle accent bar at top */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: '2px',
        background: color || 'rgba(62,94,166,0.6)',
        borderRadius: '14px 14px 0 0',
      }} />

      <div style={{
        fontSize: '10px', fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: '1.2px', color: '#6B7280', marginBottom: '8px',
      }}>
        {label}
      </div>

      <div style={{
        fontSize: '21px', fontWeight: 700,
        color: color || '#F0F4F8',
        display: 'flex', alignItems: 'center', gap: '6px',
      }}>
        {value}
        {trend && (
          <span style={{
            fontSize: '12px',
            color: trend === 'up' ? '#1D9E75' : trend === 'down' ? '#D85A30' : '#6B7280',
          }}>
            {trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→'}
          </span>
        )}
      </div>

      {sub && (
        <div style={{ fontSize: '11px', color: '#6B7280', marginTop: '5px', lineHeight: 1.4 }}>
          {sub}
        </div>
      )}
    </motion.div>
  );
}

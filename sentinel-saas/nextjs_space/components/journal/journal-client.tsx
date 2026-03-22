'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Header } from '@/components/header';
import { PaperJournal } from '@/components/journal/paper-journal';
import { LiveJournal } from '@/components/journal/live-journal';
import { CompareView } from '@/components/journal/compare-view';
import { FleetDashboard } from '@/components/journal/fleet-dashboard';

const BRAND_BLUE = '#3E5EA6';

const TABS = [
  { id: 'paper', label: '🟢 Paper', sub: 'Simulation Journal' },
  { id: 'live', label: '⚡ Live', sub: 'Exchange Journal' },
  { id: 'compare', label: '📊 Compare', sub: 'Drift Analysis' },
  { id: 'fleet', label: '🤖 Fleet', sub: 'Bot Rankings' },
] as const;

type TabId = typeof TABS[number]['id'];

export function JournalClient() {
  const [activeTab, setActiveTab] = useState<TabId>('paper');

  return (
    <div style={{ minHeight: '100vh', background: '#0B0F1A', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <Header />
      <div style={{ padding: '28px 24px', paddingTop: '90px' }}>
        {/* Page Header */}
        <div style={{ marginBottom: '28px' }}>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#F0F4F8', letterSpacing: '-0.5px', marginBottom: '6px' }}>
            Trade Journal
          </div>
          <div style={{ fontSize: '13px', color: '#6B7280' }}>
            Strategy validation · Execution intelligence · Bot performance
          </div>
        </div>

        {/* Tab Bar */}
        <div style={{
          display: 'flex', gap: '4px', marginBottom: '24px',
          background: 'rgba(17,24,39,0.8)',
          border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: '14px', padding: '5px',
          width: 'fit-content',
        }}>
          {TABS.map(tab => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  padding: '8px 18px',
                  borderRadius: '10px',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: 600,
                  background: isActive ? BRAND_BLUE : 'transparent',
                  color: isActive ? '#fff' : '#6B7280',
                  transition: 'all 0.18s ease',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '1px',
                  minWidth: '110px',
                }}
              >
                <span>{tab.label}</span>
                <span style={{ fontSize: '9px', fontWeight: 500, opacity: 0.7, letterSpacing: '0.4px', textTransform: 'uppercase' }}>{tab.sub}</span>
              </button>
            );
          })}
        </div>

        {/* Tab Content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.25 }}
          >
            {activeTab === 'paper' && <PaperJournal />}
            {activeTab === 'live' && <LiveJournal />}
            {activeTab === 'compare' && <CompareView />}
            {activeTab === 'fleet' && <FleetDashboard />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

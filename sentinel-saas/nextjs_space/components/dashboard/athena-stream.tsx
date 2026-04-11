'use client';
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronUp, Bot, ArrowRight, ShieldAlert } from 'lucide-react';

export function AthenaIntelligenceFeed({ vetoLog }: { vetoLog: any[] }) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const isEmpty = !vetoLog || vetoLog.length === 0;

  return (
    <div className="flex flex-col w-full bg-[#0E1117] border border-[#222] rounded-xl overflow-hidden mb-8">
      <div className="flex items-center gap-2 px-4 py-3 bg-[#13161d] border-b border-[#222]">
        <Bot size={16} className="text-blue-400" />
        <h3 className="text-sm font-bold tracking-wide text-white/90 uppercase">
          Athena Intelligence Hub
        </h3>
        <span className="text-xs text-white/40 ml-auto font-mono">{vetoLog.length} recent decisions</span>
      </div>

      <div className="flex flex-col max-h-[300px] overflow-y-auto hide-scrollbar">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center p-8 text-center bg-white/[0.01]">
            <Bot size={32} className="text-blue-500/20 mb-3" />
            <p className="text-sm font-semibold text-white/40">No recent verdicts.</p>
            <p className="text-xs text-white/30 max-w-sm mt-1">Athena has not filtered any trades in the recent engine cycles.</p>
          </div>
        ) : (
          vetoLog.slice(0, 10).map((log, i) => {
            const isExpanded = expandedId === i;
          
          // Determine type based on reason
          const isExecute = log.reason?.toLowerCase().includes('execute') || log.reason?.toLowerCase().includes('approved');
          const isVeto = !isExecute;
          
          const icon = isExecute ? (
             <ArrowRight size={14} className="text-green-400" />
          ) : (
             <ShieldAlert size={14} className="text-red-400" />
          );

          return (
            <div key={i} className="flex flex-col border-b border-[#222]/50 last:border-0 hover:bg-white/[0.02] transition-colors">
              <button 
                onClick={() => setExpandedId(isExpanded ? null : i)}
                className="flex items-center gap-3 px-4 py-3 w-full text-left"
              >
                <div className="flex-shrink-0 mt-0.5">{icon}</div>
                
                <div className="flex-1 font-mono text-xs flex items-center gap-2">
                  <span className={`font-bold ${isExecute ? 'text-green-400' : 'text-red-400'}`}>
                    [{isExecute ? 'EXECUTE' : 'VETO'}]
                  </span>
                  <span className="text-white/90">{log.symbol}</span>
                  <span className="text-white/40 truncate max-w-[300px]">
                    {log.reason || 'Momentum misalignment detected.'}
                  </span>
                </div>

                <div className="text-white/30 flex-shrink-0 ml-4 group-hover:text-white/70 transition-colors">
                  {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </div>
              </button>

              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="px-4 pb-4 pt-1 ml-7 mr-4 font-mono text-[11px] leading-relaxed text-white/60 bg-[#0A0C10]/50 rounded mb-3 border border-[#222]/50 p-3">
                      {log.athena_raw ? (
                        // If we have the raw markdown/text response from Athena, show it
                        <div className="whitespace-pre-wrap">{log.athena_raw}</div>
                      ) : (
                        // Fallback structured display
                        <div className="flex flex-col gap-2">
                          <div>
                            <span className="text-white/40">Timestamp: </span>
                            <span className="text-white/80">{new Date(log.timestamp).toLocaleString()}</span>
                          </div>
                          <div>
                            <span className="text-white/40">Direction: </span>
                            <span className="text-white/80">{log.direction}</span>
                          </div>
                          <div>
                            <span className="text-white/40">Engine Verdict: </span>
                            <span className="text-white/80">{log.reason}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        }))}
      </div>
    </div>
  );
}

"use client";

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { EnrichmentRun } from '@/types/csv';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent } from '@/components/ui/card';
import { Activity, Sparkles, Zap, Loader2 } from 'lucide-react';
import { formatNumber } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';

interface EnrichmentMonitorProps {
  uploadJobId: string;
  onComplete: (nextStatus: string) => void;
}

// --- Animated "AI working" visualization ---

const SAMPLE_FIELDS = [
  'brand', 'product_type', 'material', 'color', 'weight',
  'dimensions', 'country_of_origin', 'target_audience',
  'compatibility', 'warranty', 'power_rating', 'flavor',
  'volume_ml', 'is_rechargeable', 'pack_quantity',
];

const CHAR_POOL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._';

type FieldAnim = { name: string; value: string; state: 'scramble' | 'typing' | 'done' | 'idle' };

function AIWorkingVisualization({ isRunning }: { isRunning: boolean }) {
  const [fields, setFields] = useState<FieldAnim[]>([]);
  const [pulse, setPulse] = useState(false);
  const stateRef = useRef({ fieldIdx: 0, charIdx: 0, scrambleCount: 0 });
  const targetsRef = useRef<string[]>([]);
  const cycleRef = useRef(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const resetRef = useRef<NodeJS.Timeout | null>(null);

  const initCycle = useCallback(() => {
    // Clean up any existing timers
    if (timerRef.current) clearInterval(timerRef.current);
    if (resetRef.current) clearTimeout(resetRef.current);

    const shuffled = [...SAMPLE_FIELDS].sort(() => Math.random() - 0.5).slice(0, 6);
    targetsRef.current = shuffled.map(() => {
      const len = 4 + Math.floor(Math.random() * 12);
      return Array.from({ length: len }, () => CHAR_POOL[Math.floor(Math.random() * CHAR_POOL.length)]).join('');
    });
    stateRef.current = { fieldIdx: 0, charIdx: 0, scrambleCount: 0 };
    setFields(shuffled.map(name => ({ name, value: '', state: 'idle' })));

    timerRef.current = setInterval(() => {
      const s = stateRef.current;
      const targets = targetsRef.current;

      if (s.fieldIdx >= targets.length) {
        if (timerRef.current) clearInterval(timerRef.current);
        resetRef.current = setTimeout(() => {
          cycleRef.current++;
          initCycle();
        }, 600);
        return;
      }

      setFields(prev => {
        const next = prev.map(f => ({ ...f }));
        const fi = s.fieldIdx;
        if (fi >= next.length) return prev;
        const current = next[fi];
        const target = targets[fi];

        if (current.state === 'idle') {
          current.state = 'scramble';
          s.scrambleCount = 0;
        }

        if (current.state === 'scramble') {
          const scrambleLen = Math.min(target.length, 3 + s.scrambleCount);
          current.value = Array.from({ length: scrambleLen }, () =>
            CHAR_POOL[Math.floor(Math.random() * CHAR_POOL.length)]
          ).join('');
          s.scrambleCount++;
          if (s.scrambleCount > 5) {
            current.state = 'typing';
            s.charIdx = 0;
          }
        } else if (current.state === 'typing') {
          s.charIdx = Math.min(s.charIdx + 2, target.length);
          const revealed = target.slice(0, s.charIdx);
          const remaining = target.length - s.charIdx;
          const scrambled = Array.from({ length: remaining }, () =>
            CHAR_POOL[Math.floor(Math.random() * CHAR_POOL.length)]
          ).join('');
          current.value = revealed + scrambled;
          if (s.charIdx >= target.length) {
            current.state = 'done';
            current.value = target;
            s.fieldIdx++;
            s.charIdx = 0;
            s.scrambleCount = 0;
          }
        }

        return next;
      });
    }, 45);
  }, []);

  useEffect(() => {
    if (!isRunning) return;
    initCycle();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (resetRef.current) clearTimeout(resetRef.current);
    };
  }, [isRunning, initCycle]);

  useEffect(() => {
    if (!isRunning) return;
    const t = setInterval(() => setPulse(p => !p), 2000);
    return () => clearInterval(t);
  }, [isRunning]);

  if (!isRunning || fields.length === 0) return null;

  return (
    <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-zinc-50 via-white to-blue-50/30 dark:from-zinc-950 dark:via-zinc-900 dark:to-blue-950/20">
      <CardContent className="p-0">
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/60 to-transparent animate-pulse" />

        <div className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="relative">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-primary animate-ping" />
            </div>
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              AI Enrichment Live
            </span>
          </div>

          <div className="space-y-1.5">
            {fields.map((field, i) => (
              <div
                key={`${field.name}-${i}`}
                className="flex items-center gap-3 rounded-md px-3 py-1.5 transition-all duration-200"
                style={{
                  background: field.state === 'scramble' || field.state === 'typing'
                    ? 'rgba(59, 130, 246, 0.06)'
                    : field.state === 'done'
                    ? 'rgba(16, 185, 129, 0.04)'
                    : 'transparent',
                }}
              >
                <span className="text-xs font-mono text-muted-foreground w-[140px] shrink-0 truncate">
                  {field.name}
                </span>
                <span className={`text-[10px] transition-colors duration-200 ${
                  field.state === 'done' ? 'text-emerald-500' :
                  field.state === 'idle' ? 'text-zinc-300 dark:text-zinc-700' : 'text-primary'
                }`}>
                  {field.state === 'done' ? '✓' : '→'}
                </span>
                <div className="flex-1 min-w-0 overflow-hidden">
                  {field.state === 'idle' ? (
                    <div className="h-3.5 w-20 rounded bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
                  ) : (
                    <span className={`text-xs font-mono truncate block ${
                      field.state === 'scramble' ? 'text-primary/50 blur-[0.3px]' :
                      field.state === 'typing' ? 'text-primary' :
                      'text-emerald-600 dark:text-emerald-400'
                    }`}>
                      {field.value}
                    </span>
                  )}
                </div>
                {(field.state === 'scramble' || field.state === 'typing') && (
                  <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse shrink-0" />
                )}
                {field.state === 'done' && (
                  <Zap className="h-3 w-3 text-emerald-500 shrink-0" />
                )}
              </div>
            ))}
          </div>

          <div className="mt-4 h-px relative overflow-hidden">
            <div
              className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-primary/40 to-transparent"
              style={{ animation: 'scan 2s ease-in-out infinite' }}
            />
          </div>
        </div>
      </CardContent>

      <style jsx>{`
        @keyframes scan {
          0% { left: -33%; }
          100% { left: 100%; }
        }
      `}</style>
    </Card>
  );
}

// --- Main component ---

export function EnrichmentMonitor({ uploadJobId, onComplete }: EnrichmentMonitorProps) {
  const { accessToken } = useAuth();
  const [run, setRun] = useState<any>(null);
  const [tokensUsed, setTokensUsed] = useState(0);

  const pollStatus = useCallback(async () => {
    if (!uploadJobId || !accessToken) return;
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_CSV_API_URL || 'http://localhost:4001'}/uploads/${uploadJobId}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (res.ok) {
        const data = await res.json();

        if (data.enrichmentRun) {
          setRun(data.enrichmentRun);
          setTokensUsed(data.enrichmentRun.tokensUsed || 0);
        }

        if (data.status === 'needs_collision_review') {
          onComplete('NEEDS_COLLISION_REVIEW');
        } else if (data.status === 'ready') {
          onComplete('READY');
        }
      }
    } catch (err) {
      console.error('Failed to poll enrichment:', err);
    }
  }, [uploadJobId, accessToken, onComplete]);

  useEffect(() => {
    pollStatus();
    const interval = setInterval(pollStatus, 2000);
    return () => clearInterval(interval);
  }, [pollStatus]);

  if (!run) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center">
        <Loader2 className="h-10 w-10 text-primary/40 animate-spin mb-4" />
        <p className="text-muted-foreground font-medium animate-pulse">Initializing AI enrichment workers...</p>
      </div>
    );
  }

  const isPaused = run.status === 'paused';
  const isRunning = run.status === 'running';
  const progressPercent = run.totalItems > 0 ? (run.processedItems / run.totalItems) * 100 : 0;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold flex items-center gap-2">
          {isRunning && <Activity className="h-5 w-5 text-primary animate-pulse" />}
          Enrichment in Progress
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          AI is processing your catalog against the approved schema.
        </p>
      </div>

      {/* Progress card */}
      <Card>
        <CardContent className="p-6">
          <div className="flex justify-between items-end mb-2">
            <div>
              <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-1">Overall Progress</p>
              <p className="text-2xl font-bold">{Math.round(progressPercent)}%</p>
            </div>
            <div className="text-sm font-medium text-right">
              <span className="text-primary">{formatNumber(run.processedItems)}</span>
              <span className="text-muted-foreground"> / {formatNumber(run.totalItems)} items</span>
            </div>
          </div>

          <div className="relative">
            <Progress value={progressPercent} className={`h-3 ${isPaused ? 'opacity-50' : ''}`} />
            {isPaused && (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-[10px] font-bold tracking-widest uppercase bg-background/80 px-2 rounded text-muted-foreground backdrop-blur-sm">
                  Paused
                </span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-4 mt-8 pt-6 border-t">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Items Failed</p>
              <p className="text-lg font-semibold text-rose-600 dark:text-rose-400">{run.failedItems || 0}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Status</p>
              <p className="text-lg font-semibold capitalize">{run.status}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Tokens Used</p>
              <p className="text-lg font-semibold">{formatNumber(tokensUsed)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* AI working animation */}
      <AIWorkingVisualization isRunning={isRunning} />
    </div>
  );
}

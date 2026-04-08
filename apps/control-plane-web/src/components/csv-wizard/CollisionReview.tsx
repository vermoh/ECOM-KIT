"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { Collision } from '@/types/csv';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Check, X, AlertTriangle, Filter, Loader2 } from 'lucide-react';
import { PermissionGate } from '@/components/auth/PermissionGate';
import { useAuth } from '@/context/AuthContext';

interface CollisionReviewProps {
  projectId: string;
  uploadJobId: string;
  onResolvedAll: () => void;
}

export function CollisionReview({ projectId, uploadJobId, onResolvedAll }: CollisionReviewProps) {
  const { accessToken } = useAuth();
  const [items, setItems] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [resolvingIds, setResolvingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    async function loadCollisions() {
      if (!projectId || !uploadJobId || !accessToken) return;
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_CSV_API_URL || 'http://localhost:4001'}/projects/${projectId}/jobs/${uploadJobId}/collisions`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        if (res.ok) {
          const data = await res.json();
          // mapped to frontend format
          const mapped = data.map((c: any) => {
            let suggestedValues: string[] = [];
            try {
              if (c.suggestedValues) suggestedValues = JSON.parse(c.suggestedValues);
            } catch { /* ignore parse errors */ }

            // Extract product name from rawData for display
            let productName = '';
            try {
              if (c.item?.rawData) {
                const raw = JSON.parse(c.item.rawData);
                productName = raw.name || raw['Имя [Ru]'] || raw['Название'] || raw['название'] || raw.title || raw.Name || raw.Title || Object.values(raw).find((v: any) => typeof v === 'string' && v.length > 3 && v.length < 200) as string || '';
              }
            } catch { /* ignore */ }

            // Get the enriched value for this field (AI's best guess)
            let enrichedValue: string | null = null;
            try {
              if (c.item?.enrichedData) {
                const ed = JSON.parse(c.item.enrichedData);
                enrichedValue = ed[c.field] != null ? String(ed[c.field]) : null;
              }
            } catch { /* ignore */ }

            return {
              id: c.id,
              sku: c.item?.skuExternalId || 'unknown',
              productName,
              field: c.field,
              type: c.reason,
              severity: c.severity || null,
              explanation: c.explanation || null,
              confidence: c.item?.confidence ?? null,
              valueA: c.originalValue || '',
              valueB: enrichedValue,
              suggestedValues,
              status: c.status,
              resolvedValue: c.resolvedValue
            };
          });
          setItems(mapped);

          // Auto complete if empty
          if (mapped.length === 0) {
            onResolvedAll();
          }
        }
      } catch (err) {
        console.error('Failed to load collisions:', err);
      } finally {
        setIsLoading(false);
      }
    }
    loadCollisions();
  }, [projectId, uploadJobId, accessToken, onResolvedAll]);
  
  const handleResolve = async (id: string, value: string) => {
    if (!value || resolvingIds.has(id)) return;
    setResolvingIds(prev => new Set(prev).add(id));
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_CSV_API_URL || 'http://localhost:4001'}/collisions/${id}/resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({ resolvedValue: value })
      });
      if (res.ok) {
        setItems(prev => prev.map(c => c.id === id ? { ...c, status: 'resolved', resolvedValue: value } : c));
      }
    } catch (err) {
      console.error('Failed to resolve:', err);
    } finally {
      setResolvingIds(prev => { const next = new Set(prev); next.delete(id); return next; });
    }
  };

  const handleDismiss = async (id: string) => {
    if (resolvingIds.has(id)) return;
    setResolvingIds(prev => new Set(prev).add(id));
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_CSV_API_URL || 'http://localhost:4001'}/collisions/${id}/dismiss`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (res.ok) {
        setItems(prev => prev.map(c => c.id === id ? { ...c, status: 'ignored' } : c));
      }
    } catch (err) {
      console.error('Failed to dismiss:', err);
    } finally {
      setResolvingIds(prev => { const next = new Set(prev); next.delete(id); return next; });
    }
  };

  const [acceptingAll, setAcceptingAll] = useState(false);
  const [filterReason, setFilterReason] = useState<string>('all');
  const [filterField, setFilterField] = useState<string>('all');
  const [filterSeverity, setFilterSeverity] = useState<string>('all');

  // Compute unique values for filters
  const uniqueReasons = useMemo(() => [...new Set(items.map(i => i.type))], [items]);
  const uniqueFields = useMemo(() => [...new Set(items.map(i => i.field))], [items]);
  const uniqueSeverities = useMemo(() => [...new Set(items.map(i => i.severity).filter(Boolean))], [items]);

  // Apply filters
  const filteredItems = useMemo(() => {
    return items.filter(i => {
      if (filterReason !== 'all' && i.type !== filterReason) return false;
      if (filterField !== 'all' && i.field !== filterField) return false;
      if (filterSeverity !== 'all' && i.severity !== filterSeverity) return false;
      return true;
    });
  }, [items, filterReason, filterField, filterSeverity]);

  const handleAcceptAllDefaults = async () => {
    const pending = items.filter(i => i.status === 'pending_review' || i.status === 'detected');
    if (pending.length === 0 || acceptingAll) return;
    setAcceptingAll(true);
    try {
      // Use batch resolve endpoint
      const res = await fetch(`${process.env.NEXT_PUBLIC_CSV_API_URL || 'http://localhost:4001'}/uploads/${uploadJobId}/collisions/batch-resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({ action: 'accept_ai' })
      });
      if (res.ok) {
        const data = await res.json();
        setItems(prev => prev.map(c => {
          if (c.status === 'detected' || c.status === 'pending_review') {
            return { ...c, status: 'resolved', resolvedValue: c.valueB || c.valueA };
          }
          return c;
        }));
        console.log(`[Batch Resolve] Resolved ${data.resolved} collisions`);
      }
    } catch (err) {
      console.error('Failed to batch resolve:', err);
    } finally {
      setAcceptingAll(false);
    }
  };

  const pendingCount = items.filter(i => i.status === 'pending_review' || i.status === 'detected').length;

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="mt-4 text-muted-foreground font-medium">Loading AI collisions...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2 text-amber-600 dark:text-amber-500">
            <AlertTriangle className="h-5 w-5" />
            Collision Review
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            AI flagged these values as uncertain. For each, you can: accept the current value, pick an alternative, type a manual override, or dismiss. Click &apos;Accept All Defaults&apos; to skip this step.
          </p>
        </div>
        
        <PermissionGate permission="collision:resolve">
          <div className="flex gap-2">
            {pendingCount > 0 && (
              <Button
                variant="outline"
                onClick={handleAcceptAllDefaults}
                disabled={acceptingAll}
              >
                {acceptingAll ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Accepting...</>
                ) : (
                  `Accept All Defaults (${pendingCount})`
                )}
              </Button>
            )}
            <Button
              onClick={() => onResolvedAll()}
              disabled={pendingCount > 0 || acceptingAll}
              className={pendingCount === 0 ? "bg-emerald-600 hover:bg-emerald-700 text-white" : ""}
            >
              {`Complete Review${pendingCount > 0 ? ` (${pendingCount} left)` : ''}`}
            </Button>
          </div>
        </PermissionGate>
      </div>

      {/* Filters */}
      {items.length > 3 && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select value={filterReason} onValueChange={(v) => setFilterReason(v ?? 'all')}>
            <SelectTrigger className="h-8 w-[160px]">
              <SelectValue placeholder="All reasons" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All reasons</SelectItem>
              {uniqueReasons.map(r => (
                <SelectItem key={r} value={r}>{r.replace(/_/g, ' ')}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterField} onValueChange={(v) => setFilterField(v ?? 'all')}>
            <SelectTrigger className="h-8 w-[160px]">
              <SelectValue placeholder="All fields" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All fields</SelectItem>
              {uniqueFields.map(f => (
                <SelectItem key={f} value={f}>{f}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {uniqueSeverities.length > 0 && (
            <Select value={filterSeverity} onValueChange={(v) => setFilterSeverity(v ?? 'all')}>
              <SelectTrigger className="h-8 w-[140px]">
                <SelectValue placeholder="All severities" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All severities</SelectItem>
                {uniqueSeverities.map(s => (
                  <SelectItem key={s!} value={s!}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <span className="text-xs text-muted-foreground ml-auto">
            {filteredItems.length} of {items.length}
          </span>
        </div>
      )}

      <div className="space-y-4">
        {filteredItems.map((col) => {
          const isResolved = col.status === 'resolved' || col.status === 'dismissed';
          
          return (
            <Card key={col.id} className={isResolved ? "opacity-60 bg-muted/30" : "border-amber-200 dark:border-amber-900/50"}>
              <CardContent className="p-4">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center flex-wrap gap-2 mb-1">
                       {col.productName && (
                         <span className="text-sm font-semibold truncate max-w-[280px]" title={col.productName}>
                           {col.productName}
                         </span>
                       )}
                       <span className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground shrink-0">
                         {col.sku}
                       </span>
                       <Badge variant="outline" className="capitalize text-amber-600 border-amber-200 text-[10px] shrink-0">
                         {col.type.replace(/_/g, ' ')}
                       </Badge>
                       {col.severity && (
                         <Badge variant="outline" className={`text-[10px] shrink-0 ${
                           col.severity === 'critical' ? 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400' :
                           col.severity === 'warning' ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400' :
                           'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400'
                         }`}>
                           {col.severity}
                         </Badge>
                       )}
                       {col.confidence != null && (
                         <Badge variant="outline" className="text-[10px] shrink-0 font-mono">
                           {col.confidence}%
                         </Badge>
                       )}
                    </div>
                    <p className="text-sm">
                      <span className="text-muted-foreground">Field:</span> <span className="font-medium">{col.field}</span>
                    </p>
                    {col.explanation && (
                      <p className="text-xs text-muted-foreground mt-0.5">{col.explanation}</p>
                    )}
                  </div>
                  
                  {!isResolved ? (
                    <div className="flex flex-col gap-2 flex-1 lg:flex-[2]">
                      {/* Row 1: AI value + Original value */}
                      <div className="flex flex-col sm:flex-row gap-2">
                        {col.valueA && (
                          <Button
                            variant="outline"
                            onClick={() => handleResolve(col.id, col.valueA)}
                            className="flex-1 shrink-0 justify-start h-auto py-2 px-3 break-words whitespace-normal text-left"
                          >
                            <span className="text-xs text-muted-foreground mr-2 w-16 shrink-0">Current:</span>
                            <span>{col.valueA}</span>
                          </Button>
                        )}

                        {col.valueB && col.valueB !== col.valueA && (
                          <Button
                            variant="outline"
                            onClick={() => handleResolve(col.id, col.valueB!)}
                            className="flex-1 shrink-0 justify-start h-auto py-2 px-3 break-words whitespace-normal text-left border-primary/30 hover:border-primary/60"
                          >
                            <span className="text-xs text-muted-foreground mr-2 w-16 shrink-0">AI Suggests:</span>
                            <span className="font-medium">{col.valueB}</span>
                          </Button>
                        )}
                      </div>

                      {/* Row 2: Suggested alternatives */}
                      {col.suggestedValues && col.suggestedValues.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          <span className="text-xs text-muted-foreground self-center mr-1">Alternatives:</span>
                          {col.suggestedValues.map((sv: string, idx: number) => (
                            <Button
                              key={idx}
                              variant="outline"
                              size="sm"
                              onClick={() => handleResolve(col.id, sv)}
                              className="h-7 px-2.5 text-xs border-blue-200 dark:border-blue-800 hover:bg-blue-50 dark:hover:bg-blue-950 hover:border-blue-400"
                            >
                              {sv}
                            </Button>
                          ))}
                        </div>
                      )}

                      {/* Row 3: Manual input + dismiss */}
                      <div className="flex gap-2 items-stretch">
                         <Input
                           placeholder="Manual override..."
                           className="flex-1"
                           onKeyDown={(e) => {
                             if (e.key === 'Enter' && e.currentTarget.value.trim()) handleResolve(col.id, e.currentTarget.value.trim());
                           }}
                           onBlur={(e) => {
                             if (e.target.value.trim()) handleResolve(col.id, e.target.value.trim());
                           }}
                         />
                         <Button variant="ghost" size="icon" onClick={() => handleDismiss(col.id)} title="Dismiss/Ignore">
                            <X className="h-4 w-4 text-muted-foreground" />
                         </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 px-4 py-2 rounded-lg">
                      <Check className="h-5 w-5" />
                      <span className="text-sm font-medium">
                        {col.status === 'dismissed' ? 'Dismissed' : `Resolved to: ${col.resolvedValue}`}
                      </span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

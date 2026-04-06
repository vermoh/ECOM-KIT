"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/context/AuthContext';
import { Loader2, ArrowUp, ArrowDown, ArrowUpDown, Activity, BarChart3, AlertTriangle, DollarSign } from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface OrgUsage {
  orgId: string;
  orgName: string;
  plan: string;
  tokensUsed: number;
  totalTokens: number;
  remainingTokens: number;
  projectCount: number;
  lastActivity: string | null;
  totalCostUsd: number;
}

type SortKey = keyof OrgUsage | '';
type SortDir = 'asc' | 'desc';

export default function UsagePage() {
  const { accessToken } = useAuth();
  const [data, setData] = useState<OrgUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>('tokensUsed');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const fetchUsage = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/v1/admin/usage`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        const raw = await res.json();
        const list: OrgUsage[] = Array.isArray(raw) ? raw : (raw.usage ?? raw.organizations ?? []);
        setData(list);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchUsage();
  }, [fetchUsage]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const sorted = useMemo(() => {
    if (!sortKey) return data;
    return [...data].sort((a, b) => {
      const av = a[sortKey as keyof OrgUsage];
      const bv = b[sortKey as keyof OrgUsage];
      if (av == null) return 1;
      if (bv == null) return -1;
      let cmp = 0;
      if (typeof av === 'number' && typeof bv === 'number') {
        cmp = av - bv;
      } else {
        cmp = String(av).localeCompare(String(bv));
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [data, sortKey, sortDir]);

  // Summary stats
  const totalConsumed = data.reduce((s, r) => s + (r.tokensUsed ?? 0), 0);
  const totalCost = data.reduce((s, r) => s + (Number(r.totalCostUsd) || 0), 0);
  const avgPerOrg = data.length > 0 ? Math.round(totalConsumed / data.length) : 0;
  const nearLimit = data.filter((r) => {
    if (!r.totalTokens) return false;
    const remaining = r.remainingTokens ?? r.totalTokens - r.tokensUsed;
    return remaining / r.totalTokens < 0.2;
  }).length;

  const getUsagePct = (row: OrgUsage) => {
    if (!row.totalTokens) return 0;
    const used = row.tokensUsed ?? (row.totalTokens - row.remainingTokens);
    return Math.min(100, Math.round((used / row.totalTokens) * 100));
  };

  const rowBg = (pct: number) => {
    if (pct >= 90) return 'bg-red-50 dark:bg-red-950/20';
    if (pct >= 80) return 'bg-amber-50 dark:bg-amber-950/20';
    return '';
  };

  const planVariant = (plan: string): 'default' | 'secondary' | 'outline' => {
    if (plan === 'enterprise') return 'default';
    if (plan === 'pro') return 'secondary';
    return 'outline';
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ArrowUpDown className="ml-1 h-3 w-3 inline opacity-40" />;
    return sortDir === 'asc'
      ? <ArrowUp className="ml-1 h-3 w-3 inline text-blue-500" />
      : <ArrowDown className="ml-1 h-3 w-3 inline text-blue-500" />;
  };

  const SortableHead = ({ col, children, right }: { col: SortKey; children: React.ReactNode; right?: boolean }) => (
    <TableHead
      className={`cursor-pointer select-none hover:text-foreground transition-colors ${right ? 'text-right' : ''}`}
      onClick={() => handleSort(col)}
    >
      {children}
      <SortIcon col={col} />
    </TableHead>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Usage Overview</h1>
        <p className="text-muted-foreground mt-2">
          Aggregate AI token consumption across all organizations.
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="bg-zinc-50/50 dark:bg-zinc-900/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">Total Tokens Consumed</CardTitle>
            <BarChart3 className="h-4 w-4 text-zinc-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalConsumed.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground mt-1">across {data.length} organizations</p>
          </CardContent>
        </Card>

        <Card className="bg-zinc-50/50 dark:bg-zinc-900/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">Avg Usage Per Org</CardTitle>
            <Activity className="h-4 w-4 text-zinc-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{avgPerOrg.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground mt-1">tokens per organization</p>
          </CardContent>
        </Card>

        <Card className="bg-zinc-50/50 dark:bg-zinc-900/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">Orgs Near Limit</CardTitle>
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${nearLimit > 0 ? 'text-amber-500' : ''}`}>
              {nearLimit}
            </div>
            <p className="text-xs text-muted-foreground mt-1">&lt;20% remaining</p>
          </CardContent>
        </Card>

        <Card className="bg-zinc-50/50 dark:bg-zinc-900/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">Total Cost ($)</CardTitle>
            <DollarSign className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${totalCost.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground mt-1">across all organizations</p>
          </CardContent>
        </Card>
      </div>

      {/* Sortable Table */}
      <Card>
        <CardHeader>
          <CardTitle>Per-Organization Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
            </div>
          ) : sorted.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10 italic">
              No usage data available.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHead col="orgName">Org Name</SortableHead>
                  <SortableHead col="plan">Plan</SortableHead>
                  <SortableHead col="tokensUsed" right>Tokens Used</SortableHead>
                  <SortableHead col="totalCostUsd" right>Cost ($)</SortableHead>
                  <SortableHead col="totalTokens" right>Token Limit</SortableHead>
                  <SortableHead col="remainingTokens" right>Remaining</SortableHead>
                  <SortableHead col="projectCount" right>Projects</SortableHead>
                  <SortableHead col="lastActivity">Last Activity</SortableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((row) => {
                  const pct = getUsagePct(row);
                  const remaining = row.remainingTokens ?? (row.totalTokens - row.tokensUsed);
                  return (
                    <TableRow key={row.orgId} className={rowBg(pct)}>
                      <TableCell className="font-medium">{row.orgName}</TableCell>
                      <TableCell>
                        <Badge variant={planVariant(row.plan)} className="capitalize">
                          {row.plan}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {(row.tokensUsed ?? 0).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        ${Number(row.totalCostUsd).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {(row.totalTokens ?? 0).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        <span
                          className={
                            pct >= 90
                              ? 'text-red-500 font-semibold'
                              : pct >= 80
                              ? 'text-amber-500 font-semibold'
                              : ''
                          }
                        >
                          {remaining.toLocaleString()}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {(row.projectCount ?? 0).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {row.lastActivity
                          ? new Date(row.lastActivity).toLocaleDateString() +
                            ' ' +
                            new Date(row.lastActivity).toLocaleTimeString()
                          : '—'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

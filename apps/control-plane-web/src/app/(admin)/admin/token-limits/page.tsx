"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { useAuth } from '@/context/AuthContext';
import { Loader2, Pencil } from 'lucide-react';
import { useTranslations } from 'next-intl';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface OrgUsage {
  orgId: string;
  orgName: string;
  plan: string;
  totalTokens: number;
  remainingTokens: number;
  tokensUsed: number;
}

export default function TokenLimitsPage() {
  const { accessToken } = useAuth();
  const t = useTranslations('admin.tokenLimits');
  const tc = useTranslations('common');

  const [usageData, setUsageData] = useState<OrgUsage[]>([]);
  const [loading, setLoading] = useState(true);

  // Edit dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<OrgUsage | null>(null);
  const [editTotal, setEditTotal] = useState('');
  const [editReset, setEditReset] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState('');

  const fetchUsage = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/v1/admin/usage`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        const list: OrgUsage[] = Array.isArray(data) ? data : (data.usage ?? data.organizations ?? []);
        setUsageData(list);
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

  const openEdit = (row: OrgUsage) => {
    setEditTarget(row);
    setEditTotal(String(row.totalTokens));
    setEditReset(false);
    setEditError('');
    setEditOpen(true);
  };

  const handleSaveLimit = async () => {
    if (!editTarget) return;
    const totalTokens = parseInt(editTotal, 10);
    if (!totalTokens || totalTokens < 1) {
      setEditError('Enter a valid token limit.');
      return;
    }
    setEditError('');
    setEditLoading(true);
    try {
      const res = await fetch(`${API}/api/v1/billing/budget/limit`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ orgId: editTarget.orgId, totalTokens, resetRemaining: editReset }),
      });
      if (res.ok) {
        setEditOpen(false);
        setEditTarget(null);
        await fetchUsage();
      } else {
        const err = await res.json().catch(() => ({}));
        setEditError(err.error ?? `Error ${res.status}`);
      }
    } catch {
      setEditError('Network error');
    } finally {
      setEditLoading(false);
    }
  };

  const getUsagePct = (row: OrgUsage) => {
    if (!row.totalTokens) return 0;
    const used = row.tokensUsed ?? (row.totalTokens - row.remainingTokens);
    return Math.min(100, Math.round((used / row.totalTokens) * 100));
  };

  const pctColor = (pct: number) => {
    if (pct >= 90) return 'text-red-500';
    if (pct >= 70) return 'text-amber-500';
    return 'text-emerald-600';
  };

  const planVariant = (plan: string): 'default' | 'secondary' | 'outline' => {
    if (plan === 'enterprise') return 'default';
    if (plan === 'pro') return 'secondary';
    return 'outline';
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground mt-2">
          {t('subtitle')}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('orgTokenBudgets')}</CardTitle>
          <CardDescription>
            {t('changesTakeEffect')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
            </div>
          ) : usageData.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10 italic">
              {t('noUsageData')}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('orgName')}</TableHead>
                  <TableHead>{t('plan')}</TableHead>
                  <TableHead className="text-right">{t('totalTokens')}</TableHead>
                  <TableHead className="text-right">{t('remaining')}</TableHead>
                  <TableHead className="w-48">{t('percentUsed')}</TableHead>
                  <TableHead className="text-right">{t('actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {usageData.map((row) => {
                  const pct = getUsagePct(row);
                  return (
                    <TableRow key={row.orgId}>
                      <TableCell className="font-medium">{row.orgName}</TableCell>
                      <TableCell>
                        <Badge variant={planVariant(row.plan)} className="capitalize">
                          {row.plan}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {row.totalTokens.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {(row.remainingTokens ?? row.totalTokens - row.tokensUsed).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress value={pct} className="h-2 flex-1" />
                          <span className={`text-xs font-semibold w-10 text-right ${pctColor(pct)}`}>
                            {pct}%
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => openEdit(row)}>
                          <Pencil className="mr-1 h-3 w-3" /> {t('editLimit')}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Edit Limit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('editLimitDialog')} {editTarget?.orgName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="edit-total-tokens">{t('totalTokensLabel')}</Label>
              <Input
                id="edit-total-tokens"
                type="number"
                min={1000}
                step={100000}
                value={editTotal}
                onChange={(e) => setEditTotal(e.target.value)}
                disabled={editLoading}
                placeholder={t('minimumTokens')}
              />
              <p className="text-xs text-muted-foreground">
                {t('currentLimit')} {editTarget?.totalTokens.toLocaleString() ?? '—'}
              </p>
            </div>
            <div className="flex items-start gap-3 rounded-md border p-3 bg-muted/40">
              <Checkbox
                id="edit-reset"
                checked={editReset}
                onCheckedChange={(checked) => setEditReset(checked === true)}
                disabled={editLoading}
              />
              <div>
                <Label htmlFor="edit-reset" className="cursor-pointer font-medium">
                  {t('resetCheckboxLabel')}
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t('resetCheckboxDescription')}
                </p>
              </div>
            </div>
            {editError && <p className="text-sm text-red-500">{editError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={editLoading}>
              {tc('cancel')}
            </Button>
            <Button onClick={handleSaveLimit} disabled={editLoading || !editTotal}>
              {editLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('saveLimit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { PermissionGate } from '@/components/auth/PermissionGate';
import { useAuth } from '@/context/AuthContext';
import { Coins, History, Loader2, Zap } from 'lucide-react';
import { formatNumber, formatDateTime } from '@/lib/utils';
import { useTranslations } from 'next-intl';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

// ── Types ──────────────────────────────────────────────────────────────────

interface Organization {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  maxUsers: number;
  maxProjects: number;
  createdAt: string;
}

interface Member {
  id: string;
  email: string;
  role: string;
  roleName?: string;
  status: string;
}

interface TokenBudget {
  id: string;
  totalTokens: number;
  remainingTokens: number;
  resetAt: string | null;
  updatedAt: string;
}

interface UsageLog {
  id: string;
  purpose: string;
  model: string;
  tokensUsed: number;
  jobId: string | null;
  createdAt: string;
}

// ── Organization Tab ───────────────────────────────────────────────────────

function OrganizationTab() {
  const { accessToken } = useAuth();
  const [org, setOrg] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);
  const t = useTranslations('settings.organizationTab');

  useEffect(() => {
    if (!accessToken) return;
    const fetchOrg = async () => {
      try {
        const res = await fetch(`${API}/api/v1/organizations`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (res.ok) {
          const data = await res.json();
          const first = Array.isArray(data) ? data[0] : data;
          setOrg(first ?? null);
        }
      } catch (err) {
        console.error('Failed to fetch organization:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchOrg();
  }, [accessToken]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-16">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (!org) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        {t('noOrgFound')}
      </p>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>
          {t('readOnly')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5 text-sm">
          <div className="space-y-1">
            <dt className="text-muted-foreground font-medium">{t('name')}</dt>
            <dd className="font-semibold">{org.name}</dd>
          </div>

          <div className="space-y-1">
            <dt className="text-muted-foreground font-medium">{t('slug')}</dt>
            <dd>
              <code className="font-mono bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded text-xs">
                {org.slug}
              </code>
            </dd>
          </div>

          <div className="space-y-1">
            <dt className="text-muted-foreground font-medium">{t('plan')}</dt>
            <dd>
              <Badge variant="secondary" className="capitalize">
                {org.plan}
              </Badge>
            </dd>
          </div>

          <div className="space-y-1">
            <dt className="text-muted-foreground font-medium">{t('status')}</dt>
            <dd>
              <Badge
                className={
                  org.status === 'active'
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400 border-0'
                    : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 border-0'
                }
              >
                {org.status}
              </Badge>
            </dd>
          </div>

          <div className="space-y-1">
            <dt className="text-muted-foreground font-medium">{t('maxUsers')}</dt>
            <dd className="font-semibold">{org.maxUsers ?? '—'}</dd>
          </div>

          <div className="space-y-1">
            <dt className="text-muted-foreground font-medium">{t('maxProjects')}</dt>
            <dd className="font-semibold">{org.maxProjects ?? '—'}</dd>
          </div>

          <div className="space-y-1 sm:col-span-2">
            <dt className="text-muted-foreground font-medium">{t('created')}</dt>
            <dd className="font-semibold">
              {org.createdAt ? formatDateTime(org.createdAt) : '—'}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}

// ── Members Tab ────────────────────────────────────────────────────────────

function MembersTab() {
  const { accessToken } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('read_only');
  const [isInviting, setIsInviting] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const t = useTranslations('settings.membersTab');

  const fetchMembers = useCallback(async () => {
    if (!accessToken) return;
    try {
      const res = await fetch(`${API}/api/v1/memberships`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setMembers(data);
      }
    } catch (err) {
      console.error('Failed to fetch members:', err);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteError('');
    if (!inviteEmail || !accessToken) return;

    setIsInviting(true);
    try {
      const res = await fetch(`${API}/api/v1/memberships/invite`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ email: inviteEmail, roleName: inviteRole }),
      });

      if (res.ok) {
        setInviteEmail('');
        setInviteRole('read_only');
        setIsDialogOpen(false);
        await fetchMembers();
      } else {
        const err = await res.json().catch(() => ({}));
        setInviteError(err.error || `Error ${res.status}`);
      }
    } catch {
      setInviteError('Network error');
    } finally {
      setIsInviting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-16">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {members.length} {members.length !== 1 ? t('members') : t('memberCount')} {t('inYourOrganization')}
        </p>
        <PermissionGate permission="user:invite">
          <Button onClick={() => setIsDialogOpen(true)}>{t('inviteUser')}</Button>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t('dialogTitle')}</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleInvite} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="invite-email">{t('emailLabel')}</Label>
                  <Input
                    id="invite-email"
                    type="email"
                    placeholder={t('emailPlaceholder')}
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    required
                    disabled={isInviting}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invite-role">{t('roleLabel')}</Label>
                  <Select
                    value={inviteRole}
                    onValueChange={(v) => v && setInviteRole(v)}
                    disabled={isInviting}
                  >
                    <SelectTrigger id="invite-role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="organization_owner">{t('organizationOwner')}</SelectItem>
                      <SelectItem value="organization_admin">{t('organizationAdmin')}</SelectItem>
                      <SelectItem value="manager">{t('manager')}</SelectItem>
                      <SelectItem value="operator">{t('operator')}</SelectItem>
                      <SelectItem value="reviewer">{t('reviewer')}</SelectItem>
                      <SelectItem value="analyst">{t('analyst')}</SelectItem>
                      <SelectItem value="read_only">{t('readOnly')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {inviteError && (
                  <p className="text-sm text-red-500">{inviteError}</p>
                )}
                <Button
                  type="submit"
                  disabled={isInviting || !inviteEmail}
                  className="w-full"
                >
                  {isInviting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {t('sendInvite')}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </PermissionGate>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('tableEmail')}</TableHead>
                <TableHead>{t('tableRole')}</TableHead>
                <TableHead>{t('tableStatus')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                    {t('noMembers')}
                  </TableCell>
                </TableRow>
              ) : (
                members.map((member) => (
                  <TableRow key={member.id}>
                    <TableCell className="font-medium">{member.email}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="capitalize">
                        {(member.role || member.roleName || 'unknown').replace(/_/g, ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={member.status === 'active' ? 'default' : 'outline'}
                      >
                        {member.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Token Usage Tab ────────────────────────────────────────────────────────

function TokenUsageTab() {
  const { accessToken } = useAuth();
  const [budget, setBudget] = useState<TokenBudget | null>(null);
  const [logs, setLogs] = useState<UsageLog[]>([]);
  const [loading, setLoading] = useState(true);
  const t = useTranslations('settings.tokenUsageTab');

  const fetchUsage = useCallback(async () => {
    if (!accessToken) return;
    try {
      const res = await fetch(`${API}/api/v1/billing/usage`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setBudget(data.budget);
        setLogs(data.recentLogs || []);
      }
    } catch (err) {
      console.error('Failed to fetch usage:', err);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchUsage();
  }, [fetchUsage]);

  const usedTokens = budget ? budget.totalTokens - budget.remainingTokens : 0;
  const percentage =
    budget && budget.totalTokens > 0
      ? Math.min(100, Math.round((usedTokens / budget.totalTokens) * 100))
      : 0;

  const barColor =
    percentage >= 90
      ? 'bg-red-500'
      : percentage >= 70
      ? 'bg-amber-500'
      : 'bg-emerald-500';

  const percentageTextColor =
    percentage >= 90
      ? 'text-red-500'
      : percentage >= 70
      ? 'text-amber-500'
      : 'text-emerald-600';

  if (loading) {
    return (
      <div className="flex items-center justify-center p-16">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="bg-zinc-50/50 dark:bg-zinc-900/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">{t('remainingTokens')}</CardTitle>
            <Coins className="h-4 w-4 text-zinc-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {budget ? formatNumber(budget.remainingTokens) : '—'}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {t('of')} {budget ? formatNumber(budget.totalTokens) : '—'} {t('total')}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-zinc-50/50 dark:bg-zinc-900/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">{t('usedTokens')}</CardTitle>
            <Zap className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(usedTokens)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {percentage}% of limit
            </p>
          </CardContent>
        </Card>

        <Card className="bg-zinc-50/50 dark:bg-zinc-900/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">{t('percentageUsed')}</CardTitle>
            <div
              className={`text-lg font-bold ${percentageTextColor}`}
            >
              {percentage}%
            </div>
          </CardHeader>
          <CardContent>
            <Progress value={percentage} className="h-2" />
            <p className="text-xs text-muted-foreground mt-2">
              {percentage >= 90
                ? t('critical')
                : percentage >= 70
                ? t('approachingLimit')
                : t('healthy')}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Progress bar card */}
      <Card>
        <CardHeader>
          <CardTitle>{t('budgetUsage')}</CardTitle>
          <CardDescription>
            {t('currentAiTokenConsumption')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {formatNumber(usedTokens)} / {budget ? formatNumber(budget.totalTokens) : '—'} {t('tokens')}
            </span>
            <span className={`font-semibold ${percentageTextColor}`}>
              {percentage}%
            </span>
          </div>
          <div className="w-full h-3 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${barColor}`}
              style={{ width: `${percentage}%` }}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            {t('limitsManagedByAdmins')}
          </p>
        </CardContent>
      </Card>

      {/* Consumption history */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-zinc-400" />
            {t('consumptionHistory')}
          </CardTitle>
          <CardDescription>{t('last50Operations')}</CardDescription>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8 italic">
              {t('noPurpose')}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('purpose')}</TableHead>
                  <TableHead>{t('model')}</TableHead>
                  <TableHead>{t('time')}</TableHead>
                  <TableHead className="text-right">{t('tokensUsedColumn')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="capitalize font-medium">
                      {log.purpose.replace(/_/g, ' ')}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {log.model || '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {formatDateTime(log.createdAt)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-semibold text-red-500">
                      -{formatNumber(log.tokensUsed)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const t = useTranslations('settings');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground mt-2">
          {t('subtitle')}
        </p>
      </div>

      <Tabs defaultValue="organization">
        <TabsList>
          <TabsTrigger value="organization">{t('organization')}</TabsTrigger>
          <TabsTrigger value="members">{t('members')}</TabsTrigger>
          <TabsTrigger value="token-usage">{t('tokenUsage')}</TabsTrigger>
        </TabsList>

        <TabsContent value="organization" className="mt-6">
          <OrganizationTab />
        </TabsContent>

        <TabsContent value="members" className="mt-6">
          <MembersTab />
        </TabsContent>

        <TabsContent value="token-usage" className="mt-6">
          <TokenUsageTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

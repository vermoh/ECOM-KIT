"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/context/AuthContext';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const PAGE_LIMIT = 50;

interface Organization {
  id: string;
  name: string;
}

interface AuditLogEntry {
  id: string;
  createdAt: string;
  orgName: string;
  action: string;
  actorEmail: string;
  resourceType: string;
  resourceId: string | null;
  ipAddress: string | null;
}

export default function AdminAuditLogPage() {
  const { accessToken } = useAuth();
  const t = useTranslations('admin.auditLog');
  const tc = useTranslations('common');

  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string>('all');
  const [actionFilter, setActionFilter] = useState('');
  const [page, setPage] = useState(1);

  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOrgs, setLoadingOrgs] = useState(true);
  const [loadingLogs, setLoadingLogs] = useState(false);

  useEffect(() => {
    if (!accessToken) return;
    fetch(`${API}/api/v1/organizations`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((r) => r.json())
      .then((data) => {
        const list: Organization[] = Array.isArray(data) ? data : (data.organizations ?? []);
        setOrgs(list);
      })
      .catch(console.error)
      .finally(() => setLoadingOrgs(false));
  }, [accessToken]);

  const fetchLogs = useCallback(async () => {
    if (!accessToken) return;
    setLoadingLogs(true);
    try {
      const params = new URLSearchParams();
      if (selectedOrgId && selectedOrgId !== 'all') params.set('orgId', selectedOrgId);
      if (actionFilter.trim()) params.set('action', actionFilter.trim());
      params.set('page', String(page));
      params.set('limit', String(PAGE_LIMIT));

      const res = await fetch(`${API}/api/v1/admin/audit-logs?${params.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        const entries: AuditLogEntry[] = Array.isArray(data)
          ? data
          : (data.logs ?? data.entries ?? []);
        setLogs(entries);
        // If we received a full page, assume there's more
        setHasMore(entries.length === PAGE_LIMIT);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingLogs(false);
    }
  }, [accessToken, selectedOrgId, actionFilter, page]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Reset to page 1 when filters change
  const handleOrgChange = (val: string | null) => {
    if (!val) return;
    setSelectedOrgId(val);
    setPage(1);
  };

  const handleActionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setActionFilter(e.target.value);
    setPage(1);
  };

  const formatDateTime = (val: string) =>
    new Date(val).toLocaleDateString() + ' ' + new Date(val).toLocaleTimeString();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground mt-2">
          {t('subtitle')}
        </p>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>{t('filters')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-1.5 min-w-56">
              <Label>{t('organization')}</Label>
              {loadingOrgs ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> {tc('loading')}
                </div>
              ) : (
                <Select value={selectedOrgId} onValueChange={handleOrgChange}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('allOrganizations')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('allOrganizations')}</SelectItem>
                    {orgs.map((org) => (
                      <SelectItem key={org.id} value={org.id}>
                        {org.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-1.5 min-w-64">
              <Label>{t('actionFilter')}</Label>
              <Input
                placeholder={t('actionFilterPlaceholder')}
                value={actionFilter}
                onChange={handleActionChange}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Log Table */}
      <Card>
        <CardHeader>
          <CardTitle>{t('auditEntries')}</CardTitle>
          <CardDescription>{t('immutableRecord')}</CardDescription>
        </CardHeader>
        <CardContent>
          {loadingLogs ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
            </div>
          ) : logs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10 italic">
              {t('noEntries')}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">{t('timestamp')}</TableHead>
                  <TableHead>{t('orgName')}</TableHead>
                  <TableHead>{t('action')}</TableHead>
                  <TableHead>{t('actor')}</TableHead>
                  <TableHead>{t('resourceType')}</TableHead>
                  <TableHead>{t('resourceId')}</TableHead>
                  <TableHead>{t('ipAddress')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
                      {formatDateTime(log.createdAt)}
                    </TableCell>
                    <TableCell className="text-sm font-medium">{log.orgName ?? '—'}</TableCell>
                    <TableCell className="font-mono text-sm">{log.action}</TableCell>
                    <TableCell className="text-sm">{log.actorEmail ?? '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {log.resourceType ?? '—'}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground max-w-32 truncate">
                      {log.resourceId ?? '—'}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {log.ipAddress ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {/* Pagination */}
          {!loadingLogs && (logs.length > 0 || page > 1) && (
            <div className="flex items-center justify-between pt-4 border-t mt-4">
              <p className="text-sm text-muted-foreground">
                {t('pageOf')} {page} &middot; {logs.length} {t('entries')}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="h-4 w-4 mr-1" /> {t('previous')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!hasMore}
                  onClick={() => setPage((p) => p + 1)}
                >
                  {t('next')} <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

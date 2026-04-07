"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/context/AuthContext';
import { Loader2, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface Organization {
  id: string;
  name: string;
  slug: string;
}

interface ProviderKey {
  id: string;
  provider: string;
  keyHint: string;
  rotatedAt: string | null;
  createdAt: string;
}

export default function ProviderKeysPage() {
  const { accessToken } = useAuth();
  const t = useTranslations('admin.providerKeys');
  const tc = useTranslations('common');

  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string>('');
  const [keys, setKeys] = useState<ProviderKey[]>([]);
  const [loadingOrgs, setLoadingOrgs] = useState(true);
  const [loadingKeys, setLoadingKeys] = useState(false);

  // Add Key dialog
  const [addOpen, setAddOpen] = useState(false);
  const [addProvider, setAddProvider] = useState('openrouter');
  const [addValue, setAddValue] = useState('');
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState('');

  // Rotate dialog
  const [rotateOpen, setRotateOpen] = useState(false);
  const [rotateTarget, setRotateTarget] = useState<ProviderKey | null>(null);
  const [rotateValue, setRotateValue] = useState('');
  const [rotateLoading, setRotateLoading] = useState(false);
  const [rotateError, setRotateError] = useState('');

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<ProviderKey | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  useEffect(() => {
    if (!accessToken) return;
    fetch(`${API}/api/v1/organizations`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((r) => r.json())
      .then((data) => {
        const list: Organization[] = Array.isArray(data) ? data : (data.organizations ?? []);
        setOrgs(list);
        if (list.length > 0) setSelectedOrgId(list[0].id);
      })
      .catch(console.error)
      .finally(() => setLoadingOrgs(false));
  }, [accessToken]);

  const fetchKeys = useCallback(async () => {
    if (!accessToken || !selectedOrgId) return;
    setLoadingKeys(true);
    try {
      const res = await fetch(`${API}/api/v1/providers?orgId=${selectedOrgId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setKeys(Array.isArray(data) ? data : (data.providers ?? []));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingKeys(false);
    }
  }, [accessToken, selectedOrgId]);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const handleAddKey = async () => {
    if (!addValue.trim()) { setAddError('Key value is required.'); return; }
    setAddError('');
    setAddLoading(true);
    try {
      const res = await fetch(`${API}/api/v1/providers?orgId=${selectedOrgId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ provider: addProvider, value: addValue }),
      });
      if (res.ok) {
        setAddOpen(false);
        setAddValue('');
        setAddProvider('openrouter');
        await fetchKeys();
      } else {
        const err = await res.json().catch(() => ({}));
        setAddError(err.error ?? `Error ${res.status}`);
      }
    } catch {
      setAddError('Network error');
    } finally {
      setAddLoading(false);
    }
  };

  const handleRotate = async () => {
    if (!rotateTarget || !rotateValue.trim()) { setRotateError('New key value is required.'); return; }
    setRotateError('');
    setRotateLoading(true);
    try {
      const res = await fetch(`${API}/api/v1/providers/rotate/${rotateTarget.id}?orgId=${selectedOrgId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ value: rotateValue }),
      });
      if (res.ok) {
        setRotateOpen(false);
        setRotateValue('');
        setRotateTarget(null);
        await fetchKeys();
      } else {
        const err = await res.json().catch(() => ({}));
        setRotateError(err.error ?? `Error ${res.status}`);
      }
    } catch {
      setRotateError('Network error');
    } finally {
      setRotateLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await fetch(`${API}/api/v1/providers/${deleteTarget.id}?orgId=${selectedOrgId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      setDeleteOpen(false);
      setDeleteTarget(null);
      await fetchKeys();
    } catch (err) {
      console.error(err);
    } finally {
      setDeleteLoading(false);
    }
  };

  const formatDate = (val: string | null) =>
    val ? new Date(val).toLocaleDateString() + ' ' + new Date(val).toLocaleTimeString() : '—';

  const providerLabel: Record<string, string> = {
    openrouter: t('openrouter'),
    openai: t('openai'),
    anthropic: t('anthropic'),
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground mt-2">
          {t('subtitle')}
        </p>
      </div>

      {/* Org Selector */}
      <Card>
        <CardHeader>
          <CardTitle>{t('selectOrganization')}</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingOrgs ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> {t('loadingOrganizations')}
            </div>
          ) : (
            <Select value={selectedOrgId} onValueChange={(v) => v && setSelectedOrgId(v)}>
              <SelectTrigger className="w-72">
                <SelectValue placeholder="Select an organization" />
              </SelectTrigger>
              <SelectContent>
                {orgs.map((org) => (
                  <SelectItem key={org.id} value={org.id}>
                    {org.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </CardContent>
      </Card>

      {/* Keys Table */}
      {selectedOrgId && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>{t('apiKeys')}</CardTitle>
              <CardDescription>{t('encryptedAtRest')}</CardDescription>
            </div>
            <Button onClick={() => { setAddOpen(true); setAddError(''); }}>
              <Plus className="mr-2 h-4 w-4" /> {t('addKey')}
            </Button>
          </CardHeader>
          <CardContent>
            {loadingKeys ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
              </div>
            ) : keys.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-10 italic">
                {t('noKeys')}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('provider')}</TableHead>
                    <TableHead>{t('keyHint')}</TableHead>
                    <TableHead>{t('lastRotated')}</TableHead>
                    <TableHead className="text-right">{t('actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {keys.map((key) => (
                    <TableRow key={key.id}>
                      <TableCell>
                        <Badge variant="outline">{providerLabel[key.provider] ?? key.provider}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-sm">***{key.keyHint}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(key.rotatedAt ?? key.createdAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setRotateTarget(key);
                              setRotateValue('');
                              setRotateError('');
                              setRotateOpen(true);
                            }}
                          >
                            <RotateCcw className="mr-1 h-3 w-3" /> {t('rotate')}
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => {
                              setDeleteTarget(key);
                              setDeleteOpen(true);
                            }}
                          >
                            <Trash2 className="mr-1 h-3 w-3" /> {t('delete')}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Add Key Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('addKeyDialog')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>{t('provider')}</Label>
              <Select value={addProvider} onValueChange={(v) => v && setAddProvider(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openrouter">{t('openrouter')}</SelectItem>
                  <SelectItem value="openai">{t('openai')}</SelectItem>
                  <SelectItem value="anthropic">{t('anthropic')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t('apiKeyLabel')}</Label>
              <Input
                type="password"
                placeholder={t('apiKeyPlaceholder')}
                value={addValue}
                onChange={(e) => setAddValue(e.target.value)}
                disabled={addLoading}
              />
            </div>
            {addError && <p className="text-sm text-red-500">{addError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={addLoading}>
              {tc('cancel')}
            </Button>
            <Button onClick={handleAddKey} disabled={addLoading || !addValue.trim()}>
              {addLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('saveKey')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rotate Dialog */}
      <Dialog open={rotateOpen} onOpenChange={setRotateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t('rotateDialog')} {rotateTarget ? (providerLabel[rotateTarget.provider] ?? rotateTarget.provider) : ''}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              {t('gracePeriod')}
            </p>
            <div className="space-y-2">
              <Label>{t('newApiKey')}</Label>
              <Input
                type="password"
                placeholder={t('apiKeyPlaceholder')}
                value={rotateValue}
                onChange={(e) => setRotateValue(e.target.value)}
                disabled={rotateLoading}
              />
            </div>
            {rotateError && <p className="text-sm text-red-500">{rotateError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRotateOpen(false)} disabled={rotateLoading}>
              {tc('cancel')}
            </Button>
            <Button onClick={handleRotate} disabled={rotateLoading || !rotateValue.trim()}>
              {rotateLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('rotateKey')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('deleteConfirmDialog')}</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <p className="text-sm text-muted-foreground">
              {t('deleteConfirm')}{' '}
              <span className="font-semibold">
                {deleteTarget ? (providerLabel[deleteTarget.provider] ?? deleteTarget.provider) : ''}
              </span>{' '}
              {t('deleteConfirmImmediate')}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleteLoading}>
              {tc('cancel')}
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteLoading}>
              {deleteLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {tc('delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

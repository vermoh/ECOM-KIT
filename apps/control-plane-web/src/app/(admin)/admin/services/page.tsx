"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAuth } from '@/context/AuthContext';
import { useTranslations } from 'next-intl';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface Service {
  id: string;
  name: string;
  slug: string;
  baseUrl: string;
  version: string;
  status: string;
}

function statusVariantForService(status: string): string {
  if (status === 'active') return 'bg-green-500 hover:bg-green-500 text-white';
  if (status === 'inactive' || status === 'disabled') return 'bg-red-500 hover:bg-red-500 text-white';
  return 'bg-amber-500 hover:bg-amber-500 text-white';
}

const emptyForm = { name: '', slug: '', baseUrl: '', version: '1.0.0' };

export default function AdminServicesPage() {
  const { accessToken } = useAuth();
  const t = useTranslations('admin.services');
  const tc = useTranslations('common');

  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const fetchServices = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/v1/services`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error(`Failed to fetch services (${res.status})`);
      const json = await res.json();
      // Handle both array responses and wrapped { data: [] } responses
      setServices(Array.isArray(json) ? json : json.data ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchServices();
  }, [fetchServices]);

  const openDialog = () => {
    setForm(emptyForm);
    setFormError(null);
    setDialogOpen(true);
  };

  const handleFormChange = (field: keyof typeof emptyForm, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleRegister = async () => {
    if (!accessToken) return;
    if (!form.name.trim() || !form.slug.trim() || !form.baseUrl.trim()) {
      setFormError('Name, slug, and base URL are required.');
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await fetch(`${API}/api/v1/services`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: form.name.trim(),
          slug: form.slug.trim(),
          baseUrl: form.baseUrl.trim(),
          version: form.version.trim() || '1.0.0',
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? `Failed to register service (${res.status})`);
      }
      setDialogOpen(false);
      await fetchServices();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to register service');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <Button onClick={openDialog}>{t('registerService')}</Button>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('registeredServices')}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-12 text-center text-muted-foreground text-sm">{tc('loading')}</div>
          ) : services.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">{t('noServices')}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('name')}</TableHead>
                  <TableHead>{t('slug')}</TableHead>
                  <TableHead>{t('baseUrl')}</TableHead>
                  <TableHead>{t('version')}</TableHead>
                  <TableHead>{t('status')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {services.map((svc) => (
                  <TableRow key={svc.id}>
                    <TableCell className="font-medium">{svc.name}</TableCell>
                    <TableCell>
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
                        {svc.slug}
                      </code>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                      {svc.baseUrl}
                    </TableCell>
                    <TableCell className="text-sm">{svc.version}</TableCell>
                    <TableCell>
                      <Badge className={`capitalize ${statusVariantForService(svc.status)}`}>
                        {svc.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Register Service Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('registerDialog')}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {formError && (
              <div className="rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 text-sm text-destructive">
                {formError}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="svc-name">{t('serviceName')}</Label>
              <Input
                id="svc-name"
                placeholder={t('serviceNameExample')}
                value={form.name}
                onChange={(e) => handleFormChange('name', e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="svc-slug">{t('serviceSlug')}</Label>
              <Input
                id="svc-slug"
                placeholder={t('serviceSlugExample')}
                value={form.slug}
                onChange={(e) => handleFormChange('slug', e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="svc-base-url">{t('baseUrlLabel')}</Label>
              <Input
                id="svc-base-url"
                placeholder={t('baseUrlExample')}
                value={form.baseUrl}
                onChange={(e) => handleFormChange('baseUrl', e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="svc-version">{t('versionLabel')}</Label>
              <Input
                id="svc-version"
                placeholder={t('versionDefault')}
                value={form.version}
                onChange={(e) => handleFormChange('version', e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>
              {tc('cancel')}
            </Button>
            <Button onClick={handleRegister} disabled={submitting}>
              {submitting ? t('registering') : t('register')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

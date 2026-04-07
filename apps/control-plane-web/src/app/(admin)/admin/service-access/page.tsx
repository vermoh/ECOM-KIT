"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
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
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/context/AuthContext';
import { useTranslations } from 'next-intl';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface Organization {
  id: string;
  name: string;
  plan?: string;
  status?: string;
}

interface Service {
  id: string;
  name: string;
  slug: string;
}

export default function AdminServiceAccessPage() {
  const { accessToken } = useAuth();
  const t = useTranslations('admin.serviceAccess');
  const tc = useTranslations('common');

  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [orgsLoading, setOrgsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!accessToken) return;
    setOrgsLoading(true);
    setLoadError(null);
    try {
      const [orgsRes, servicesRes] = await Promise.all([
        fetch(`${API}/api/v1/organizations`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
        fetch(`${API}/api/v1/services`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
      ]);

      if (!orgsRes.ok) throw new Error(`Failed to fetch organizations (${orgsRes.status})`);
      if (!servicesRes.ok) throw new Error(`Failed to fetch services (${servicesRes.status})`);

      const orgsJson = await orgsRes.json();
      const servicesJson = await servicesRes.json();

      setOrgs(Array.isArray(orgsJson) ? orgsJson : orgsJson.data ?? []);
      setServices(Array.isArray(servicesJson) ? servicesJson : servicesJson.data ?? []);
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setOrgsLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const openDialog = () => {
    setSelectedOrgId('');
    setSelectedServiceId('');
    setFormError(null);
    setDialogOpen(true);
  };

  const handleGrant = async () => {
    if (!accessToken) return;
    if (!selectedOrgId || !selectedServiceId) {
      setFormError(t('pleaseSelectBoth'));
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await fetch(`${API}/api/v1/services/grant`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ orgId: selectedOrgId, serviceId: selectedServiceId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? `Failed to grant access (${res.status})`);
      }

      const orgName = orgs.find((o) => o.id === selectedOrgId)?.name ?? selectedOrgId;
      const svcName = services.find((s) => s.id === selectedServiceId)?.name ?? selectedServiceId;
      setSuccessMessage(`${t('accessGrantedSuccess')} "${svcName}" granted to "${orgName}" successfully.`);
      setDialogOpen(false);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to grant access');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {t('subtitle')}
          </p>
        </div>
        <Button onClick={openDialog}>{t('grantAccess')}</Button>
      </div>

      {loadError && (
        <div className="rounded-md bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive">
          {loadError}
        </div>
      )}

      {successMessage && (
        <div className="rounded-md bg-green-500/10 border border-green-500/30 px-4 py-3 text-sm text-green-700 dark:text-green-400">
          {successMessage}
        </div>
      )}

      {/* Organizations overview */}
      <Card>
        <CardHeader>
          <CardTitle>{t('organizationsOverview')}</CardTitle>
          <CardDescription>
            {t('viewServiceAccess')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {orgsLoading ? (
            <div className="py-12 text-center text-muted-foreground text-sm">{tc('loading')}</div>
          ) : orgs.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">{t('noOrganizations')}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('organization')}</TableHead>
                  <TableHead>{t('plan')}</TableHead>
                  <TableHead>{t('status')}</TableHead>
                  <TableHead className="text-right">{t('actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orgs.map((org) => (
                  <TableRow key={org.id}>
                    <TableCell className="font-medium">{org.name}</TableCell>
                    <TableCell>
                      {org.plan ? (
                        <Badge variant="secondary" className="capitalize">
                          {org.plan}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {org.status ? (
                        <Badge
                          className={
                            org.status === 'active'
                              ? 'bg-green-500 hover:bg-green-500 text-white'
                              : 'bg-amber-500 hover:bg-amber-500 text-white'
                          }
                        >
                          {org.status}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedOrgId(org.id);
                          setSelectedServiceId('');
                          setFormError(null);
                          setDialogOpen(true);
                        }}
                      >
                        {t('grantService')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Grant Access Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('grantAccessDialog')}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {formError && (
              <div className="rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 text-sm text-destructive">
                {formError}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="grant-org">{t('organization')}</Label>
              <Select value={selectedOrgId} onValueChange={(v) => v && setSelectedOrgId(v)}>
                <SelectTrigger id="grant-org">
                  <SelectValue placeholder={t('selectOrganization')} />
                </SelectTrigger>
                <SelectContent>
                  {orgs.map((org) => (
                    <SelectItem key={org.id} value={org.id}>
                      {org.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="grant-service">Service</Label>
              <Select value={selectedServiceId} onValueChange={(v) => v && setSelectedServiceId(v)}>
                <SelectTrigger id="grant-service">
                  <SelectValue placeholder={t('selectService')} />
                </SelectTrigger>
                <SelectContent>
                  {services.map((svc) => (
                    <SelectItem key={svc.id} value={svc.id}>
                      {svc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>
              {tc('cancel')}
            </Button>
            <Button onClick={handleGrant} disabled={submitting}>
              {submitting ? t('granting') : t('grantAccessButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

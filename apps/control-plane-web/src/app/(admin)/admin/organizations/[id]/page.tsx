"use client";

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/context/AuthContext';
import { ArrowLeft, Loader2 } from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

type OrgStatus = 'active' | 'suspended' | 'deleted';

interface ServiceAccess {
  serviceId: string;
  serviceName?: string;
  enabled: boolean;
}

interface TokenBudget {
  total: number;
  remaining: number;
  used: number;
}

interface OrganizationDetail {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: OrgStatus;
  maxUsers?: number;
  maxProjects?: number;
  createdAt?: string;
  memberCount?: number;
  serviceAccess?: ServiceAccess[];
  tokenBudget?: TokenBudget;
}

function statusColor(status: OrgStatus): string {
  if (status === 'active') return 'bg-emerald-100 text-emerald-700 border-emerald-200';
  if (status === 'suspended') return 'bg-amber-100 text-amber-700 border-amber-200';
  return 'bg-red-100 text-red-700 border-red-200';
}

function formatDate(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export default function AdminOrganizationDetailPage() {
  const { accessToken } = useAuth();
  const params = useParams();
  const id = params?.id as string;

  const [org, setOrg] = useState<OrganizationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchOrg = useCallback(async () => {
    if (!accessToken || !id) return;
    try {
      const res = await fetch(`${API}/api/v1/organizations/${id}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setOrg(data);
      } else {
        setError(`Failed to load organization (${res.status})`);
      }
    } catch (err) {
      console.error('Failed to fetch organization:', err);
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [accessToken, id]);

  useEffect(() => { fetchOrg(); }, [fetchOrg]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-16">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (error || !org) {
    return (
      <div className="space-y-4">
        <Link href="/admin/organizations" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Organizations
        </Link>
        <p className="text-sm text-red-500">{error || 'Organization not found.'}</p>
      </div>
    );
  }

  const tokenBudget = org.tokenBudget;
  const tokenPercentage =
    tokenBudget && tokenBudget.total > 0
      ? Math.min(100, Math.round((tokenBudget.used / tokenBudget.total) * 100))
      : 0;

  const barColor =
    tokenPercentage >= 90 ? 'bg-red-500' :
    tokenPercentage >= 70 ? 'bg-amber-500' :
    'bg-emerald-500';

  const overviewFields: Array<{ label: string; value: string | React.ReactNode }> = [
    { label: 'Name', value: org.name },
    { label: 'Slug', value: <span className="font-mono text-sm">{org.slug}</span> },
    {
      label: 'Plan',
      value: <span className="capitalize">{org.plan}</span>,
    },
    {
      label: 'Status',
      value: (
        <Badge
          className={`capitalize border ${statusColor(org.status)}`}
          variant="outline"
        >
          {org.status}
        </Badge>
      ),
    },
    { label: 'Max Users', value: org.maxUsers != null ? String(org.maxUsers) : '—' },
    { label: 'Max Projects', value: org.maxProjects != null ? String(org.maxProjects) : '—' },
    { label: 'Created At', value: formatDate(org.createdAt) },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/admin/organizations" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">{org.name}</h1>
        <Badge
          className={`capitalize border ${statusColor(org.status)}`}
          variant="outline"
        >
          {org.status}
        </Badge>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="services">Services &amp; Budget</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Organization Info</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
                {overviewFields.map((field) => (
                  <div key={field.label} className="space-y-1">
                    <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      {field.label}
                    </dt>
                    <dd className="text-sm font-medium">{field.value}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Members Tab */}
        <TabsContent value="members" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Members</CardTitle>
            </CardHeader>
            <CardContent>
              {org.memberCount != null ? (
                <div className="flex items-center gap-2">
                  <span className="text-3xl font-bold">{org.memberCount}</span>
                  <span className="text-muted-foreground text-sm">active members</span>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Member data unavailable.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Services & Budget Tab */}
        <TabsContent value="services" className="mt-4 space-y-4">
          {/* Service Access */}
          <Card>
            <CardHeader>
              <CardTitle>Service Access</CardTitle>
            </CardHeader>
            <CardContent>
              {org.serviceAccess && org.serviceAccess.length > 0 ? (
                <ul className="space-y-2">
                  {org.serviceAccess.map((svc) => (
                    <li
                      key={svc.serviceId}
                      className="flex items-center justify-between py-2 border-b last:border-0"
                    >
                      <span className="text-sm font-medium">
                        {svc.serviceName ?? svc.serviceId}
                      </span>
                      <Badge
                        className={
                          svc.enabled
                            ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                            : 'bg-zinc-100 text-zinc-500 border-zinc-200'
                        }
                        variant="outline"
                      >
                        {svc.enabled ? 'Enabled' : 'Disabled'}
                      </Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No service access configured.</p>
              )}
            </CardContent>
          </Card>

          {/* Token Budget */}
          <Card>
            <CardHeader>
              <CardTitle>Token Budget</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {tokenBudget ? (
                <>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Total
                      </p>
                      <p className="text-2xl font-bold">{tokenBudget.total.toLocaleString()}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Remaining
                      </p>
                      <p className="text-2xl font-bold text-emerald-600">
                        {tokenBudget.remaining.toLocaleString()}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Used
                      </p>
                      <p className="text-2xl font-bold text-amber-600">
                        {tokenBudget.used.toLocaleString()}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">
                        {tokenBudget.used.toLocaleString()} / {tokenBudget.total.toLocaleString()} tokens used
                      </span>
                      <span
                        className={`font-semibold ${
                          tokenPercentage >= 90
                            ? 'text-red-500'
                            : tokenPercentage >= 70
                            ? 'text-amber-500'
                            : 'text-emerald-600'
                        }`}
                      >
                        {tokenPercentage}%
                      </span>
                    </div>
                    <div className="w-full h-3 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                        style={{ width: `${tokenPercentage}%` }}
                      />
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No token budget configured.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

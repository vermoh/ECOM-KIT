"use client";

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Loader2,
  Users,
  FileSpreadsheet,
  Coins,
  Zap,
  ArrowRight,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { formatNumber } from '@/lib/utils';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const CSV_API = process.env.NEXT_PUBLIC_CSV_API_URL || 'http://localhost:4001';

interface DashboardStats {
  memberCount: number | null;
  projectCount: number | null;
  totalTokens: number | null;
  remainingTokens: number | null;
}

interface ServiceAccess {
  serviceId: string;
  serviceSlug: string;
  serviceName: string;
  enabled: boolean;
  validUntil: string | null;
}

function serviceDescription(slug: string): string {
  if (slug === 'csv-enrichment') return 'AI-powered CSV catalog enrichment pipeline';
  return 'Service module';
}

export default function DashboardPage() {
  const { accessToken } = useAuth();

  const [stats, setStats] = useState<DashboardStats>({
    memberCount: null,
    projectCount: null,
    totalTokens: null,
    remainingTokens: null,
  });
  const [statsLoading, setStatsLoading] = useState(true);

  const [services, setServices] = useState<ServiceAccess[]>([]);
  const [servicesLoading, setServicesLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    if (!accessToken) return;

    setStatsLoading(true);
    try {
      const [membershipsRes, billingRes, projectsRes] = await Promise.allSettled([
        fetch(`${API}/api/v1/memberships`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
        fetch(`${API}/api/v1/billing/usage`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
        fetch(`${CSV_API}/projects`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
      ]);

      let memberCount: number | null = null;
      if (membershipsRes.status === 'fulfilled' && membershipsRes.value.ok) {
        const data = await membershipsRes.value.json();
        memberCount = Array.isArray(data) ? data.length : (data.total ?? data.count ?? null);
      }

      let totalTokens: number | null = null;
      let remainingTokens: number | null = null;
      if (billingRes.status === 'fulfilled' && billingRes.value.ok) {
        const data = await billingRes.value.json();
        if (data.budget) {
          totalTokens = data.budget.totalTokens ?? null;
          remainingTokens = data.budget.remainingTokens ?? null;
        }
      }

      let projectCount: number | null = null;
      if (projectsRes.status === 'fulfilled' && projectsRes.value.ok) {
        const data = await projectsRes.value.json();
        projectCount = Array.isArray(data) ? data.length : (data.total ?? data.count ?? null);
      }

      setStats({ memberCount, projectCount, totalTokens, remainingTokens });
    } catch (err) {
      console.error('Failed to fetch dashboard stats:', err);
    } finally {
      setStatsLoading(false);
    }
  }, [accessToken]);

  const fetchServices = useCallback(async () => {
    if (!accessToken) return;

    setServicesLoading(true);
    try {
      const res = await fetch(`${API}/api/v1/services/my-access`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setServices(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('Failed to fetch service access:', err);
    } finally {
      setServicesLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchStats();
    fetchServices();
  }, [fetchStats, fetchServices]);

  const usedTokens =
    stats.totalTokens !== null && stats.remainingTokens !== null
      ? stats.totalTokens - stats.remainingTokens
      : null;

  const statCards = [
    {
      title: 'Members',
      value: stats.memberCount !== null ? formatNumber(stats.memberCount) : '—',
      icon: Users,
      sub: 'Active org members',
    },
    {
      title: 'Projects',
      value: stats.projectCount !== null ? formatNumber(stats.projectCount) : '—',
      icon: FileSpreadsheet,
      sub: 'CSV projects in org',
    },
    {
      title: 'Token Budget',
      value:
        stats.remainingTokens !== null && stats.totalTokens !== null
          ? `${formatNumber(stats.remainingTokens)} / ${formatNumber(stats.totalTokens)}`
          : '—',
      icon: Coins,
      sub: 'Remaining / total tokens',
    },
    {
      title: 'Tokens Used',
      value: usedTokens !== null ? formatNumber(usedTokens) : '—',
      icon: Zap,
      sub: 'Consumed this period',
    },
  ];

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold tracking-tight">Dashboard Overview</h1>

      {/* Stats cards */}
      {statsLoading ? (
        <div className="flex items-center justify-center p-10">
          <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {statCards.map((card, i) => {
            const Icon = card.icon;
            return (
              <Card key={i}>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {card.title}
                  </CardTitle>
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{card.value}</div>
                  <p className="text-xs text-muted-foreground mt-1">{card.sub}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Services section */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">Your Services</h2>

        {servicesLoading ? (
          <div className="flex items-center justify-center p-10">
            <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {/* Always show CSV Enrichment card */}
            <Link href="/csv-projects" className="block">
              <Card className="transition-shadow hover:shadow-md cursor-pointer border-primary/20 h-full">
                <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
                  <div className="space-y-1">
                    <CardTitle className="text-base">CSV Enrichment</CardTitle>
                    <CardDescription>AI-powered CSV catalog enrichment pipeline</CardDescription>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge className="bg-green-100 text-green-800 hover:bg-green-100 border-green-200">
                      Active
                    </Badge>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </CardHeader>
              </Card>
            </Link>

            {/* Additional services from API */}
            {services.filter(s => s.serviceSlug !== 'csv-enrichment').map((svc) => (
              <div key={svc.serviceId}>
                <Card className={svc.enabled ? '' : 'opacity-50'}>
                  <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
                    <div className="space-y-1">
                      <CardTitle className="text-base">{svc.serviceName}</CardTitle>
                      <CardDescription>{serviceDescription(svc.serviceSlug)}</CardDescription>
                    </div>
                    <Badge variant="secondary">Coming soon</Badge>
                  </CardHeader>
                </Card>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

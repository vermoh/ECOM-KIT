"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/context/AuthContext';
import { Building2, Users, Coins, FileSpreadsheet, Loader2 } from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface Organization {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  tokensUsed?: number;
  projectCount?: number;
}

interface UsageData {
  totalUsers?: number;
  totalTokensConsumed?: number;
  totalActiveProjects?: number;
  orgs?: Array<{ tokensUsed?: number; projectCount?: number }>;
}

export default function AdminDashboardPage() {
  const { accessToken } = useAuth();

  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!accessToken) return;
    try {
      const [orgsRes, usageRes] = await Promise.allSettled([
        fetch(`${API}/api/v1/organizations`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
        fetch(`${API}/api/v1/admin/usage`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
      ]);

      if (orgsRes.status === 'fulfilled' && orgsRes.value.ok) {
        const data = await orgsRes.value.json();
        setOrgs(Array.isArray(data) ? data : data.organizations ?? []);
      }

      if (usageRes.status === 'fulfilled' && usageRes.value.ok) {
        const data = await usageRes.value.json();
        setUsage(data);
      }
    } catch (err) {
      console.error('Failed to fetch admin dashboard data:', err);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-16">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  const totalOrganizations = orgs.length;

  const totalUsers =
    usage?.totalUsers ??
    (usage?.orgs ?? []).reduce((sum, o) => sum + 0, 0);

  const totalTokensConsumed =
    usage?.totalTokensConsumed ??
    orgs.reduce((sum, o) => sum + (o.tokensUsed ?? 0), 0);

  const activeProjects =
    usage?.totalActiveProjects ??
    orgs.reduce((sum, o) => sum + (o.projectCount ?? 0), 0);

  const stats = [
    {
      title: 'Total Organizations',
      value: totalOrganizations.toLocaleString(),
      icon: Building2,
    },
    {
      title: 'Total Users',
      value: totalUsers.toLocaleString(),
      icon: Users,
    },
    {
      title: 'Total Tokens Consumed',
      value: totalTokensConsumed.toLocaleString(),
      icon: Coins,
    },
    {
      title: 'Active Projects',
      value: activeProjects.toLocaleString(),
      icon: FileSpreadsheet,
    },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Admin Dashboard</h1>

      <div className="grid gap-4 md:grid-cols-2">
        {stats.map((stat, i) => {
          const Icon = stat.icon;
          return (
            <Card key={i}>
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {stat.title}
                </CardTitle>
                <Icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stat.value}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

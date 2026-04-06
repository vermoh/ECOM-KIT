"use client";

import React, { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useAuth } from '@/context/AuthContext';
import { Coins, CreditCard, History, Zap, Loader2 } from 'lucide-react';
import { formatNumber, formatDate, formatDateTime } from '@/lib/utils';

export function BillingDashboard() {
  const { accessToken } = useAuth();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchUsage = async () => {
    try {
      // Note: In real setup, CP_API_URL would come from env
      const res = await fetch('http://localhost:8080/api/v1/billing/usage', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const usageData = await res.json();
      setData(usageData);
    } catch (err) {
      console.error('Failed to fetch usage', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (accessToken) fetchUsage();
  }, [accessToken]);

  if (loading) return (
    <div className="flex items-center justify-center p-12">
      <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
    </div>
  );

  const budget = data?.budget;
  const percentage = budget ? Math.min(100, Math.round(((budget.totalTokens - budget.remainingTokens) / budget.totalTokens) * 100)) : 0;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="bg-zinc-50/50 dark:bg-zinc-900/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">Remaining Tokens</CardTitle>
            <Coins className="h-4 w-4 text-zinc-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{budget?.remainingTokens ? formatNumber(budget.remainingTokens) : 0}</div>
            <p className="text-xs text-zinc-500">out of {budget?.totalTokens ? formatNumber(budget.totalTokens) : 0} monthly quota</p>
          </CardContent>
        </Card>

        <Card className="bg-zinc-50/50 dark:bg-zinc-900/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">Current Plan</CardTitle>
            <Zap className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold uppercase">Free Tier</div>
            <p className="text-xs text-zinc-500">Resetting on {budget?.resetAt ? formatDate(budget.resetAt) : 'N/A'}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-zinc-200 dark:border-zinc-800">
        <CardHeader>
          <CardTitle>Budget Usage</CardTitle>
          <CardDescription>Your organization's AI token consumption for the current billing cycle.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
               <span className="font-medium">{formatNumber(budget?.totalTokens - budget?.remainingTokens || 0)} tokens used</span>
               <span className="text-zinc-500">{percentage}%</span>
            </div>
            <Progress value={percentage} className="h-3" />
          </div>
          <div className="flex justify-end pt-4">
            <Button className="gap-2 bg-zinc-900 dark:bg-zinc-100 text-zinc-100 dark:text-zinc-900 hover:opacity-90">
                <CreditCard className="h-4 w-4" />
                Upgrade Plan
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-zinc-200 dark:border-zinc-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-zinc-400" />
            Consumption History
          </CardTitle>
          <CardDescription>Detailed log of AI tasks and token usage.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {data?.recentLogs.length > 0 ? (
              data.recentLogs.map((log: any) => (
                <div key={log.id} className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-3 last:border-0">
                  <div className="space-y-0.5">
                    <p className="text-sm font-semibold capitalize">{log.purpose.replace(/_/g, ' ')}</p>
                    <p className="text-[10px] text-zinc-500 flex items-center gap-1">
                      {formatDateTime(log.createdAt)} • <span className="text-zinc-400">{log.model || 'GPT-3.5'}</span>
                    </p>
                  </div>
                  <div className="text-sm font-mono font-bold text-red-500 bg-red-50 dark:bg-red-900/20 px-2 py-0.5 rounded">
                    -{log.tokensUsed}
                  </div>
                </div>
              ))
            ) : (
                <div className="text-center py-6">
                    <p className="text-sm text-zinc-500 italic">No consumption records found.</p>
                </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

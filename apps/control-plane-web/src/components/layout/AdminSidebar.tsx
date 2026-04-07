"use client";

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Building2, Users, Server, Shield, Key, Coins, BarChart3, ScrollText, ArrowLeft, DollarSign, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslations } from 'next-intl';

export function AdminSidebar() {
  const pathname = usePathname();
  const t = useTranslations('nav');

  const adminNavItems = [
    { href: '/admin/dashboard', label: t('platformOverview'), icon: LayoutDashboard },
    { href: '/admin/organizations', label: t('organizations'), icon: Building2 },
    { href: '/admin/users', label: t('allUsers'), icon: Users },
    { href: '/admin/services', label: t('serviceRegistry'), icon: Server },
    { href: '/admin/service-access', label: t('serviceAccess'), icon: Shield },
    { href: '/admin/provider-keys', label: t('providerKeys'), icon: Key },
    { href: '/admin/token-limits', label: t('tokenLimits'), icon: Coins },
    { href: '/admin/usage', label: t('usageStats'), icon: BarChart3 },
    { href: '/admin/model-pricing', label: t('modelPricing'), icon: DollarSign },
    { href: '/admin/audit-log', label: t('auditLog'), icon: ScrollText },
    { href: '/admin/languages', label: t('languages'), icon: Globe },
  ];

  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-64 border-r bg-background pt-16">
      <div className="h-full overflow-y-auto px-3 py-4 flex flex-col">
        <ul className="space-y-2 font-medium flex-1">
          {adminNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center rounded-lg p-2 text-foreground hover:bg-muted",
                    pathname.startsWith(item.href) && "bg-muted"
                  )}
                >
                  <Icon className="h-5 w-5 text-muted-foreground" />
                  <span className="ml-3">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="border-t pt-4">
          <Link
            href="/dashboard"
            className="flex items-center rounded-lg p-2 text-foreground hover:bg-muted"
          >
            <ArrowLeft className="h-5 w-5 text-muted-foreground" />
            <span className="ml-3">{t('backToOrgPanel')}</span>
          </Link>
        </div>
      </div>
    </aside>
  );
}

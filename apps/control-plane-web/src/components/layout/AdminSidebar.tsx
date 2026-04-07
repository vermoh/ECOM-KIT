"use client";

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Building2, Users, Server, Shield, Key, Coins, BarChart3, ScrollText, ArrowLeft, DollarSign, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';

const adminNavItems = [
  { href: '/admin/dashboard', label: 'Platform Overview', icon: LayoutDashboard },
  { href: '/admin/organizations', label: 'Organizations', icon: Building2 },
  { href: '/admin/users', label: 'All Users', icon: Users },
  { href: '/admin/services', label: 'Service Registry', icon: Server },
  { href: '/admin/service-access', label: 'Service Access', icon: Shield },
  { href: '/admin/provider-keys', label: 'Provider Keys', icon: Key },
  { href: '/admin/token-limits', label: 'Token Limits', icon: Coins },
  { href: '/admin/usage', label: 'Usage Stats', icon: BarChart3 },
  { href: '/admin/model-pricing', label: 'Model Pricing', icon: DollarSign },
  { href: '/admin/audit-log', label: 'Audit Log', icon: ScrollText },
  { href: '/admin/languages', label: 'Languages', icon: Globe },
];

export function AdminSidebar() {
  const pathname = usePathname();

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
            <span className="ml-3">Back to Org Panel</span>
          </Link>
        </div>
      </div>
    </aside>
  );
}

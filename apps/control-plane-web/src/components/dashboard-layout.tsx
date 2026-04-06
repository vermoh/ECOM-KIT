'use client';

import React from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { usePathname } from 'next/navigation';
import {
  Shield,
  Settings,
  Users,
  LogOut,
  Building,
  Bell,
  Search,
  Menu,
  Folder,
  LayoutDashboard,
  Key,
  Server,
  ShieldCheck,
  Building2,
  CreditCard
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { claims: user, logout } = useAuth();
  const pathname = usePathname();

  const menuItems = [
    { name: 'Overview', href: '/dashboard', icon: LayoutDashboard },
    { name: 'Projects', href: '/dashboard/projects', icon: Folder },
    { name: 'AI Providers', href: '/dashboard/providers', icon: Key },
    { name: 'Organizations', href: '/dashboard/organizations', icon: Building2 },
    { name: 'Billing', href: '/dashboard/billing', icon: CreditCard },
  ];

  if (user?.roles?.includes('super_admin')) {
    menuItems.push({ name: 'Service Registry', href: '/dashboard/services', icon: Server });
  }

  return (
    <div className="flex min-h-screen bg-zinc-50 dark:bg-zinc-950">
      {/* Sidebar */}
      <aside className="w-64 border-r border-zinc-200 bg-white flex flex-col p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-8 flex items-center gap-2 px-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-white">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <span className="text-xl font-bold tracking-tight">ECOM KIT</span>
        </div>

        <nav className="space-y-1 flex-1">
          {menuItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isActive 
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400" 
                    : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.name}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto pt-4 border-t border-zinc-200 dark:border-zinc-800 w-full shrink-0">
          <div className="mb-4 px-3 py-2">
            <p className="text-xs font-medium text-zinc-500 truncate">{user?.userId}</p>
            <p className="text-[10px] text-zinc-400 uppercase tracking-wider">{user?.roles?.[0] || 'User'}</p>
          </div>
          <Button 
            variant="ghost" 
            className="w-full justify-start gap-3 text-zinc-600 hover:text-red-600 dark:text-zinc-400 dark:hover:text-red-400"
            onClick={logout}
          >
            <LogOut className="h-4 w-4" />
            Logout
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-8">
        {children}
      </main>
    </div>
  );
}

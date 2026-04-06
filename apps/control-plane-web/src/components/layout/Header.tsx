"use client";

import React from 'react';
import Link from 'next/link';
import { OrgSwitcher } from './OrgSwitcher';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { LogOut, ShieldCheck } from 'lucide-react';

export function Header() {
  const { logout, claims } = useAuth();
  return (
    <header className="fixed top-0 z-50 w-full border-b bg-background">
      <div className="flex h-16 items-center justify-between px-4 lg:px-6">
        <div className="flex items-center gap-4">
          <span className="text-lg font-bold">ECOM KIT</span>
          <div className="h-6 w-px bg-border hidden sm:block"></div>
          <OrgSwitcher />
        </div>
        <div className="flex items-center gap-4">
          {claims?.roles?.includes('super_admin') && (
            <Link
              href="/admin/dashboard"
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ShieldCheck className="h-4 w-4" />
              Admin
            </Link>
          )}
          <Button variant="ghost" size="icon" onClick={logout} title="Logout">
            <LogOut className="h-5 w-5" />
          </Button>
        </div>
      </div>
    </header>
  );
}

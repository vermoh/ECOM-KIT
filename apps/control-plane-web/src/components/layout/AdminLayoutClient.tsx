"use client";
import React from 'react';
import { Header } from '@/components/layout/Header';
import { AdminSidebar } from '@/components/layout/AdminSidebar';
import { SuperAdminGuard } from '@/components/auth/SuperAdminGuard';

export function AdminLayoutClient({ children }: { children: React.ReactNode }) {
  return (
    <SuperAdminGuard>
      <div className="min-h-screen">
        <Header />
        <AdminSidebar />
        <main className="pl-64 pt-16 h-screen overflow-y-auto bg-muted/20">
          <div className="p-8">{children}</div>
        </main>
      </div>
    </SuperAdminGuard>
  );
}

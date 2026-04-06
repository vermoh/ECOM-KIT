import React from 'react';
import { Header } from '@/components/layout/Header';
import { Sidebar } from '@/components/layout/Sidebar';

export default function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="min-h-screen">
      <Header />
      <Sidebar />
      <main className="pl-64 pt-16 h-screen overflow-y-auto bg-muted/20">
        <div className="p-8">
          {children}
        </div>
      </main>
    </div>
  );
}

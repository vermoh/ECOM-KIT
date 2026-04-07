"use client";

import React, { useState } from 'react';
import Link from 'next/link';
import { OrgSwitcher } from './OrgSwitcher';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { LogOut, ShieldCheck, Globe } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { setLocale } from '@/lib/locale';

export function Header() {
  const t = useTranslations('nav');
  const tc = useTranslations('common');
  const { logout, claims } = useAuth();
  const locale = useLocale();
  const [langOpen, setLangOpen] = useState(false);

  const languages = [
    { code: 'en', label: 'English' },
    { code: 'ru', label: 'Русский' },
    { code: 'ro', label: 'Română' },
  ];

  return (
    <header className="fixed top-0 z-50 w-full border-b bg-background">
      <div className="flex h-16 items-center justify-between px-4 lg:px-6">
        <div className="flex items-center gap-4">
          <span className="text-lg font-bold">ECOM KIT</span>
          <div className="h-6 w-px bg-border hidden sm:block"></div>
          <OrgSwitcher />
        </div>
        <div className="flex items-center gap-4">
          <div className="relative">
            <button
              onClick={() => setLangOpen(!langOpen)}
              className="flex items-center gap-1 px-2 py-1 text-sm rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <Globe className="h-4 w-4" />
              <span className="uppercase font-medium">{locale}</span>
            </button>
            {langOpen && (
              <div className="absolute right-0 mt-1 w-36 bg-white dark:bg-zinc-900 border rounded-lg shadow-lg z-50 py-1">
                {languages.map(l => (
                  <button
                    key={l.code}
                    onClick={async () => {
                      await setLocale(l.code);
                      setLangOpen(false);
                      window.location.reload();
                    }}
                    className={`w-full text-left px-3 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 ${locale === l.code ? 'font-bold' : ''}`}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {claims?.roles?.includes('super_admin') && (
            <Link
              href="/admin/dashboard"
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ShieldCheck className="h-4 w-4" />
              {t('admin')}
            </Link>
          )}
          <Button variant="ghost" size="icon" onClick={logout} title={tc('logout')}>
            <LogOut className="h-5 w-5" />
          </Button>
        </div>
      </div>
    </header>
  );
}

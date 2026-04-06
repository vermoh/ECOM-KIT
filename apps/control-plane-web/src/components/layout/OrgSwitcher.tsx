"use client";

import React from 'react';
import { useAuth } from '@/context/AuthContext';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Building2, ChevronDown } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface Org {
  id: string;
  name: string;
}

export function OrgSwitcher() {
  const { activeOrgId, switchOrg, accessToken } = useAuth();

  const { data: orgs = [] } = useQuery<Org[]>({
    queryKey: ['my-orgs', accessToken],
    queryFn: async () => {
      if (!accessToken) return [];
      const res = await fetch(`${API}/api/v1/organizations`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
    enabled: !!accessToken,
  });

  const activeOrg = orgs.find(o => o.id === activeOrgId) || orgs[0];

  if (orgs.length <= 1) {
    return (
      <div className="flex items-center gap-2 px-3 text-sm">
        <Building2 className="h-4 w-4" />
        <span className="truncate">{activeOrg?.name || 'Organization'}</span>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={cn(buttonVariants({ variant: "ghost" }), "w-[200px] justify-between outline-none")}>
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4" />
          <span className="truncate">{activeOrg?.name || 'Loading...'}</span>
        </div>
        <ChevronDown className="h-4 w-4 opacity-50" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-[200px]">
        {orgs.map((org) => (
          <DropdownMenuItem key={org.id} onClick={() => switchOrg(org.id)}>
            {org.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

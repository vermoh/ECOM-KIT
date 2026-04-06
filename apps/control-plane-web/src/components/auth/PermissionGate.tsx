"use client";

import React from 'react';
import { useAuth } from '@/context/AuthContext';

interface PermissionGateProps {
  permission: string;
  children: React.ReactNode;
}

export function PermissionGate({ permission, children }: PermissionGateProps) {
  const { can, isLoading } = useAuth();

  if (isLoading) return null;

  if (!can(permission)) {
    return null;
  }

  return <>{children}</>;
}

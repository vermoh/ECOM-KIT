"use client";

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { getToken, setToken, decodeToken, JwtClaims, getActiveOrgId, setActiveOrgId as setLocalOrgId, removeActiveOrgId, removeToken, hasPermission } from '../lib/auth';
import { useRouter, usePathname } from 'next/navigation';

interface AuthContextType {
  isAuthenticated: boolean;
  claims: JwtClaims | null;
  activeOrgId: string | null;
  login: (token: string, orgId?: string) => void;
  logout: () => void;
  switchOrg: (orgId: string) => void;
  can: (permission: string) => boolean;
  isLoading: boolean;
  accessToken: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [claims, setClaims] = useState<JwtClaims | null>(null);
  const [activeOrgId, setActiveOrgIdState] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();
  const refreshTimerRef = useRef<NodeJS.Timeout | null>(null);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

  // Auto-refresh: schedule a refresh 2 minutes before token expires
  const scheduleRefresh = useCallback((token: string) => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);

    const decoded = decodeToken(token);
    if (!decoded?.exp) return;

    const expiresIn = decoded.exp * 1000 - Date.now();
    const refreshIn = Math.max(expiresIn - 2 * 60 * 1000, 10_000); // 2 min before expiry, min 10s

    refreshTimerRef.current = setTimeout(async () => {
      const refreshToken = localStorage.getItem('refreshToken');
      if (!refreshToken) return;

      try {
        const res = await fetch(`${API_URL}/api/v1/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        if (res.ok) {
          const data = await res.json();
          setToken(data.accessToken);
          setAccessToken(data.accessToken);
          if (data.refreshToken) {
            localStorage.setItem('refreshToken', data.refreshToken);
          }
          const newClaims = decodeToken(data.accessToken);
          if (newClaims) setClaims(newClaims);
          scheduleRefresh(data.accessToken);
          console.log('[Auth] Token refreshed silently');
        } else {
          console.warn('[Auth] Token refresh failed, logging out');
          logout();
        }
      } catch (err) {
        console.warn('[Auth] Token refresh error:', err);
      }
    }, refreshIn);
  }, []);

  useEffect(() => {
    const initAuth = () => {
      const token = getToken();
      if (token) {
        const decoded = decodeToken(token);
        if (decoded) {
          if (decoded.exp * 1000 < Date.now()) {
            logout();
          } else {
            setClaims(decoded);
            const savedOrg = getActiveOrgId();
            if (savedOrg) {
              setActiveOrgIdState(savedOrg);
            } else if (decoded.orgId) {
              setActiveOrgIdState(decoded.orgId);
              setLocalOrgId(decoded.orgId);
            }
            setAccessToken(token);
            scheduleRefresh(token);
          }
        }
      }
      setIsLoading(false);
    };
    initAuth();
    return () => { if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current); };
  }, [pathname, scheduleRefresh]);

  const login = (token: string, orgId?: string) => {
    const decoded = decodeToken(token);
    if (decoded) {
      setClaims(decoded);
      if (orgId) {
        setActiveOrgIdState(orgId);
        setLocalOrgId(orgId);
      } else if (decoded.orgId) {
        setActiveOrgIdState(decoded.orgId);
        setLocalOrgId(decoded.orgId);
      }
      setAccessToken(token);
      // Super admin goes to admin panel, others to org dashboard
      if (decoded.roles?.includes('super_admin')) {
        router.push('/admin/dashboard');
      } else {
        router.push('/dashboard');
      }
    }
  };

  const logout = () => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    removeToken();
    removeActiveOrgId();
    localStorage.removeItem('refreshToken');
    setClaims(null);
    setActiveOrgIdState(null);
    setAccessToken(null);
    if (!pathname.startsWith('/login')) {
      router.push('/login');
    }
  };

  const switchOrg = (orgId: string) => {
    setActiveOrgIdState(orgId);
    setLocalOrgId(orgId);
    // Usually switching org requires a new token from the backend
    // This will be implemented by calling the backend and replacing the token.
    window.location.reload(); 
  };

  const can = (permission: string) => {
    return hasPermission(claims, permission);
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated: !!claims, claims, activeOrgId, login, logout, switchOrg, can, isLoading, accessToken }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

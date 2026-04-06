import { jwtDecode } from 'jwt-decode';

export const TOKEN_KEY = 'ecom_cp_token';
export const ORG_KEY = 'ecom_cp_org_id';

export interface JwtClaims {
  userId: string;
  orgId: string;
  roles: string[];
  permissions: string[];
  validUntil?: string | null;
  exp: number;
  iat: number;
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  if (typeof window !== 'undefined') {
    localStorage.setItem(TOKEN_KEY, token);
  }
}

export function removeToken() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(TOKEN_KEY);
  }
}

export function decodeToken(token: string): JwtClaims | null {
  try {
    return jwtDecode<JwtClaims>(token);
  } catch (error) {
    return null;
  }
}

export function getActiveOrgId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(ORG_KEY);
}

export function setActiveOrgId(orgId: string) {
  if (typeof window !== 'undefined') {
    localStorage.setItem(ORG_KEY, orgId);
  }
}

export function removeActiveOrgId() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(ORG_KEY);
  }
}

export function hasPermission(claims: JwtClaims | null, permission: string): boolean {
  if (!claims) return false;
  if (claims.permissions.includes('*')) return true;
  return claims.permissions.includes(permission);
}

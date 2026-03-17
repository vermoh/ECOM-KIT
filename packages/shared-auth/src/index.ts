export * from './jwt.js';
export * from './password.js';

import { UserSession } from '@ecom-kit/shared-types';

export function hasPermission(session: UserSession, permission: string): boolean {
  if (session.permissions.includes('*')) return true;
  return session.permissions.includes(permission);
}

export function hasAllPermissions(session: UserSession, permissions: string[]): boolean {
  if (session.permissions.includes('*')) return true;
  return permissions.every(p => p === '*' || session.permissions.includes(p));
}

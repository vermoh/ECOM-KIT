export * from './jwt.js';
export * from './password.js';
export * from './crypto.js';
import { UserSession } from '@ecom-kit/shared-types/src/index.js';
export declare function hasPermission(session: UserSession, permission: string): boolean;
export declare function hasAllPermissions(session: UserSession, permissions: string[]): boolean;
//# sourceMappingURL=index.d.ts.map
import jwt from 'jsonwebtoken';
import { UserSession } from '@ecom-kit/shared-types';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-for-dev';

export function generateToken(payload: UserSession): string {
  if (payload.exp) {
    return jwt.sign(payload, JWT_SECRET);
  }
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
}

export function verifyToken(token: string): UserSession {
  try {
    return jwt.verify(token, JWT_SECRET) as UserSession;
  } catch (error) {
    throw new Error('Invalid token');
  }
}

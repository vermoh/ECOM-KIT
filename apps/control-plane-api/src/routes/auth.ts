import { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { users, auditLogs, refreshTokens } from '@ecom-kit/shared-db';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { comparePassword, hashPassword, generateToken } from '@ecom-kit/shared-auth';
import { UserSession } from '@ecom-kit/shared-types';
import { v4 as uuidv4 } from 'uuid';

const connectionString = process.env.DATABASE_URL || 'postgres://ecom_user:ecom_password@localhost:5432/ecom_platform';
const client = postgres(connectionString);
const db = drizzle(client);

export async function authRoutes(fastify: FastifyInstance) {
  fastify.post('/register', async (request, reply) => {
    const { email, password } = request.body as any;

    if (!email || !password) {
      return reply.status(400).send({ error: 'Email and password are required' });
    }

    const [existingUser] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existingUser) {
      return reply.status(409).send({ error: 'User already exists' });
    }

    const passwordHash = await hashPassword(password);
    const [newUser] = await db.insert(users).values({
      email,
      passwordHash,
    }).returning();

    await db.insert(auditLogs).values({
      userId: newUser.id,
      action: 'user.register',
      payload: JSON.stringify({ email: newUser.email }),
    });

    return reply.status(201).send({ user: { id: newUser.id, email: newUser.email } });
  });

  fastify.post('/login', async (request, reply) => {
    const { email, password } = request.body as any;

    if (!email || !password) {
      return reply.status(400).send({ error: 'Email and password are required' });
    }

    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

    if (!user || !(await comparePassword(password, user.passwordHash))) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const accessTokenSession: UserSession = {
      userId: user.id,
      orgId: '00000000-0000-0000-0000-000000000000', // Placeholder
      roles: ['admin'], 
      permissions: ['*'],
      exp: Math.floor(Date.now() / 1000) + (15 * 60) // 15 minutes
    };

    const accessToken = generateToken(accessTokenSession);
    const refreshToken = uuidv4();

    // Store Refresh Token in DB
    await db.insert(refreshTokens).values({
      userId: user.id,
      token: refreshToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    });

    // Store Session in Redis for fast validation/revocation
    await fastify.redis.set(
      `session:${user.id}`,
      JSON.stringify(accessTokenSession),
      'EX',
      7 * 24 * 60 * 60
    );

    await db.insert(auditLogs).values({
      userId: user.id,
      action: 'user.login',
      payload: JSON.stringify({ email: user.email }),
    });

    return { 
      accessToken, 
      refreshToken, 
      user: { id: user.id, email: user.email } 
    };
  });

  fastify.post('/refresh', async (request, reply) => {
    const { refreshToken } = request.body as any;

    if (!refreshToken) {
      return reply.status(400).send({ error: 'Refresh token is required' });
    }

    const [storedToken] = await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.token, refreshToken))
      .limit(1);

    if (!storedToken || storedToken.revokedAt || new Date() > storedToken.expiresAt) {
      return reply.status(401).send({ error: 'Invalid or expired refresh token' });
    }

    const [user] = await db.select().from(users).where(eq(users.id, storedToken.userId)).limit(1);

    const accessTokenSession: UserSession = {
      userId: user.id,
      orgId: '00000000-0000-0000-0000-000000000000',
      roles: ['admin'],
      permissions: ['*'],
      exp: Math.floor(Date.now() / 1000) + (15 * 60)
    };

    const accessToken = generateToken(accessTokenSession);
    
    // Optional: Rotate refresh token here. For now, keep it simple.

    return { accessToken };
  });

  fastify.post('/logout', async (request, reply) => {
    const { refreshToken, userId } = request.body as any;

    if (refreshToken) {
      await db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(eq(refreshTokens.token, refreshToken));
    }

    if (userId) {
      await fastify.redis.del(`session:${userId}`);
    }

    return { success: true };
  });
}

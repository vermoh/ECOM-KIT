import { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { users, auditLogs } from '@ecom-kit/shared-db';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { comparePassword, generateToken } from '@ecom-kit/shared-auth';
import { UserSession } from '@ecom-kit/shared-types';

const connectionString = process.env.DATABASE_URL || 'postgres://ecom_user:ecom_password@localhost:5432/ecom_platform';
const client = postgres(connectionString);
const db = drizzle(client);

export async function authRoutes(fastify: FastifyInstance) {
  fastify.post('/login', async (request, reply) => {
    const { email, password } = request.body as any;

    if (!email || !password) {
      return reply.status(400).send({ error: 'Email and password are required' });
    }

    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

    if (!user || !(await comparePassword(password, user.passwordHash))) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    // For Phase 1, we assume a default org for the user or fetch the first one.
    // In Phase 2, we'll handle multiple organizations and memberships.
    const session: UserSession = {
      userId: user.id,
      orgId: '00000000-0000-0000-0000-000000000000', // Placeholder for now
      roles: ['admin'], // Placeholder
      permissions: ['*'], // Placeholder: grant all for now as per phase 1 goal
      exp: Math.floor(Date.now() / 1000) + 3600
    };

    const token = generateToken(session);

    // Record in AuditLog
    await db.insert(auditLogs).values({
      userId: user.id,
      action: 'user.login',
      payload: JSON.stringify({ email: user.email }),
    });

    return { token, user: { id: user.id, email: user.email } };
  });

  fastify.post('/logout', async (request, reply) => {
    // In a stateless JWT setup, logout is mainly a client-side action.
    // If we had a blacklist/Redis, we'd handle it here.
    return { success: true };
  });
}

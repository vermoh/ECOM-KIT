import { FastifyInstance } from 'fastify';
import { eq, and, db } from '@ecom-kit/shared-db';
import { users, auditLogs, refreshTokens, memberships, organizations } from '@ecom-kit/shared-db';
import { comparePassword, hashPassword, generateToken, verifyToken } from '@ecom-kit/shared-auth';
import { UserSession } from '@ecom-kit/shared-types';
import { v4 as uuidv4 } from 'uuid';
import { getEffectivePermissions } from '../rbac.js';

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
      status: 'active',
    }).returning();

    await db.insert(auditLogs).values({
      userId: newUser.id,
      action: 'user.register',
      payload: JSON.stringify({ email: newUser.email }),
    });

    return reply.status(201).send({ user: { id: newUser.id, email: newUser.email } });
  });

  fastify.post('/login', async (request, reply) => {
    const { email, password, orgId } = request.body as any;

    if (!email || !password) {
      return reply.status(400).send({ error: 'Email and password are required' });
    }

    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

    if (!user || user.status !== 'active' || !(await comparePassword(password, user.passwordHash))) {
      return reply.status(401).send({ error: 'Invalid credentials or inactive user' });
    }

    let sessionOrgId = orgId;
    let rolesSet: string[] = [];
    let permissionsSet: string[] = [];
    let validUntil: string | undefined;

    if (user.isSuperAdmin) {
      sessionOrgId = orgId || '00000000-0000-0000-0000-000000000001'; // Default Org (must exist in orgs table)
      rolesSet = ['super_admin'];
      permissionsSet = ['*'];
    } else {
      const userMemberships = await db
        .select()
        .from(memberships)
        .where(and(eq(memberships.userId, user.id), eq(memberships.status, 'active')));

      if (userMemberships.length === 0) {
        return reply.status(403).send({ error: 'No active organizations found for this user' });
      }

      if (!sessionOrgId) {
        sessionOrgId = userMemberships[0].orgId;
      }

      const effective = await getEffectivePermissions(db, user.id, sessionOrgId);
      if (effective.roles.length === 0) {
        return reply.status(403).send({ error: 'Access denied for the selected organization' });
      }

      rolesSet = effective.roles;
      permissionsSet = effective.permissions;
      validUntil = effective.validUntil;
    }

    const accessTokenSession: UserSession = {
      userId: user.id,
      orgId: sessionOrgId,
      roles: rolesSet,
      permissions: permissionsSet,
      validUntil,
      exp: Math.floor(Date.now() / 1000) + (2 * 60 * 60)
    };

    const accessToken = generateToken(accessTokenSession);
    const refreshToken = uuidv4();

    await db.insert(refreshTokens).values({
      userId: user.id,
      token: refreshToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    await fastify.redis.set(
      `session:${user.id}`,
      JSON.stringify(accessTokenSession),
      'EX',
      7 * 24 * 60 * 60
    );

    await db.insert(auditLogs).values({
      userId: user.id,
      orgId: sessionOrgId === '00000000-0000-0000-0000-000000000001' ? null : sessionOrgId,
      action: 'user.login',
      payload: JSON.stringify({ email: user.email }),
    });


    return { 
      accessToken, 
      refreshToken, 
      user: { id: user.id, email: user.email, isSuperAdmin: user.isSuperAdmin },
      orgId: sessionOrgId
    };
  });

  fastify.post('/switch-org', async (request, reply) => {
    const { orgId } = request.body as any;
    const authHeader = request.headers.authorization;
    
    if (!authHeader || !orgId) {
      return reply.status(400).send({ error: 'Authorization header and orgId are required' });
    }

    // This endpoint assumes the user is already authenticated
    // We would normally use the existing session from the verified token
    // For simplicity, let's assume request.user is populated by a middleware (which we haven't built yet)
    // For now, let's just use the current session's userId if we can verify it
    const token = authHeader.replace('Bearer ', '');
    const currentSession = verifyToken(token);

    const [user] = await db.select().from(users).where(eq(users.id, currentSession.userId)).limit(1);
    if (!user || user.status !== 'active') {
      return reply.status(401).send({ error: 'User not found or inactive' });
    }

    let rolesSet: string[] = [];
    let permissionsSet: string[] = [];
    let validUntil: string | undefined;

    if (user.isSuperAdmin) {
      rolesSet = ['super_admin'];
      permissionsSet = ['*'];
    } else {
      const effective = await getEffectivePermissions(db, user.id, orgId);
      if (effective.roles.length === 0) {
        return reply.status(403).send({ error: 'Access denied for the selected organization' });
      }
      rolesSet = effective.roles;
      permissionsSet = effective.permissions;
      validUntil = effective.validUntil;
    }

    const newSession: UserSession = {
      ...currentSession,
      orgId,
      roles: rolesSet,
      permissions: permissionsSet,
      validUntil,
      exp: Math.floor(Date.now() / 1000) + (2 * 60 * 60)
    };

    const accessToken = generateToken(newSession);

    await fastify.redis.set(
      `session:${user.id}`,
      JSON.stringify(newSession),
      'EX',
      7 * 24 * 60 * 60
    );

    return { accessToken, orgId };
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
    
    // Retrieve the last known session to maintain org context
    const lastSessionStr = await fastify.redis.get(`session:${user.id}`);
    const lastSession = lastSessionStr ? JSON.parse(lastSessionStr) : null;
    const sessionOrgId = lastSession?.orgId || '00000000-0000-0000-0000-000000000001';

    let rolesSet: string[] = [];
    let permissionsSet: string[] = [];
    let validUntil: string | undefined;

    if (user.isSuperAdmin) {
      rolesSet = ['super_admin'];
      permissionsSet = ['*'];
    } else {
      const effective = await getEffectivePermissions(db, user.id, sessionOrgId);
      if (effective.roles.length === 0) {
        return reply.status(403).send({ error: 'Access denied for the current organization' });
      }
      rolesSet = effective.roles;
      permissionsSet = effective.permissions;
      validUntil = effective.validUntil;
    }

    const accessTokenSession: UserSession = {
      userId: user.id,
      orgId: sessionOrgId,
      roles: rolesSet,
      permissions: permissionsSet,
      validUntil,
      exp: Math.floor(Date.now() / 1000) + (2 * 60 * 60)
    };

    const accessToken = generateToken(accessTokenSession);
    
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

import { FastifyInstance } from 'fastify';
import { hashPassword } from '@ecom-kit/shared-auth';
import {
  db,
  users,
  memberships,
  organizations,
  roles,
  auditLogs,
  tokenBudgets,
  projects,
  modelPricing,
  tokenUsageLogs,
  eq,
  and,
  or,
  desc,
  count,
  sql,
  isNull,
} from '@ecom-kit/shared-db';

export async function adminRoutes(fastify: FastifyInstance) {
  // All routes in this plugin require super_admin role
  fastify.addHook('preHandler', async (request, reply) => {
    const session = request.userSession;
    if (!session || !session.roles.includes('super_admin')) {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'super_admin role required' });
    }
  });

  // GET /api/v1/admin/users
  fastify.get('/users', async (request, reply) => {
    const { search, status, page: pageParam, limit: limitParam } = request.query as {
      search?: string;
      status?: string;
      page?: string;
      limit?: string;
    };

    const page = Math.max(1, parseInt(pageParam || '1', 10));
    const limit = Math.min(200, Math.max(1, parseInt(limitParam || '50', 10)));
    const offset = (page - 1) * limit;

    // Build where conditions
    const conditions: any[] = [sql`${users.status} != 'deleted'`];
    if (search) {
      conditions.push(sql`${users.email} ILIKE ${'%' + search + '%'}`);
    }
    if (status) {
      conditions.push(eq(users.status, status as any));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Total count
    const [{ total }] = await db
      .select({ total: count() })
      .from(users)
      .where(whereClause);

    // Fetch users with pagination
    const userRows = await db
      .select({
        id: users.id,
        email: users.email,
        status: users.status,
        isSuperAdmin: users.isSuperAdmin,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(whereClause)
      .orderBy(desc(users.createdAt))
      .limit(limit)
      .offset(offset);

    if (userRows.length === 0) {
      return { users: [], total: Number(total), page, limit };
    }

    const userIds = userRows.map((u) => u.id);

    // Fetch memberships + org + role for these users
    const membershipRows = await db
      .select({
        userId: memberships.userId,
        orgId: memberships.orgId,
        orgName: organizations.name,
        roleName: roles.name,
        membershipStatus: memberships.status,
      })
      .from(memberships)
      .innerJoin(organizations, eq(memberships.orgId, organizations.id))
      .innerJoin(roles, eq(memberships.roleId, roles.id))
      .where(sql`${memberships.userId} = ANY(${sql.raw("'{" + userIds.map((id) => id).join(',') + "}'::uuid[]")})`);

    // Group memberships by userId
    const membershipsByUser: Record<string, Array<{ orgId: string; orgName: string; roleName: string; status: string }>> = {};
    for (const row of membershipRows) {
      if (!membershipsByUser[row.userId]) {
        membershipsByUser[row.userId] = [];
      }
      membershipsByUser[row.userId].push({
        orgId: row.orgId,
        orgName: row.orgName,
        roleName: row.roleName,
        status: row.membershipStatus,
      });
    }

    const result = userRows.map((u) => ({
      ...u,
      memberships: membershipsByUser[u.id] || [],
    }));

    return { users: result, total: Number(total), page, limit };
  });

  // PATCH /api/v1/admin/users/:id/status
  fastify.patch('/users/:id/status', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { status } = request.body as { status: 'active' | 'locked' };
    const session = request.userSession!;

    if (!status || !['active', 'locked'].includes(status)) {
      return reply.status(400).send({ error: 'INVALID_STATUS', message: "status must be 'active' or 'locked'" });
    }

    const [updatedUser] = await db
      .update(users)
      .set({ status: status as any, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning({
        id: users.id,
        email: users.email,
        status: users.status,
        isSuperAdmin: users.isSuperAdmin,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      });

    if (!updatedUser) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'User not found' });
    }

    await db.insert(auditLogs).values({
      orgId: null,
      userId: session.userId,
      actorType: 'user',
      action: 'admin.user_status_changed',
      resourceType: 'user',
      resourceId: id,
      payload: JSON.stringify({ newStatus: status, targetUserId: id }),
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
    });

    return updatedUser;
  });

  // POST /api/v1/admin/users/:id/assign-org — Assign user to organization
  fastify.post('/users/:id/assign-org', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { orgId, roleName } = request.body as { orgId: string; roleName: string };
    const session = request.userSession!;

    if (!orgId || !roleName) {
      return reply.status(400).send({ error: 'orgId and roleName required' });
    }

    // Find the role
    const [role] = await db.select().from(roles)
      .where(and(eq(roles.name, roleName), isNull(roles.orgId)))
      .limit(1);
    if (!role) return reply.status(400).send({ error: 'Role not found' });

    // Check if already a member
    const [existing] = await db.select({ id: memberships.id }).from(memberships)
      .where(and(eq(memberships.userId, id), eq(memberships.orgId, orgId)))
      .limit(1);
    if (existing) {
      // Update existing membership
      const [updated] = await db.update(memberships)
        .set({ roleId: role.id, status: 'active' })
        .where(eq(memberships.id, existing.id))
        .returning();
      return updated;
    }

    const [membership] = await db.insert(memberships).values({
      orgId,
      userId: id,
      roleId: role.id,
      status: 'active',
      invitedBy: session.userId,
    }).returning();

    await db.insert(auditLogs).values({
      orgId,
      userId: session.userId,
      actorType: 'user',
      action: 'admin.user_assigned_to_org',
      resourceType: 'membership',
      resourceId: membership.id,
      payload: JSON.stringify({ userId: id, orgId, roleName }),
    });

    return membership;
  });

  // DELETE /api/v1/admin/users/:id/remove-org — Remove user from organization
  fastify.delete('/users/:id/remove-org', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { orgId } = request.body as { orgId: string };
    const session = request.userSession!;

    if (!orgId) return reply.status(400).send({ error: 'orgId required' });

    await db.delete(memberships)
      .where(and(eq(memberships.userId, id), eq(memberships.orgId, orgId)));

    await db.insert(auditLogs).values({
      userId: session.userId,
      actorType: 'user',
      action: 'admin.user_removed_from_org',
      resourceType: 'membership',
      payload: JSON.stringify({ userId: id, orgId }),
    });

    return reply.status(204).send();
  });

  // POST /api/v1/admin/users — Create user
  fastify.post('/users', async (request, reply) => {
    const { email, password, isSuperAdmin } = request.body as {
      email: string;
      password: string;
      isSuperAdmin?: boolean;
    };
    const session = request.userSession!;

    if (!email || !password) {
      return reply.status(400).send({ error: 'email and password required' });
    }

    // Check if email already exists
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing) {
      return reply.status(409).send({ error: 'User with this email already exists' });
    }

    const passwordHash = await hashPassword(password);
    const [newUser] = await db.insert(users).values({
      email,
      passwordHash,
      status: 'active',
      isSuperAdmin: isSuperAdmin || false,
    }).returning({
      id: users.id,
      email: users.email,
      status: users.status,
      isSuperAdmin: users.isSuperAdmin,
      createdAt: users.createdAt,
    });

    await db.insert(auditLogs).values({
      userId: session.userId,
      actorType: 'user',
      action: 'admin.user_created',
      resourceType: 'user',
      resourceId: newUser.id,
      payload: JSON.stringify({ email, isSuperAdmin: isSuperAdmin || false }),
    });

    return newUser;
  });

  // PATCH /api/v1/admin/users/:id — Edit user
  fastify.patch('/users/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { email?: string; password?: string; isSuperAdmin?: boolean };
    const session = request.userSession!;

    const updates: any = { updatedAt: new Date() };
    if (body.email !== undefined) updates.email = body.email;
    if (body.password) updates.passwordHash = await hashPassword(body.password);
    if (body.isSuperAdmin !== undefined) updates.isSuperAdmin = body.isSuperAdmin;

    const [updated] = await db.update(users)
      .set(updates)
      .where(eq(users.id, id))
      .returning({
        id: users.id,
        email: users.email,
        status: users.status,
        isSuperAdmin: users.isSuperAdmin,
      });

    if (!updated) return reply.status(404).send({ error: 'User not found' });

    await db.insert(auditLogs).values({
      userId: session.userId,
      actorType: 'user',
      action: 'admin.user_updated',
      resourceType: 'user',
      resourceId: id,
      payload: JSON.stringify({ email: body.email, isSuperAdmin: body.isSuperAdmin }),
    });

    return updated;
  });

  // DELETE /api/v1/admin/users/:id — Delete user
  fastify.delete('/users/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = request.userSession!;

    // Prevent self-delete
    if (id === session.userId) {
      return reply.status(400).send({ error: 'Cannot delete yourself' });
    }

    // Soft-delete: set status to 'deleted' and deactivate memberships
    await db.update(memberships)
      .set({ status: 'removed' })
      .where(eq(memberships.userId, id));

    const [deleted] = await db.update(users)
      .set({ status: 'deleted' as any, deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning({ id: users.id });

    if (!deleted) return reply.status(404).send({ error: 'User not found' });

    await db.insert(auditLogs).values({
      userId: session.userId,
      actorType: 'user',
      action: 'admin.user_deleted',
      resourceType: 'user',
      resourceId: id,
    });

    return reply.status(204).send();
  });

  // GET /api/v1/admin/audit-logs
  fastify.get('/audit-logs', async (request, reply) => {
    const { orgId, action, page: pageParam, limit: limitParam } = request.query as {
      orgId?: string;
      action?: string;
      page?: string;
      limit?: string;
    };

    const page = Math.max(1, parseInt(pageParam || '1', 10));
    const limit = Math.min(200, Math.max(1, parseInt(limitParam || '50', 10)));
    const offset = (page - 1) * limit;

    const conditions: any[] = [];
    if (orgId) {
      conditions.push(eq(auditLogs.orgId, orgId));
    }
    if (action) {
      conditions.push(eq(auditLogs.action, action));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [{ total }] = await db
      .select({ total: count() })
      .from(auditLogs)
      .where(whereClause);

    const logs = await db
      .select({
        id: auditLogs.id,
        orgId: auditLogs.orgId,
        orgName: organizations.name,
        userId: auditLogs.userId,
        actorEmail: users.email,
        actorType: auditLogs.actorType,
        action: auditLogs.action,
        resourceType: auditLogs.resourceType,
        resourceId: auditLogs.resourceId,
        payload: auditLogs.payload,
        ipAddress: auditLogs.ipAddress,
        userAgent: auditLogs.userAgent,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.userId, users.id))
      .leftJoin(organizations, eq(auditLogs.orgId, organizations.id))
      .where(whereClause)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit)
      .offset(offset);

    return { logs, total: Number(total), page, limit };
  });

  // GET /api/v1/admin/usage
  fastify.get('/usage', async (request, reply) => {
    // Aggregate org info joined with tokenBudgets and project counts
    const rows = await db
      .select({
        orgId: organizations.id,
        orgName: organizations.name,
        plan: organizations.plan,
        status: organizations.status,
        updatedAt: organizations.updatedAt,
        totalTokens: tokenBudgets.totalTokens,
        remainingTokens: tokenBudgets.remainingTokens,
      })
      .from(organizations)
      .leftJoin(tokenBudgets, eq(organizations.id, tokenBudgets.orgId))
      .where(sql`${organizations.status} != 'deleted'`)
      .orderBy(desc(organizations.updatedAt));

    if (rows.length === 0) {
      return [];
    }

    const orgIds = rows.map((r) => r.orgId);

    // Count projects per org
    const projectCounts = await db
      .select({
        orgId: projects.orgId,
        projectCount: count(),
      })
      .from(projects)
      .where(sql`${projects.orgId} = ANY(${sql.raw("'{" + orgIds.join(',') + "}'::uuid[]")})`)
      .groupBy(projects.orgId);

    const projectCountByOrg: Record<string, number> = {};
    for (const pc of projectCounts) {
      projectCountByOrg[pc.orgId] = Number(pc.projectCount);
    }

    // Sum costUsd per org from tokenUsageLogs
    const costRows = await db
      .select({
        orgId: tokenUsageLogs.orgId,
        totalCost: sql<string>`COALESCE(SUM(${tokenUsageLogs.costUsd}::numeric), 0)`,
      })
      .from(tokenUsageLogs)
      .where(sql`${tokenUsageLogs.orgId} = ANY(${sql.raw("'{" + orgIds.join(',') + "}'::uuid[]")})`)
      .groupBy(tokenUsageLogs.orgId);

    const costByOrg: Record<string, number> = {};
    for (const c of costRows) {
      costByOrg[c.orgId] = Number(c.totalCost);
    }

    const usage = rows.map((r) => {
      const totalTokens = r.totalTokens ?? 0;
      const remainingTokens = r.remainingTokens ?? 0;
      return {
        orgId: r.orgId,
        orgName: r.orgName,
        plan: r.plan,
        status: r.status,
        totalTokens,
        remainingTokens,
        tokensUsed: totalTokens - remainingTokens,
        totalCostUsd: costByOrg[r.orgId] ?? 0,
        projectCount: projectCountByOrg[r.orgId] ?? 0,
        lastActivity: r.updatedAt,
      };
    });

    return usage;
  });

  // ==================== Model Pricing CRUD ====================

  // GET /api/v1/admin/model-pricing
  fastify.get('/model-pricing', async (request, reply) => {
    const rows = await db.select().from(modelPricing).orderBy(modelPricing.model);
    return rows;
  });

  // POST /api/v1/admin/model-pricing
  fastify.post('/model-pricing', async (request, reply) => {
    const { model, provider, displayName, inputCostPer1m, outputCostPer1m } = request.body as any;

    if (!model || !inputCostPer1m || !outputCostPer1m) {
      return reply.status(400).send({ error: 'model, inputCostPer1m, outputCostPer1m required' });
    }

    const [row] = await db.insert(modelPricing).values({
      model,
      provider: provider || 'openrouter',
      displayName: displayName || model,
      inputCostPer1m: String(inputCostPer1m),
      outputCostPer1m: String(outputCostPer1m),
    }).returning();

    return row;
  });

  // PATCH /api/v1/admin/model-pricing/:id
  fastify.patch('/model-pricing/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as any;

    const updates: any = { updatedAt: new Date() };
    if (body.inputCostPer1m !== undefined) updates.inputCostPer1m = String(body.inputCostPer1m);
    if (body.outputCostPer1m !== undefined) updates.outputCostPer1m = String(body.outputCostPer1m);
    if (body.displayName !== undefined) updates.displayName = body.displayName;
    if (body.isActive !== undefined) updates.isActive = body.isActive;

    const [updated] = await db.update(modelPricing)
      .set(updates)
      .where(eq(modelPricing.id, id))
      .returning();

    if (!updated) return reply.status(404).send({ error: 'Pricing not found' });
    return updated;
  });

  // DELETE /api/v1/admin/model-pricing/:id
  fastify.delete('/model-pricing/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    await db.delete(modelPricing).where(eq(modelPricing.id, id));
    return reply.status(204).send();
  });
}

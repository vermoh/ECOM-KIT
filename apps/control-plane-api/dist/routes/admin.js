"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminRoutes = adminRoutes;
const shared_auth_1 = require("@ecom-kit/shared-auth");
const shared_db_1 = require("@ecom-kit/shared-db");
async function adminRoutes(fastify) {
    fastify.addHook('preHandler', async (request, reply) => {
        const session = request.userSession;
        if (!session || !session.roles.includes('super_admin')) {
            return reply.status(403).send({ error: 'FORBIDDEN', message: 'super_admin role required' });
        }
    });
    fastify.get('/users', async (request, reply) => {
        const { search, status, page: pageParam, limit: limitParam } = request.query;
        const page = Math.max(1, parseInt(pageParam || '1', 10));
        const limit = Math.min(200, Math.max(1, parseInt(limitParam || '50', 10)));
        const offset = (page - 1) * limit;
        const conditions = [];
        if (search) {
            conditions.push((0, shared_db_1.sql) `${shared_db_1.users.email} ILIKE ${'%' + search + '%'}`);
        }
        if (status) {
            conditions.push((0, shared_db_1.eq)(shared_db_1.users.status, status));
        }
        const whereClause = conditions.length > 0 ? (0, shared_db_1.and)(...conditions) : undefined;
        const [{ total }] = await shared_db_1.db
            .select({ total: (0, shared_db_1.count)() })
            .from(shared_db_1.users)
            .where(whereClause);
        const userRows = await shared_db_1.db
            .select({
            id: shared_db_1.users.id,
            email: shared_db_1.users.email,
            status: shared_db_1.users.status,
            isSuperAdmin: shared_db_1.users.isSuperAdmin,
            createdAt: shared_db_1.users.createdAt,
        })
            .from(shared_db_1.users)
            .where(whereClause)
            .orderBy((0, shared_db_1.desc)(shared_db_1.users.createdAt))
            .limit(limit)
            .offset(offset);
        if (userRows.length === 0) {
            return { users: [], total: Number(total), page, limit };
        }
        const userIds = userRows.map((u) => u.id);
        const membershipRows = await shared_db_1.db
            .select({
            userId: shared_db_1.memberships.userId,
            orgId: shared_db_1.memberships.orgId,
            orgName: shared_db_1.organizations.name,
            roleName: shared_db_1.roles.name,
            membershipStatus: shared_db_1.memberships.status,
        })
            .from(shared_db_1.memberships)
            .innerJoin(shared_db_1.organizations, (0, shared_db_1.eq)(shared_db_1.memberships.orgId, shared_db_1.organizations.id))
            .innerJoin(shared_db_1.roles, (0, shared_db_1.eq)(shared_db_1.memberships.roleId, shared_db_1.roles.id))
            .where((0, shared_db_1.sql) `${shared_db_1.memberships.userId} = ANY(${shared_db_1.sql.raw("'{" + userIds.map((id) => id).join(',') + "}'::uuid[]")})`);
        const membershipsByUser = {};
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
    fastify.patch('/users/:id/status', async (request, reply) => {
        const { id } = request.params;
        const { status } = request.body;
        const session = request.userSession;
        if (!status || !['active', 'locked'].includes(status)) {
            return reply.status(400).send({ error: 'INVALID_STATUS', message: "status must be 'active' or 'locked'" });
        }
        const [updatedUser] = await shared_db_1.db
            .update(shared_db_1.users)
            .set({ status: status, updatedAt: new Date() })
            .where((0, shared_db_1.eq)(shared_db_1.users.id, id))
            .returning({
            id: shared_db_1.users.id,
            email: shared_db_1.users.email,
            status: shared_db_1.users.status,
            isSuperAdmin: shared_db_1.users.isSuperAdmin,
            createdAt: shared_db_1.users.createdAt,
            updatedAt: shared_db_1.users.updatedAt,
        });
        if (!updatedUser) {
            return reply.status(404).send({ error: 'NOT_FOUND', message: 'User not found' });
        }
        await shared_db_1.db.insert(shared_db_1.auditLogs).values({
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
    fastify.post('/users/:id/assign-org', async (request, reply) => {
        const { id } = request.params;
        const { orgId, roleName } = request.body;
        const session = request.userSession;
        if (!orgId || !roleName) {
            return reply.status(400).send({ error: 'orgId and roleName required' });
        }
        const [role] = await shared_db_1.db.select().from(shared_db_1.roles)
            .where((0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.roles.name, roleName), (0, shared_db_1.isNull)(shared_db_1.roles.orgId)))
            .limit(1);
        if (!role)
            return reply.status(400).send({ error: 'Role not found' });
        const [existing] = await shared_db_1.db.select({ id: shared_db_1.memberships.id }).from(shared_db_1.memberships)
            .where((0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.memberships.userId, id), (0, shared_db_1.eq)(shared_db_1.memberships.orgId, orgId)))
            .limit(1);
        if (existing) {
            const [updated] = await shared_db_1.db.update(shared_db_1.memberships)
                .set({ roleId: role.id, status: 'active' })
                .where((0, shared_db_1.eq)(shared_db_1.memberships.id, existing.id))
                .returning();
            return updated;
        }
        const [membership] = await shared_db_1.db.insert(shared_db_1.memberships).values({
            orgId,
            userId: id,
            roleId: role.id,
            status: 'active',
            invitedBy: session.userId,
        }).returning();
        await shared_db_1.db.insert(shared_db_1.auditLogs).values({
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
    fastify.delete('/users/:id/remove-org', async (request, reply) => {
        const { id } = request.params;
        const { orgId } = request.body;
        const session = request.userSession;
        if (!orgId)
            return reply.status(400).send({ error: 'orgId required' });
        await shared_db_1.db.delete(shared_db_1.memberships)
            .where((0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.memberships.userId, id), (0, shared_db_1.eq)(shared_db_1.memberships.orgId, orgId)));
        await shared_db_1.db.insert(shared_db_1.auditLogs).values({
            userId: session.userId,
            actorType: 'user',
            action: 'admin.user_removed_from_org',
            resourceType: 'membership',
            payload: JSON.stringify({ userId: id, orgId }),
        });
        return reply.status(204).send();
    });
    fastify.post('/users', async (request, reply) => {
        const { email, password, isSuperAdmin } = request.body;
        const session = request.userSession;
        if (!email || !password) {
            return reply.status(400).send({ error: 'email and password required' });
        }
        const [existing] = await shared_db_1.db.select({ id: shared_db_1.users.id }).from(shared_db_1.users).where((0, shared_db_1.eq)(shared_db_1.users.email, email)).limit(1);
        if (existing) {
            return reply.status(409).send({ error: 'User with this email already exists' });
        }
        const passwordHash = await (0, shared_auth_1.hashPassword)(password);
        const [newUser] = await shared_db_1.db.insert(shared_db_1.users).values({
            email,
            passwordHash,
            status: 'active',
            isSuperAdmin: isSuperAdmin || false,
        }).returning({
            id: shared_db_1.users.id,
            email: shared_db_1.users.email,
            status: shared_db_1.users.status,
            isSuperAdmin: shared_db_1.users.isSuperAdmin,
            createdAt: shared_db_1.users.createdAt,
        });
        await shared_db_1.db.insert(shared_db_1.auditLogs).values({
            userId: session.userId,
            actorType: 'user',
            action: 'admin.user_created',
            resourceType: 'user',
            resourceId: newUser.id,
            payload: JSON.stringify({ email, isSuperAdmin: isSuperAdmin || false }),
        });
        return newUser;
    });
    fastify.patch('/users/:id', async (request, reply) => {
        const { id } = request.params;
        const body = request.body;
        const session = request.userSession;
        const updates = { updatedAt: new Date() };
        if (body.email !== undefined)
            updates.email = body.email;
        if (body.password)
            updates.passwordHash = await (0, shared_auth_1.hashPassword)(body.password);
        if (body.isSuperAdmin !== undefined)
            updates.isSuperAdmin = body.isSuperAdmin;
        const [updated] = await shared_db_1.db.update(shared_db_1.users)
            .set(updates)
            .where((0, shared_db_1.eq)(shared_db_1.users.id, id))
            .returning({
            id: shared_db_1.users.id,
            email: shared_db_1.users.email,
            status: shared_db_1.users.status,
            isSuperAdmin: shared_db_1.users.isSuperAdmin,
        });
        if (!updated)
            return reply.status(404).send({ error: 'User not found' });
        await shared_db_1.db.insert(shared_db_1.auditLogs).values({
            userId: session.userId,
            actorType: 'user',
            action: 'admin.user_updated',
            resourceType: 'user',
            resourceId: id,
            payload: JSON.stringify({ email: body.email, isSuperAdmin: body.isSuperAdmin }),
        });
        return updated;
    });
    fastify.delete('/users/:id', async (request, reply) => {
        const { id } = request.params;
        const session = request.userSession;
        if (id === session.userId) {
            return reply.status(400).send({ error: 'Cannot delete yourself' });
        }
        await shared_db_1.db.delete(shared_db_1.memberships).where((0, shared_db_1.eq)(shared_db_1.memberships.userId, id));
        const [deleted] = await shared_db_1.db.delete(shared_db_1.users).where((0, shared_db_1.eq)(shared_db_1.users.id, id)).returning({ id: shared_db_1.users.id });
        if (!deleted)
            return reply.status(404).send({ error: 'User not found' });
        await shared_db_1.db.insert(shared_db_1.auditLogs).values({
            userId: session.userId,
            actorType: 'user',
            action: 'admin.user_deleted',
            resourceType: 'user',
            resourceId: id,
        });
        return reply.status(204).send();
    });
    fastify.get('/audit-logs', async (request, reply) => {
        const { orgId, action, page: pageParam, limit: limitParam } = request.query;
        const page = Math.max(1, parseInt(pageParam || '1', 10));
        const limit = Math.min(200, Math.max(1, parseInt(limitParam || '50', 10)));
        const offset = (page - 1) * limit;
        const conditions = [];
        if (orgId) {
            conditions.push((0, shared_db_1.eq)(shared_db_1.auditLogs.orgId, orgId));
        }
        if (action) {
            conditions.push((0, shared_db_1.eq)(shared_db_1.auditLogs.action, action));
        }
        const whereClause = conditions.length > 0 ? (0, shared_db_1.and)(...conditions) : undefined;
        const [{ total }] = await shared_db_1.db
            .select({ total: (0, shared_db_1.count)() })
            .from(shared_db_1.auditLogs)
            .where(whereClause);
        const logs = await shared_db_1.db
            .select({
            id: shared_db_1.auditLogs.id,
            orgId: shared_db_1.auditLogs.orgId,
            orgName: shared_db_1.organizations.name,
            userId: shared_db_1.auditLogs.userId,
            actorEmail: shared_db_1.users.email,
            actorType: shared_db_1.auditLogs.actorType,
            action: shared_db_1.auditLogs.action,
            resourceType: shared_db_1.auditLogs.resourceType,
            resourceId: shared_db_1.auditLogs.resourceId,
            payload: shared_db_1.auditLogs.payload,
            ipAddress: shared_db_1.auditLogs.ipAddress,
            userAgent: shared_db_1.auditLogs.userAgent,
            createdAt: shared_db_1.auditLogs.createdAt,
        })
            .from(shared_db_1.auditLogs)
            .leftJoin(shared_db_1.users, (0, shared_db_1.eq)(shared_db_1.auditLogs.userId, shared_db_1.users.id))
            .leftJoin(shared_db_1.organizations, (0, shared_db_1.eq)(shared_db_1.auditLogs.orgId, shared_db_1.organizations.id))
            .where(whereClause)
            .orderBy((0, shared_db_1.desc)(shared_db_1.auditLogs.createdAt))
            .limit(limit)
            .offset(offset);
        return { logs, total: Number(total), page, limit };
    });
    fastify.get('/usage', async (request, reply) => {
        const rows = await shared_db_1.db
            .select({
            orgId: shared_db_1.organizations.id,
            orgName: shared_db_1.organizations.name,
            plan: shared_db_1.organizations.plan,
            status: shared_db_1.organizations.status,
            updatedAt: shared_db_1.organizations.updatedAt,
            totalTokens: shared_db_1.tokenBudgets.totalTokens,
            remainingTokens: shared_db_1.tokenBudgets.remainingTokens,
        })
            .from(shared_db_1.organizations)
            .leftJoin(shared_db_1.tokenBudgets, (0, shared_db_1.eq)(shared_db_1.organizations.id, shared_db_1.tokenBudgets.orgId))
            .where((0, shared_db_1.sql) `${shared_db_1.organizations.status} != 'deleted'`)
            .orderBy((0, shared_db_1.desc)(shared_db_1.organizations.updatedAt));
        if (rows.length === 0) {
            return [];
        }
        const orgIds = rows.map((r) => r.orgId);
        const projectCounts = await shared_db_1.db
            .select({
            orgId: shared_db_1.projects.orgId,
            projectCount: (0, shared_db_1.count)(),
        })
            .from(shared_db_1.projects)
            .where((0, shared_db_1.sql) `${shared_db_1.projects.orgId} = ANY(${shared_db_1.sql.raw("'{" + orgIds.join(',') + "}'::uuid[]")})`)
            .groupBy(shared_db_1.projects.orgId);
        const projectCountByOrg = {};
        for (const pc of projectCounts) {
            projectCountByOrg[pc.orgId] = Number(pc.projectCount);
        }
        const costRows = await shared_db_1.db
            .select({
            orgId: shared_db_1.tokenUsageLogs.orgId,
            totalCost: (0, shared_db_1.sql) `COALESCE(SUM(${shared_db_1.tokenUsageLogs.costUsd}::numeric), 0)`,
        })
            .from(shared_db_1.tokenUsageLogs)
            .where((0, shared_db_1.sql) `${shared_db_1.tokenUsageLogs.orgId} = ANY(${shared_db_1.sql.raw("'{" + orgIds.join(',') + "}'::uuid[]")})`)
            .groupBy(shared_db_1.tokenUsageLogs.orgId);
        const costByOrg = {};
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
    fastify.get('/model-pricing', async (request, reply) => {
        const rows = await shared_db_1.db.select().from(shared_db_1.modelPricing).orderBy(shared_db_1.modelPricing.model);
        return rows;
    });
    fastify.post('/model-pricing', async (request, reply) => {
        const { model, provider, displayName, inputCostPer1m, outputCostPer1m } = request.body;
        if (!model || !inputCostPer1m || !outputCostPer1m) {
            return reply.status(400).send({ error: 'model, inputCostPer1m, outputCostPer1m required' });
        }
        const [row] = await shared_db_1.db.insert(shared_db_1.modelPricing).values({
            model,
            provider: provider || 'openrouter',
            displayName: displayName || model,
            inputCostPer1m: String(inputCostPer1m),
            outputCostPer1m: String(outputCostPer1m),
        }).returning();
        return row;
    });
    fastify.patch('/model-pricing/:id', async (request, reply) => {
        const { id } = request.params;
        const body = request.body;
        const updates = { updatedAt: new Date() };
        if (body.inputCostPer1m !== undefined)
            updates.inputCostPer1m = String(body.inputCostPer1m);
        if (body.outputCostPer1m !== undefined)
            updates.outputCostPer1m = String(body.outputCostPer1m);
        if (body.displayName !== undefined)
            updates.displayName = body.displayName;
        if (body.isActive !== undefined)
            updates.isActive = body.isActive;
        const [updated] = await shared_db_1.db.update(shared_db_1.modelPricing)
            .set(updates)
            .where((0, shared_db_1.eq)(shared_db_1.modelPricing.id, id))
            .returning();
        if (!updated)
            return reply.status(404).send({ error: 'Pricing not found' });
        return updated;
    });
    fastify.delete('/model-pricing/:id', async (request, reply) => {
        const { id } = request.params;
        await shared_db_1.db.delete(shared_db_1.modelPricing).where((0, shared_db_1.eq)(shared_db_1.modelPricing.id, id));
        return reply.status(204).send();
    });
}
//# sourceMappingURL=admin.js.map
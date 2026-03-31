"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRoutes = authRoutes;
const shared_db_1 = require("@ecom-kit/shared-db");
const shared_db_2 = require("@ecom-kit/shared-db");
const shared_auth_1 = require("@ecom-kit/shared-auth");
const uuid_1 = require("uuid");
const rbac_js_1 = require("../rbac.js");
async function authRoutes(fastify) {
    fastify.post('/register', async (request, reply) => {
        const { email, password } = request.body;
        if (!email || !password) {
            return reply.status(400).send({ error: 'Email and password are required' });
        }
        const [existingUser] = await shared_db_1.db.select().from(shared_db_2.users).where((0, shared_db_1.eq)(shared_db_2.users.email, email)).limit(1);
        if (existingUser) {
            return reply.status(409).send({ error: 'User already exists' });
        }
        const passwordHash = await (0, shared_auth_1.hashPassword)(password);
        const [newUser] = await shared_db_1.db.insert(shared_db_2.users).values({
            email,
            passwordHash,
            status: 'active',
        }).returning();
        await shared_db_1.db.insert(shared_db_2.auditLogs).values({
            userId: newUser.id,
            action: 'user.register',
            payload: JSON.stringify({ email: newUser.email }),
        });
        return reply.status(201).send({ user: { id: newUser.id, email: newUser.email } });
    });
    fastify.post('/login', async (request, reply) => {
        const { email, password, orgId } = request.body;
        if (!email || !password) {
            return reply.status(400).send({ error: 'Email and password are required' });
        }
        const [user] = await shared_db_1.db.select().from(shared_db_2.users).where((0, shared_db_1.eq)(shared_db_2.users.email, email)).limit(1);
        if (!user || user.status !== 'active' || !(await (0, shared_auth_1.comparePassword)(password, user.passwordHash))) {
            return reply.status(401).send({ error: 'Invalid credentials or inactive user' });
        }
        let sessionOrgId = orgId;
        let rolesSet = [];
        let permissionsSet = [];
        let validUntil;
        if (user.isSuperAdmin) {
            sessionOrgId = orgId || '00000000-0000-0000-0000-000000000000';
            rolesSet = ['super_admin'];
            permissionsSet = ['*'];
        }
        else {
            const userMemberships = await shared_db_1.db
                .select()
                .from(shared_db_2.memberships)
                .where((0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_2.memberships.userId, user.id), (0, shared_db_1.eq)(shared_db_2.memberships.status, 'active')));
            if (userMemberships.length === 0) {
                return reply.status(403).send({ error: 'No active organizations found for this user' });
            }
            if (!sessionOrgId) {
                sessionOrgId = userMemberships[0].orgId;
            }
            const effective = await (0, rbac_js_1.getEffectivePermissions)(shared_db_1.db, user.id, sessionOrgId);
            if (effective.roles.length === 0) {
                return reply.status(403).send({ error: 'Access denied for the selected organization' });
            }
            rolesSet = effective.roles;
            permissionsSet = effective.permissions;
            validUntil = effective.validUntil;
        }
        const accessTokenSession = {
            userId: user.id,
            orgId: sessionOrgId,
            roles: rolesSet,
            permissions: permissionsSet,
            validUntil,
            exp: Math.floor(Date.now() / 1000) + (15 * 60)
        };
        const accessToken = (0, shared_auth_1.generateToken)(accessTokenSession);
        const refreshToken = (0, uuid_1.v4)();
        await shared_db_1.db.insert(shared_db_2.refreshTokens).values({
            userId: user.id,
            token: refreshToken,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });
        await fastify.redis.set(`session:${user.id}`, JSON.stringify(accessTokenSession), 'EX', 7 * 24 * 60 * 60);
        await shared_db_1.db.insert(shared_db_2.auditLogs).values({
            userId: user.id,
            orgId: sessionOrgId === '00000000-0000-0000-0000-000000000000' ? null : sessionOrgId,
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
        const { orgId } = request.body;
        const authHeader = request.headers.authorization;
        if (!authHeader || !orgId) {
            return reply.status(400).send({ error: 'Authorization header and orgId are required' });
        }
        const token = authHeader.replace('Bearer ', '');
        const currentSession = (0, shared_auth_1.verifyToken)(token);
        const [user] = await shared_db_1.db.select().from(shared_db_2.users).where((0, shared_db_1.eq)(shared_db_2.users.id, currentSession.userId)).limit(1);
        if (!user || user.status !== 'active') {
            return reply.status(401).send({ error: 'User not found or inactive' });
        }
        let rolesSet = [];
        let permissionsSet = [];
        let validUntil;
        if (user.isSuperAdmin) {
            rolesSet = ['super_admin'];
            permissionsSet = ['*'];
        }
        else {
            const effective = await (0, rbac_js_1.getEffectivePermissions)(shared_db_1.db, user.id, orgId);
            if (effective.roles.length === 0) {
                return reply.status(403).send({ error: 'Access denied for the selected organization' });
            }
            rolesSet = effective.roles;
            permissionsSet = effective.permissions;
            validUntil = effective.validUntil;
        }
        const newSession = {
            ...currentSession,
            orgId,
            roles: rolesSet,
            permissions: permissionsSet,
            validUntil,
            exp: Math.floor(Date.now() / 1000) + (15 * 60)
        };
        const accessToken = (0, shared_auth_1.generateToken)(newSession);
        await fastify.redis.set(`session:${user.id}`, JSON.stringify(newSession), 'EX', 7 * 24 * 60 * 60);
        return { accessToken, orgId };
    });
    fastify.post('/refresh', async (request, reply) => {
        const { refreshToken } = request.body;
        if (!refreshToken) {
            return reply.status(400).send({ error: 'Refresh token is required' });
        }
        const [storedToken] = await shared_db_1.db
            .select()
            .from(shared_db_2.refreshTokens)
            .where((0, shared_db_1.eq)(shared_db_2.refreshTokens.token, refreshToken))
            .limit(1);
        if (!storedToken || storedToken.revokedAt || new Date() > storedToken.expiresAt) {
            return reply.status(401).send({ error: 'Invalid or expired refresh token' });
        }
        const [user] = await shared_db_1.db.select().from(shared_db_2.users).where((0, shared_db_1.eq)(shared_db_2.users.id, storedToken.userId)).limit(1);
        const lastSessionStr = await fastify.redis.get(`session:${user.id}`);
        const lastSession = lastSessionStr ? JSON.parse(lastSessionStr) : null;
        const sessionOrgId = lastSession?.orgId || '00000000-0000-0000-0000-000000000000';
        let rolesSet = [];
        let permissionsSet = [];
        let validUntil;
        if (user.isSuperAdmin) {
            rolesSet = ['super_admin'];
            permissionsSet = ['*'];
        }
        else {
            const effective = await (0, rbac_js_1.getEffectivePermissions)(shared_db_1.db, user.id, sessionOrgId);
            if (effective.roles.length === 0) {
                return reply.status(403).send({ error: 'Access denied for the current organization' });
            }
            rolesSet = effective.roles;
            permissionsSet = effective.permissions;
            validUntil = effective.validUntil;
        }
        const accessTokenSession = {
            userId: user.id,
            orgId: sessionOrgId,
            roles: rolesSet,
            permissions: permissionsSet,
            validUntil,
            exp: Math.floor(Date.now() / 1000) + (15 * 60)
        };
        const accessToken = (0, shared_auth_1.generateToken)(accessTokenSession);
        return { accessToken };
    });
    fastify.post('/logout', async (request, reply) => {
        const { refreshToken, userId } = request.body;
        if (refreshToken) {
            await shared_db_1.db
                .update(shared_db_2.refreshTokens)
                .set({ revokedAt: new Date() })
                .where((0, shared_db_1.eq)(shared_db_2.refreshTokens.token, refreshToken));
        }
        if (userId) {
            await fastify.redis.del(`session:${userId}`);
        }
        return { success: true };
    });
}
//# sourceMappingURL=auth.js.map
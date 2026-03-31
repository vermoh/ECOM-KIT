# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Root (pnpm workspace)
```bash
pnpm install        # Install all dependencies
pnpm dev            # Start all apps in parallel (via infra/scripts/dev.sh)
pnpm build          # Build all packages recursively
pnpm lint           # Lint all packages
```

### Per-app dev
```bash
# control-plane-api (NestJS/Fastify, port 4000)
cd apps/control-plane-api && npm run dev        # tsx watch
npm run build                                    # nest build
npm run test                                     # jest
npm run test -- --testPathPattern=auth          # single test file
npm run test:e2e                                 # e2e (jest-e2e.json config)

# control-plane-web (Next.js, port 3000)
cd apps/control-plane-web && npm run dev

# csv-service-api (Fastify, port 4001)
cd apps/csv-service-api && npm run dev          # tsx watch src/server.ts

# csv-service-worker (BullMQ)
cd apps/csv-service-worker && npm run dev       # tsx watch src/worker.ts
```

### Database (shared-db)
```bash
cd packages/shared-db
pnpm migrate    # Run migrations (tsx src/migrate.ts)
pnpm seed       # Seed initial data
pnpm generate   # Generate new migration (drizzle-kit generate:pg)
pnpm push       # Push schema without migration file
```

### Local infrastructure
```bash
docker-compose -f infra/docker/docker-compose.yml up -d
# Postgres: localhost:5432 (ecom_user / ecom_password / ecom_platform)
# Redis: localhost:6379
# MinIO: localhost:9000 (console: localhost:9001, minioadmin/minioadmin)
```

## Architecture

### Two-Plane Design

**Control Plane** (`control-plane-api` + `control-plane-web`):
- Manages auth, organizations, users, roles/permissions, provider API keys, audit logs
- Issues JWTs and AccessGrant tokens used by other services
- All tenant administration goes through here

**Service Plane** (`csv-service-api` + `csv-service-worker`):
- Domain business logic: CSV upload → schema generation → enrichment → export
- Async jobs via BullMQ (Redis queue); `csv-service-api` enqueues, `csv-service-worker` processes
- Communicates back to Control Plane using AccessGrant tokens to fetch encrypted provider configs

### Shared Packages
- `packages/shared-auth` — JWT sign/verify, bcrypt password hashing, crypto utilities
- `packages/shared-db` — Drizzle ORM schema (all tables), DB init, `withTenant()` helper
- `packages/shared-types` — TypeScript interfaces shared across services (`UserSession`, `AccessGrant`, `SchemaField`, etc.)

### Authentication & Authorization Flow

1. User logs in → Control Plane issues JWT (`userId`, `orgId`, `roles`, `permissions`, `exp`, `validUntil`) + refresh token (UUID stored in DB)
2. All API requests require `Authorization: Bearer <jwt>`
3. Auth middleware performs 5-level check: JWT verify → org status → temporal access (`validUntil`) → permission guard → resource ownership
4. **Multitenancy**: every table has `orgId`; `withTenant(db, orgId)` sets `SET app.current_org_id = ?` for row-level security
5. Service-to-service calls use AccessGrant tokens (hashed, scoped, expiring) — CSV Service uses these to call Control Plane

### CSV Processing State Machine

`upload_jobs.status` drives the entire workflow:
```
pending → parsing → parsed → schema_draft → schema_review → schema_confirmed
       → enriching → enriched → needs_collision_review → ready → exporting → done
                                                                           → failed / paused
```
Worker processes BullMQ jobs for each state transition. Human review tasks are created for `schema_review` and `collision_review` stages.

### Key Source Locations

| Concern | Path |
|---|---|
| Fastify server + route registration | `apps/control-plane-api/src/server.ts` |
| Permission guards + org status checks | `apps/control-plane-api/src/guards.ts` |
| Effective permissions (RBAC) | `apps/control-plane-api/src/rbac.ts` |
| CSV API server | `apps/csv-service-api/src/server.ts` |
| Background job processor | `apps/csv-service-worker/src/worker.ts` |
| Complete DB schema (46 tables) | `packages/shared-db/src/schema.ts` |
| DB init + `withTenant()` | `packages/shared-db/src/index.ts` |
| JWT utilities | `packages/shared-auth/src/jwt.ts` |
| Shared TypeScript types | `packages/shared-types/src/index.ts` |
| Auth context (frontend) | `apps/control-plane-web/src/context/AuthContext.tsx` |

### Tech Stack
- **Backend**: Node.js + TypeScript, Fastify 4 (primary), NestJS 10 (partial legacy in control-plane-api)
- **Frontend**: Next.js 16, React 19, Tailwind CSS 4, shadcn/ui, TanStack Query 5
- **Database**: PostgreSQL 16 + Drizzle ORM, Postgres.js driver
- **Queue**: BullMQ 5 + Redis 7
- **Storage**: MinIO (local) / AWS S3-compatible
- **Package manager**: pnpm workspaces

### RBAC Roles
Nine roles defined: `super_admin`, `org_owner`, `org_admin`, `operator`, `schema_reviewer`, `enrichment_reviewer`, `billing_admin`, `read_only`, `guest`. Role-permission mapping is stored in DB; effective permissions are computed in `rbac.ts`.

### Engineering Conventions
From `docs/09_engineering/code_conventions.md`:
- File names: kebab-case
- Classes: PascalCase
- Functions/variables: camelCase
- All API endpoints must propagate `x-correlation-id` header for audit tracing
- `orgId` must always come from the verified JWT, never from request body/params

### Docs
`docs/` contains comprehensive architecture documentation (C4 diagrams, bounded contexts, integration contracts, security policies, RBAC spec, AI prompt templates). Consult before making architectural decisions.

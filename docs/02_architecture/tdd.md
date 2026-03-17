# Technical Design Document — ECOM KIT SaaS Platform

> **Версия:** 1.0  
> **Дата:** 2026-03-17  
> **Автор:** Principal Software Architect  
> **Статус:** Draft

---

## 1. Context Diagram (C4 Level 1)

```
┌─────────────────────────────────────────────────────────────────────┐
│                        ECOM KIT Platform                            │
│                                                                     │
│  ┌──────────────────┐          ┌───────────────────────────────┐    │
│  │  Control Plane   │◄────────►│     Service Plane             │    │
│  │  (управление)    │          │  ┌─────────────────────────┐  │    │
│  └──────────────────┘          │  │  CSV Enrichment Service  │  │    │
│                                │  └─────────────────────────┘  │    │
│                                │  ┌──────────┐ ┌────────────┐  │    │
│                                │  │ Service N│ │ Service M  │  │    │
│                                │  └──────────┘ └────────────┘  │    │
│                                └───────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘

Внешние акторы:
  [Tenant Admin]  ──► Control Plane UI  (управление org, users, roles)
  [End User]      ──► Service UI         (работа с конкретным сервисом)
  [Super Admin]   ──► Super Admin UI     (управление платформой)
  [OpenRouter]    ◄── AI Gateway         (LLM вызовы через единый ключ)
  [Billing SaaS]  ◄── Control Plane      (Stripe / LemonSqueezy)
```

---

## 2. Container Diagram (C4 Level 2)

```
┌─────────────────────────── Control Plane ──────────────────────────┐
│                                                                     │
│  ┌─────────────────┐   ┌──────────────────┐   ┌─────────────────┐  │
│  │  CP API          │   │  CP Worker        │   │  CP DB          │  │
│  │  (REST/GraphQL)  │   │  (audit, email)   │   │  (Postgres)     │  │
│  └────────┬────────┘   └──────────────────┘   └─────────────────┘  │
│           │ JWT / mTLS                                               │
│  ┌────────▼────────┐   ┌──────────────────┐                        │
│  │  Auth Service    │   │  Secrets Vault    │                        │
│  │  (RBAC/ABAC)     │   │  (OpenRouter key) │                        │
│  └─────────────────┘   └──────────────────┘                        │
└─────────────────────────────────────────────────────────────────────┘

             ▲ Service Token (per-tenant, scoped)
             │
┌─────────── Service Plane — CSV Enrichment Service ────────────────┐
│                                                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐ │
│  │  CSV API      │  │  Job Worker   │  │  AI Gateway Proxy        │ │
│  │  (REST)       │  │  (async BG)   │  │  (calls OpenRouter)      │ │
│  └──────┬───────┘  └──────┬───────┘  └────────────┬─────────────┘ │
│         │                 │                        │               │
│  ┌──────▼─────────────────▼────────────────────────▼────────────┐ │
│  │          Service DB (Postgres) + Object Storage (S3)          │ │
│  └───────────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │             Job Queue (Redis / BullMQ)                         │ │
│  └────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────┘
```

---

## 3. Component Diagram (C4 Level 3) — CSV Enrichment Service

```
CSV API
  ├── UploadController       — принимает CSV, валидирует, создаёт Job
  ├── SchemaController       — CRUD шаблона характеристик
  ├── ReviewController       — Human-in-the-loop подтверждение
  ├── EnrichmentController   — статус задач, результаты
  ├── ExportController       — генерация итогового CSV
  └── SEOController          — запрос SEO описаний

Job Worker (async)
  ├── ParseCsvJob            — парсинг, нормализация, сохранение SKU
  ├── GenerateSchemaJob      — AI генерация шаблона характеристик
  ├── EnrichSkuJob           — AI заполнение характеристик по SKU
  ├── CollisionResolveJob    — обнаружение и разрешение коллизий
  ├── GenerateSeoJob         — AI генерация SEO описаний
  └── ExportCsvJob           — сборка и выгрузка итогового файла

AI Gateway Proxy
  ├── PromptBuilder          — сборка промптов из prompt_specs
  ├── RetryHandler           — экспоненциальный backoff
  ├── TokenBudgetGuard       — контроль расхода токенов на tenant
  └── OpenRouterClient       — HTTP клиент к OpenRouter API
```

---

## 4. Bounded Contexts

| Bounded Context         | Ответственность                                                  | Plane         |
|-------------------------|------------------------------------------------------------------|---------------|
| **Identity & Access**   | Org, User, Role, Permission, Session, MFA                        | Control Plane |
| **Tenant Management**   | Tenant CRUD, plan limits, access windows, service grants         | Control Plane |
| **Secrets**             | Хранение и выдача API ключей (OpenRouter, webhooks)              | Control Plane |
| **Audit**               | Иммутабельный лог действий всех акторов                          | Control Plane |
| **Billing**             | Subscription, usage metering, invoices (интеграция Stripe)       | Control Plane |
| **CSV Pipeline**        | Загрузка CSV, жизненный цикл Job, SKU enrichment                 | Service Plane |
| **Attribute Schema**    | Шаблоны характеристик, версионирование, human review             | Service Plane |
| **AI Orchestration**    | Промпты, вызовы LLM, токен-бюджет, результаты                    | Service Plane |
| **Export**              | Финальная сборка CSV, SEO тексты, скачивание                     | Service Plane |

---

## 5. High-Level Data Flow

### 5.1 Аутентификация и авторизация

```
User → [CP Auth] → JWT(tenant_id, user_id, roles, exp)
     → [CSV API] → validate JWT → check RBAC → proceed
```

### 5.2 Основной pipeline CSV Enrichment

```
1. UPLOAD
   User ──POST /csv/upload──► CSV API
   CSV API: сохраняет raw файл в S3, создаёт Job{status=PENDING}
   CSV API ──enqueue──► ParseCsvJob

2. PARSE (async)
   ParseCsvJob: читает S3, парсит строки, сохраняет SKU[] в DB
   Job{status=PARSED}

3. SCHEMA GENERATION (async)
   GenerateSchemaJob: берёт sample SKU → AI → AttributeSchema draft
   Job{status=SCHEMA_DRAFT}

4. HUMAN REVIEW
   User видит Schema draft → редактирует → POST /schema/confirm
   Job{status=SCHEMA_CONFIRMED}

5. ENRICHMENT (async, batch)
   EnrichSkuJob: для каждого SKU → AI → CharacteristicValues
   CollisionResolveJob: находит дубли/противоречия → флаги
   Job{status=ENRICHED | NEEDS_REVIEW}

6. SEO (async, optional)
   GenerateSeoJob: для каждого SKU → AI → SEO description
   Job{status=SEO_READY}

7. EXPORT
   User ──POST /export──► ExportCsvJob
   ExportCsvJob: собирает CSV, загружает в S3, генерирует signed URL
   User ──GET signed URL──► скачивает файл
```

### 5.3 AI Key Flow

```
CSV Service нуждается в ключе OpenRouter →
   запрашивает у CP Secrets Service short-lived token →
   AI Gateway Proxy использует token для вызова OpenRouter →
   ключ никогда не покидает серверный периметр
```

---

## 6. Основные сущности (Canonical Model)

### Control Plane

| Сущность        | Ключевые поля                                                         |
|-----------------|-----------------------------------------------------------------------|
| **Organization** | id, name, plan, status, created_at                                   |
| **User**         | id, org_id, email, password_hash, mfa_secret, status                 |
| **Role**         | id, org_id, name, permissions[]                                      |
| **UserRole**     | user_id, role_id, granted_at, expires_at                             |
| **ServiceGrant** | org_id, service_id, enabled, valid_from, valid_until                 |
| **AuditEvent**   | id, org_id, user_id, action, resource, payload, ip, created_at       |
| **OrgSecret**    | id, org_id, key_type (OPENROUTER), encrypted_value, rotated_at       |

### Service Plane — CSV Enrichment

| Сущность              | Ключевые поля                                                              |
|-----------------------|----------------------------------------------------------------------------|
| **CsvJob**            | id, org_id, user_id, status, s3_key_raw, s3_key_result, created_at        |
| **SKU**               | id, job_id, org_id, external_id, raw_data (jsonb)                         |
| **AttributeSchema**   | id, job_id, org_id, version, attributes[], confirmed_at, confirmed_by      |
| **CharacteristicValue** | id, sku_id, attribute_id, value, source (AI/manual), collision_flag     |
| **SeoDescription**    | id, sku_id, lang, title, description, generated_at                        |
| **AiCall**            | id, org_id, job_id, prompt_hash, model, tokens_in, tokens_out, latency_ms |

---

## 7. Architecture Trade-offs

| Решение | Выбор | Причина | Компромисс |
|---------|-------|---------|------------|
| **CP ↔ Service коммуникация** | REST + Service Token | Простота, stateless, легко debugгировать | Нет push-нотификаций; нужен polling или webhook |
| **Async processing** | Job Queue (Redis/BullMQ) | Долгие AI задачи не блокируют HTTP | Eventual consistency; сложнее тестировать |
| **Multi-tenancy DB** | Schema-per-tenant vs Row-level | Row-level isolation + RLS в Postgres | Проще ops; при > 10k tenants нужно шардирование |
| **AI Key** | CP Secrets, short-lived token | Ключ не попадает в Service DB | Дополнительный network hop; CP становится SPOF |
| **Monorepo vs Polyrepo** | Monorepo (Turborepo) | Единые типы, синхронные деплои | Сложнее per-service scaling; большой CI |
| **GraphQL vs REST** | REST (OpenAPI) для MVP | Быстрее итерации; проще кэшировать | Нет flexible querying без дополнительных эндпойнтов |
| **Human-in-the-loop** | Polling + Webhook | Совместимость с любым фронтом | Небольшая задержка в UX |

---

## 8. Предлагаемый Tech Stack

### Control Plane

| Слой | Технология | Обоснование |
|------|-----------|-------------|
| Runtime | Node.js 22 (TypeScript) | Унификация с Service Plane; зрелая экосистема |
| Framework | Fastify | Высокая производительность; встроенный OpenAPI |
| Auth | JWT (RS256) + PASETO v4 для service tokens | RS256 = asymmetric; PASETO = tamper-proof |
| DB | PostgreSQL 16 + Row-Level Security | ACID; RLS для tenant isolation нативно |
| ORM | Drizzle ORM | Type-safe; zero-overhead; миграции как код |
| Secrets | HashiCorp Vault (или AWS Secrets Manager) | Industry standard; audit trail; rotation |
| Cache | Redis 7 | Session store, rate limiting |
| Queue | BullMQ + Redis | Надёжные очереди; retry; dead-letter |

### Service Plane — CSV Enrichment

| Слой | Технология | Обоснование |
|------|-----------|-------------|
| Runtime | Node.js 22 (TypeScript) | Единый стек |
| Framework | Fastify | Консистентность с CP |
| CSV Parser | PapaParse / csv-parse | Производительный; streaming |
| Object Storage | S3-compatible (AWS S3 / MinIO) | Scalability; cheap; signed URLs |
| DB | PostgreSQL 16 (dedicated instance) | Изоляция данных от CP |
| AI Client | OpenRouter REST API через AI Gateway | Абстракция модели; fallback |
| Queue | BullMQ + Redis | Единый паттерн c CP |

### Infrastructure & Observability

| Компонент | Технология |
|-----------|-----------|
| Container | Docker + Docker Compose (dev), Kubernetes (prod) |
| CI/CD | GitHub Actions + Turborepo |
| Observability | OpenTelemetry → Grafana Stack (Loki, Tempo, Prometheus) |
| API Gateway | Nginx / Kong (rate limiting, mTLS termination) |
| IaC | Terraform |
| Secrets | Vault / AWS Secrets Manager |
| Billing | Stripe (Subscription + Usage-based) |

### Frontend

| Компонент | Технология |
|-----------|-----------|
| Framework | Next.js 15 (App Router) |
| UI Library | shadcn/ui + Tailwind |
| State | Zustand + React Query |
| Auth | NextAuth.js v5 |

---

## 9. Принципы изоляции (Tenant Isolation)

```
1. Каждый запрос несёт tenant_id в JWT → проверяется middleware
2. Postgres RLS: все таблицы имеют org_id + политики SET app.current_org_id
3. S3 prefix: s3://bucket/{org_id}/{job_id}/...
4. Job Queue: jobs тегируются org_id; workers фильтруют по нему
5. AI Gateway: токен-бюджет проверяется per-tenant перед каждым AI вызовом
6. Audit: каждое действие логируется с org_id, user_id, timestamp, IP
```

---

## 10. RBAC — Роли и права (Control Plane)

| Роль | Права |
|------|-------|
| **super_admin** | Все действия на платформе |
| **org_owner** | Управление org, users, roles, billing, secrets |
| **org_admin** | Управление users, roles; нет billing/secrets |
| **service_manager** | Управление job'ами в сервисах; нет user management |
| **analyst** | Только чтение результатов, экспорт |
| **viewer** | Только просмотр |

Права задаются через Permission Matrix (resource:action), хранятся в БД, проверяются через ABAC при наличии контекстных условий (valid_until, IP whitelist и т.д.).

---

## 11. Key Architecture Rules (non-negotiable)

1. **Control Plane ≠ Service Plane** — разные DB, разные деплои, общение только через API
2. **Secrets никогда не попадают на клиент и не логируются**
3. **Все долгие операции — async (Job Queue), никакого sync LLM в HTTP request**
4. **Каждое критическое действие — в audit log**
5. **tenant_id проверяется на каждом слое: API, DB (RLS), Storage (prefix)**
6. **Permission check только на backend, никогда на frontend**
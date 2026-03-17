# PostgreSQL Schema Blueprint — ECOM KIT Platform

> **Версия:** 1.0  
> **Дата:** 2026-03-17  
> **DB Engine:** PostgreSQL 16  
> **Без SQL — только структурное описание**

---

## Соглашения

| Соглашение | Значение |
|-----------|---------|
| Все PK | `UUID` (gen_random_uuid()) |
| Временные метки | `TIMESTAMPTZ` (UTC) |
| Soft delete | `deleted_at TIMESTAMPTZ NULL` (NULL = живая запись) |
| Audit fields | `created_at`, `updated_at` на всех таблицах |
| Tenant scope | `org_id UUID NOT NULL` на каждой таблице Service Plane |
| Статусы | `TEXT` с CHECK constraints (не ENUM — легче миграции) |
| Секреты | никогда не хранятся в открытом виде |

---

## CONTROL PLANE DATABASE

> Отдельный PostgreSQL instance / schema `cp`

---

### `organizations`

**Назначение:** Корневой tenant.

| Колонка | Тип | Nullable | Default | Описание |
|---------|-----|----------|---------|----------|
| `id` | UUID | NO | gen_random_uuid() | PK |
| `slug` | TEXT | NO | — | URL-safe unique identifier |
| `name` | TEXT | NO | — | Display name |
| `plan` | TEXT | NO | `'free'` | free / starter / pro / enterprise |
| `status` | TEXT | NO | `'active'` | active / suspended / deleted |
| `max_users` | INTEGER | NO | 5 | По плану |
| `max_projects` | INTEGER | NO | 3 | По плану |
| `metadata` | JSONB | YES | `'{}'` | Расширяемые атрибуты |
| `created_at` | TIMESTAMPTZ | NO | now() | — |
| `updated_at` | TIMESTAMPTZ | NO | now() | — |
| `deleted_at` | TIMESTAMPTZ | YES | NULL | Soft delete |

**Индексы:**
- `PK` → `id`
- `UNIQUE` → `slug` (WHERE deleted_at IS NULL)
- `IDX` → `status`
- `IDX` → `plan`

**Unique constraints:**
- `(slug)` WHERE `deleted_at IS NULL`

**Check constraints:**
- `plan IN ('free', 'starter', 'pro', 'enterprise')`
- `status IN ('active', 'suspended', 'deleted')`

---

### `users`

**Назначение:** Глобальный пользователь платформы.

| Колонка | Тип | Nullable | Default | Описание |
|---------|-----|----------|---------|----------|
| `id` | UUID | NO | gen_random_uuid() | PK |
| `email` | TEXT | NO | — | Уникальный глобально |
| `password_hash` | TEXT | NO | — | argon2id хэш |
| `mfa_secret_enc` | BYTEA | YES | NULL | AES-256-GCM зашифрован |
| `mfa_enabled` | BOOLEAN | NO | false | — |
| `status` | TEXT | NO | `'pending'` | pending / active / locked / deleted |
| `last_login_at` | TIMESTAMPTZ | YES | NULL | — |
| `created_at` | TIMESTAMPTZ | NO | now() | — |
| `updated_at` | TIMESTAMPTZ | NO | now() | — |
| `deleted_at` | TIMESTAMPTZ | YES | NULL | Soft delete |

**Индексы:**
- `PK` → `id`
- `UNIQUE` → `email` (WHERE deleted_at IS NULL)
- `IDX` → `status`

**Check constraints:**
- `status IN ('pending', 'active', 'locked', 'deleted')`
- `email ~* '^[^@]+@[^@]+\.[^@]+$'`

> `password_hash`, `mfa_secret_enc` исключаются из всех API ответов на уровне приложения.

---

### `memberships`

**Назначение:** Связь User ↔ Organization с ролью и временными ограничениями.

| Колонка | Тип | Nullable | Default | Описание |
|---------|-----|----------|---------|----------|
| `id` | UUID | NO | gen_random_uuid() | PK |
| `org_id` | UUID | NO | — | FK → organizations |
| `user_id` | UUID | NO | — | FK → users |
| `role_id` | UUID | NO | — | FK → roles |
| `status` | TEXT | NO | `'invited'` | invited / active / suspended / removed |
| `invited_by` | UUID | YES | NULL | FK → users |
| `valid_from` | TIMESTAMPTZ | NO | now() | — |
| `valid_until` | TIMESTAMPTZ | YES | NULL | NULL = бессрочно |
| `created_at` | TIMESTAMPTZ | NO | now() | — |
| `updated_at` | TIMESTAMPTZ | NO | now() | — |

**Foreign Keys:**
- `org_id` → `organizations(id)` ON DELETE RESTRICT
- `user_id` → `users(id)` ON DELETE RESTRICT
- `role_id` → `roles(id)` ON DELETE RESTRICT
- `invited_by` → `users(id)` ON DELETE SET NULL

**Индексы:**
- `PK` → `id`
- `UNIQUE` → `(org_id, user_id)` WHERE `status != 'removed'`
- `IDX` → `user_id`
- `IDX` → `(org_id, status)`
- `IDX` → `valid_until` (WHERE `valid_until IS NOT NULL`)

**Check constraints:**
- `status IN ('invited', 'active', 'suspended', 'removed')`

---

### `roles`

**Назначение:** Именованный набор прав внутри org или системная роль.

| Колонка | Тип | Nullable | Default | Описание |
|---------|-----|----------|---------|----------|
| `id` | UUID | NO | gen_random_uuid() | PK |
| `org_id` | UUID | YES | NULL | NULL = системная роль |
| `name` | TEXT | NO | — | org_owner / org_admin / analyst / viewer |
| `description` | TEXT | YES | NULL | — |
| `is_system` | BOOLEAN | NO | false | Системная — не редактируется |
| `created_at` | TIMESTAMPTZ | NO | now() | — |
| `updated_at` | TIMESTAMPTZ | NO | now() | — |

**Foreign Keys:**
- `org_id` → `organizations(id)` ON DELETE CASCADE

**Индексы:**
- `PK` → `id`
- `UNIQUE` → `(org_id, name)` (nullable-safe: WHERE org_id IS NOT NULL)
- `UNIQUE` → `(name)` WHERE `org_id IS NULL AND is_system = true`
- `IDX` → `org_id`

---

### `permissions`

**Назначение:** Атомарные права. Read-only, управляются через деплой.

| Колонка | Тип | Nullable | Default | Описание |
|---------|-----|----------|---------|----------|
| `id` | UUID | NO | gen_random_uuid() | PK |
| `resource` | TEXT | NO | — | project / job / schema / export / user |
| `action` | TEXT | NO | — | create / read / update / delete / approve / export |
| `description` | TEXT | YES | NULL | — |

**Индексы:**
- `PK` → `id`
- `UNIQUE` → `(resource, action)`

---

### `role_permissions` *(junction)*

| Колонка | Тип | Nullable | Описание |
|---------|-----|----------|----------|
| `role_id` | UUID | NO | FK → roles |
| `permission_id` | UUID | NO | FK → permissions |

**FK:** `role_id` → `roles(id)` CASCADE, `permission_id` → `permissions(id)` CASCADE  
**PK / UNIQUE:** `(role_id, permission_id)`

---

### `service_registry`

**Назначение:** Реестр моносервисов Service Plane.

| Колонка | Тип | Nullable | Default | Описание |
|---------|-----|----------|---------|----------|
| `id` | UUID | NO | gen_random_uuid() | PK |
| `slug` | TEXT | NO | — | csv-enrichment / seo-gen |
| `name` | TEXT | NO | — | Display name |
| `base_url` | TEXT | NO | — | Internal URL (не в API ответах) |
| `version` | TEXT | NO | — | SemVer |
| `status` | TEXT | NO | `'active'` | active / maintenance / deprecated |
| `created_at` | TIMESTAMPTZ | NO | now() | — |
| `updated_at` | TIMESTAMPTZ | NO | now() | — |

**Индексы:**
- `PK` → `id`
- `UNIQUE` → `slug`
- `IDX` → `status`

> `base_url` исключается из всех API ответов.

---

### `service_access`

**Назначение:** Контроль доступа org к сервису.

| Колонка | Тип | Nullable | Default | Описание |
|---------|-----|----------|---------|----------|
| `id` | UUID | NO | gen_random_uuid() | PK |
| `org_id` | UUID | NO | — | FK → organizations |
| `service_id` | UUID | NO | — | FK → service_registry |
| `enabled` | BOOLEAN | NO | true | — |
| `valid_from` | TIMESTAMPTZ | NO | now() | — |
| `valid_until` | TIMESTAMPTZ | YES | NULL | — |
| `granted_by` | UUID | NO | — | FK → users (super_admin) |
| `created_at` | TIMESTAMPTZ | NO | now() | — |
| `updated_at` | TIMESTAMPTZ | NO | now() | — |

**Foreign Keys:**
- `org_id` → `organizations(id)` ON DELETE CASCADE
- `service_id` → `service_registry(id)` ON DELETE RESTRICT
- `granted_by` → `users(id)` ON DELETE RESTRICT

**Индексы:**
- `PK` → `id`
- `UNIQUE` → `(org_id, service_id)`
- `IDX` → `(org_id, enabled)`
- `IDX` → `valid_until` (WHERE `valid_until IS NOT NULL`)

---

### `provider_configs`

**Назначение:** Зашифрованные конфиги провайдеров (OpenRouter key и др.).

| Колонка | Тип | Nullable | Default | Описание |
|---------|-----|----------|---------|----------|
| `id` | UUID | NO | gen_random_uuid() | PK |
| `org_id` | UUID | NO | — | FK → organizations |
| `provider` | TEXT | NO | — | openrouter / stripe / webhook |
| `encrypted_value` | BYTEA | NO | — | AES-256-GCM |
| `key_hint` | TEXT | NO | — | Последние 4 символа (UI) |
| `rotated_at` | TIMESTAMPTZ | YES | NULL | — |
| `created_by` | UUID | NO | — | FK → users |
| `created_at` | TIMESTAMPTZ | NO | now() | — |
| `updated_at` | TIMESTAMPTZ | NO | now() | — |

**Foreign Keys:**
- `org_id` → `organizations(id)` ON DELETE CASCADE
- `created_by` → `users(id)` ON DELETE RESTRICT

**Индексы:**
- `PK` → `id`
- `UNIQUE` → `(org_id, provider)`
- `IDX` → `org_id`

> `encrypted_value` никогда не сериализуется в ответах и не попадает в `audit_logs.payload`.

---

### `audit_logs`

**Назначение:** Иммутабельный append-only лог всех значимых действий.

| Колонка | Тип | Nullable | Default | Описание |
|---------|-----|----------|---------|----------|
| `id` | UUID | NO | gen_random_uuid() | PK |
| `org_id` | UUID | YES | NULL | Tenant (NULL для super_admin действий) |
| `actor_id` | UUID | YES | NULL | FK → users |
| `actor_type` | TEXT | NO | — | user / service / system |
| `action` | TEXT | NO | — | user.login / job.created / schema.approved |
| `resource_type` | TEXT | YES | NULL | Тип ресурса |
| `resource_id` | UUID | YES | NULL | ID ресурса |
| `payload` | JSONB | NO | `'{}'` | Контекст без secrets |
| `ip_address` | INET | YES | NULL | — |
| `user_agent` | TEXT | YES | NULL | — |
| `created_at` | TIMESTAMPTZ | NO | now() | **Иммутабельно** |

> Нет `updated_at`. Нет `deleted_at`. **INSERT ONLY** (revoke UPDATE/DELETE на уровне роли).

**Индексы:**
- `PK` → `id`
- `IDX` → `(org_id, created_at DESC)` — основной запрос аудита
- `IDX` → `actor_id`
- `IDX` → `(resource_type, resource_id)`
- `IDX` → `action`
- **BRIN** → `created_at` (эффективно для append-only time-series)

**Check constraints:**
- `actor_type IN ('user', 'service', 'system')`

---

## CSV SERVICE DATABASE

> Отдельный PostgreSQL instance / schema `csv_svc`  
> **Все таблицы имеют `org_id UUID NOT NULL` — строгий tenant scope**

---

### `projects`

| Колонка | Тип | Nullable | Default | Описание |
|---------|-----|----------|---------|----------|
| `id` | UUID | NO | gen_random_uuid() | PK |
| `org_id` | UUID | NO | — | Tenant scope |
| `created_by` | UUID | NO | — | User ID (из CP JWT) |
| `name` | TEXT | NO | — | — |
| `description` | TEXT | YES | NULL | — |
| `status` | TEXT | NO | `'active'` | active / archived |
| `created_at` | TIMESTAMPTZ | NO | now() | — |
| `updated_at` | TIMESTAMPTZ | NO | now() | — |
| `archived_at` | TIMESTAMPTZ | YES | NULL | — |

**Индексы:**
- `PK` → `id`
- `IDX` → `(org_id, status)`
- `IDX` → `(org_id, created_at DESC)`

**RLS Policy:** `org_id = current_setting('app.current_org_id')::UUID`

---

### `uploads`

**Назначение:** Центральный агрегат пайплайна (UploadJob).

| Колонка | Тип | Nullable | Default | Описание |
|---------|-----|----------|---------|----------|
| `id` | UUID | NO | gen_random_uuid() | PK |
| `org_id` | UUID | NO | — | Tenant scope |
| `project_id` | UUID | NO | — | FK → projects |
| `created_by` | UUID | NO | — | User ID |
| `original_filename` | TEXT | NO | — | — |
| `s3_key_raw` | TEXT | NO | — | Prefix: `{org_id}/{id}/raw/` |
| `s3_key_result` | TEXT | YES | NULL | Prefix: `{org_id}/{id}/result/` |
| `row_count` | INTEGER | YES | NULL | После парсинга |
| `file_size_bytes` | BIGINT | YES | NULL | — |
| `status` | TEXT | NO | `'pending'` | см. State Machine |
| `error_message` | TEXT | YES | NULL | Last error |
| `created_at` | TIMESTAMPTZ | NO | now() | — |
| `updated_at` | TIMESTAMPTZ | NO | now() | — |
| `completed_at` | TIMESTAMPTZ | YES | NULL | — |

**Foreign Keys:**
- `project_id` → `projects(id)` ON DELETE RESTRICT

**Индексы:**
- `PK` → `id`
- `IDX` → `(org_id, status)`
- `IDX` → `(org_id, project_id)`
- `IDX` → `(org_id, created_at DESC)`

**Check constraints:**
- `status IN ('pending','parsing','parsed','schema_draft','schema_review','schema_confirmed','enriching','enriched','needs_collision_review','ready','exporting','done','failed')`

**RLS Policy:** `org_id = current_setting('app.current_org_id')::UUID`

---

### `schema_templates`

| Колонка | Тип | Nullable | Default | Описание |
|---------|-----|----------|---------|----------|
| `id` | UUID | NO | gen_random_uuid() | PK |
| `org_id` | UUID | NO | — | Tenant scope |
| `upload_id` | UUID | NO | — | FK → uploads |
| `version` | INTEGER | NO | 1 | Инкрементируется при правках |
| `status` | TEXT | NO | `'draft'` | draft / in_review / confirmed / rejected |
| `confirmed_by` | UUID | YES | NULL | User ID |
| `confirmed_at` | TIMESTAMPTZ | YES | NULL | — |
| `ai_model` | TEXT | YES | NULL | Модель генерации |
| `created_at` | TIMESTAMPTZ | NO | now() | — |
| `updated_at` | TIMESTAMPTZ | NO | now() | — |

**Foreign Keys:**
- `upload_id` → `uploads(id)` ON DELETE CASCADE

**Индексы:**
- `PK` → `id`
- `UNIQUE` → `(upload_id, version)`
- `IDX` → `(org_id, upload_id, status)`

**Check constraints:**
- `status IN ('draft', 'in_review', 'confirmed', 'rejected')`

**RLS Policy:** `org_id = current_setting('app.current_org_id')::UUID`

---

### `schema_fields`

| Колонка | Тип | Nullable | Default | Описание |
|---------|-----|----------|---------|----------|
| `id` | UUID | NO | gen_random_uuid() | PK |
| `org_id` | UUID | NO | — | Tenant scope |
| `schema_id` | UUID | NO | — | FK → schema_templates |
| `name` | TEXT | NO | — | snake_case ключ |
| `label` | TEXT | NO | — | Display label |
| `field_type` | TEXT | NO | — | text / number / boolean / enum / url |
| `is_required` | BOOLEAN | NO | false | — |
| `allowed_values` | TEXT[] | YES | NULL | Для enum |
| `description` | TEXT | YES | NULL | Подсказка для AI |
| `sort_order` | INTEGER | NO | 0 | — |

**Foreign Keys:**
- `schema_id` → `schema_templates(id)` ON DELETE CASCADE

**Индексы:**
- `PK` → `id`
- `UNIQUE` → `(schema_id, name)`
- `IDX` → `(org_id, schema_id)`

**Check constraints:**
- `field_type IN ('text', 'number', 'boolean', 'enum', 'url')`

---

### `enrichment_runs`

| Колонка | Тип | Nullable | Default | Описание |
|---------|-----|----------|---------|----------|
| `id` | UUID | NO | gen_random_uuid() | PK |
| `org_id` | UUID | NO | — | Tenant scope |
| `upload_id` | UUID | NO | — | FK → uploads |
| `schema_id` | UUID | NO | — | FK → schema_templates |
| `status` | TEXT | NO | `'queued'` | queued / running / completed / failed |
| `total_items` | INTEGER | YES | NULL | — |
| `processed_items` | INTEGER | NO | 0 | — |
| `failed_items` | INTEGER | NO | 0 | — |
| `tokens_used` | INTEGER | NO | 0 | Итого токенов |
| `started_at` | TIMESTAMPTZ | YES | NULL | — |
| `completed_at` | TIMESTAMPTZ | YES | NULL | — |
| `created_at` | TIMESTAMPTZ | NO | now() | — |

**Foreign Keys:**
- `upload_id` → `uploads(id)` ON DELETE CASCADE
- `schema_id` → `schema_templates(id)` ON DELETE RESTRICT

**Индексы:**
- `PK` → `id`
- `IDX` → `(org_id, upload_id, status)`
- `UNIQUE` → `(upload_id)` WHERE `status = 'running'` *(partial unique — один running на job)*

---

### `enriched_items`

| Колонка | Тип | Nullable | Default | Описание |
|---------|-----|----------|---------|----------|
| `id` | UUID | NO | gen_random_uuid() | PK |
| `org_id` | UUID | NO | — | Tenant scope |
| `run_id` | UUID | NO | — | FK → enrichment_runs |
| `upload_id` | UUID | NO | — | FK → uploads (денормализация для фильтрации) |
| `sku_external_id` | TEXT | NO | — | ID из исходного CSV |
| `raw_data` | JSONB | NO | `'{}'` | Исходные данные |
| `enriched_data` | JSONB | NO | `'{}'` | `{field_name: value}` |
| `confidence` | NUMERIC(4,3) | YES | NULL | 0.000–1.000 |
| `status` | TEXT | NO | `'ok'` | ok / collision / manual_override |
| `reviewed_by` | UUID | YES | NULL | User ID |
| `reviewed_at` | TIMESTAMPTZ | YES | NULL | — |
| `created_at` | TIMESTAMPTZ | NO | now() | — |
| `updated_at` | TIMESTAMPTZ | NO | now() | — |

**Foreign Keys:**
- `run_id` → `enrichment_runs(id)` ON DELETE CASCADE
- `upload_id` → `uploads(id)` ON DELETE CASCADE

**Индексы:**
- `PK` → `id`
- `IDX` → `(org_id, run_id)`
- `IDX` → `(org_id, upload_id, status)`
- `IDX` → `(upload_id, sku_external_id)`
- `GIN` → `enriched_data` (опционально для JSONB поиска)

---

### `collisions`

| Колонка | Тип | Nullable | Default | Описание |
|---------|-----|----------|---------|----------|
| `id` | UUID | NO | gen_random_uuid() | PK |
| `org_id` | UUID | NO | — | Tenant scope |
| `run_id` | UUID | NO | — | FK → enrichment_runs |
| `item_id` | UUID | NO | — | FK → enriched_items |
| `field_name` | TEXT | NO | — | Атрибут с коллизией |
| `collision_type` | TEXT | NO | — | value_conflict / duplicate_sku / out_of_range / missing_required |
| `value_a` | TEXT | YES | NULL | — |
| `value_b` | TEXT | YES | NULL | — |
| `resolved_value` | TEXT | YES | NULL | Принятое значение |
| `status` | TEXT | NO | `'open'` | open / resolved / ignored |
| `resolved_by` | UUID | YES | NULL | User ID |
| `resolved_at` | TIMESTAMPTZ | YES | NULL | — |
| `created_at` | TIMESTAMPTZ | NO | now() | — |

**Foreign Keys:**
- `run_id` → `enrichment_runs(id)` ON DELETE CASCADE
- `item_id` → `enriched_items(id)` ON DELETE CASCADE

**Индексы:**
- `PK` → `id`
- `IDX` → `(org_id, run_id, status)`
- `IDX` → `(item_id, status)`
- `IDX` → `(org_id, status)` WHERE `status = 'open'` *(для блокировки экспорта)*

**Check constraints:**
- `collision_type IN ('value_conflict', 'duplicate_sku', 'out_of_range', 'missing_required')`
- `status IN ('open', 'resolved', 'ignored')`

---

### `review_tasks`

| Колонка | Тип | Nullable | Default | Описание |
|---------|-----|----------|---------|----------|
| `id` | UUID | NO | gen_random_uuid() | PK |
| `org_id` | UUID | NO | — | Tenant scope |
| `upload_id` | UUID | NO | — | FK → uploads |
| `task_type` | TEXT | NO | — | schema_review / collision_review / seo_review |
| `status` | TEXT | NO | `'pending'` | pending / in_progress / completed / skipped |
| `assigned_to` | UUID | YES | NULL | User ID |
| `completed_by` | UUID | YES | NULL | User ID |
| `due_at` | TIMESTAMPTZ | YES | NULL | — |
| `completed_at` | TIMESTAMPTZ | YES | NULL | — |
| `created_at` | TIMESTAMPTZ | NO | now() | — |
| `updated_at` | TIMESTAMPTZ | NO | now() | — |

**Foreign Keys:**
- `upload_id` → `uploads(id)` ON DELETE CASCADE

**Индексы:**
- `PK` → `id`
- `UNIQUE` → `(upload_id, task_type)` WHERE `status IN ('pending', 'in_progress')` *(один активный task на тип)*
- `IDX` → `(org_id, status)`
- `IDX` → `(assigned_to, status)`

**Check constraints:**
- `task_type IN ('schema_review', 'collision_review', 'seo_review')`
- `status IN ('pending', 'in_progress', 'completed', 'skipped')`

---

### `export_jobs`

| Колонка | Тип | Nullable | Default | Описание |
|---------|-----|----------|---------|----------|
| `id` | UUID | NO | gen_random_uuid() | PK |
| `org_id` | UUID | NO | — | Tenant scope |
| `upload_id` | UUID | NO | — | FK → uploads |
| `requested_by` | UUID | NO | — | User ID |
| `status` | TEXT | NO | `'queued'` | queued / generating / ready / expired / failed |
| `s3_key` | TEXT | YES | NULL | Путь к файлу |
| `signed_url` | TEXT | YES | NULL | Pre-signed (TTL 1h) |
| `url_expires_at` | TIMESTAMPTZ | YES | NULL | — |
| `include_seo` | BOOLEAN | NO | false | — |
| `error_message` | TEXT | YES | NULL | — |
| `created_at` | TIMESTAMPTZ | NO | now() | — |
| `completed_at` | TIMESTAMPTZ | YES | NULL | — |

**Foreign Keys:**
- `upload_id` → `uploads(id)` ON DELETE RESTRICT

**Индексы:**
- `PK` → `id`
- `IDX` → `(org_id, upload_id, status)`
- `IDX` → `url_expires_at` WHERE `status = 'ready'` *(для cleanup job)*

**Check constraints:**
- `status IN ('queued', 'generating', 'ready', 'expired', 'failed')`

---

### `seo_tasks`

| Колонка | Тип | Nullable | Default | Описание |
|---------|-----|----------|---------|----------|
| `id` | UUID | NO | gen_random_uuid() | PK |
| `org_id` | UUID | NO | — | Tenant scope |
| `upload_id` | UUID | NO | — | FK → uploads |
| `run_id` | UUID | NO | — | FK → enrichment_runs |
| `status` | TEXT | NO | `'queued'` | queued / running / completed / failed |
| `lang` | TEXT | NO | `'ru'` | ISO 639-1 lang code |
| `total_items` | INTEGER | YES | NULL | — |
| `processed_items` | INTEGER | NO | 0 | — |
| `tokens_used` | INTEGER | NO | 0 | — |
| `started_at` | TIMESTAMPTZ | YES | NULL | — |
| `completed_at` | TIMESTAMPTZ | YES | NULL | — |
| `created_at` | TIMESTAMPTZ | NO | now() | — |

**Foreign Keys:**
- `upload_id` → `uploads(id)` ON DELETE CASCADE
- `run_id` → `enrichment_runs(id)` ON DELETE RESTRICT

**Индексы:**
- `PK` → `id`
- `IDX` → `(org_id, upload_id, status)`
- `UNIQUE` → `(upload_id, lang)` WHERE `status = 'running'`

---

## Tenant Isolation Strategy

### 1. Row-Level Security (Postgres RLS)

```
Все таблицы CSV Service имеют RLS политику:

ENABLE ROW LEVEL SECURITY;

Policy: USING (org_id = current_setting('app.current_org_id')::UUID)

Устанавливается в middleware приложения до любого запроса:
  SET app.current_org_id = '<org_id из JWT>';
```

### 2. Application Layer

| Слой | Механизм |
|------|---------|
| JWT | `org_id` в claims, проверяется на каждом эндпойнте |
| Middleware | Устанавливает `app.current_org_id` для Postgres сессии |
| ORM | Все запросы автоматически проходят через RLS |
| Explicit filter | Дополнительно: `.where({ org_id })` в критичных местах |

### 3. Object Storage (S3)

```
Структура путей:
  s3://{bucket}/{org_id}/{upload_id}/raw/{filename}
  s3://{bucket}/{org_id}/{upload_id}/result/{filename}

IAM Policy: доступ только к s3://{bucket}/{org_id}/*
Pre-signed URLs: генерируются с TTL 1 час, per-org
```

### 4. Queue Isolation

```
Job payload: всегда содержит org_id
Worker: проверяет org_id из payload перед обработкой
Очереди: можно шардировать по org_id при росте нагрузки
```

### 5. Control Plane Isolation

```
CP Database отдельна от Service Databases
Service → CP общение только через AccessGrant (TTL 15 мин)
CP secrets не передаются в Service Plane напрямую
```

---

## Future Partitioning Strategy

### `audit_logs` — Range Partitioning по `created_at`

```
Причина: Append-only таблица с высокой частотой записи, запросы — всегда по диапазону дат.
Стратегия: RANGE на TIMESTAMPTZ created_at, партиции по месяцам.
Ретенция: партиции старше 2 лет → архивируются в cold storage (S3).
```

### `enriched_items` — Hash Partitioning по `org_id`

```
Причина: При > 1000 tenants таблица растёт пропорционально.
Стратегия: HASH(org_id), 16–32 партиции.
Преимущество: запросы с WHERE org_id = ? попадают в одну партицию.
```

### `collisions` — Range + Hash (Composite)

```
Причина: Запросы всегда по (org_id, run_id) + часто фильтр по created_at.
Стратегия: RANGE по created_at (год) → HASH по org_id внутри.
```

### `schema_fields` + `schema_templates`

```
Причина: Небольшой объём — партиционирование не нужно до 10M+ записей.
Стратегия: Откладывается до необходимости.
```

### Общие принципы

| Принцип | Детали |
|---------|--------|
| Partition key | Всегда включает `org_id` (для tenant-scoped запросов) |
| Index strategy | Локальные индексы на каждой партиции |
| Cleanup | Scheduled job удаляет/архивирует старые партиции |
| Шард-ключ | При горизонтальном шардировании — `org_id` |
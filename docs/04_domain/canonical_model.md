# Canonical Domain Model — ECOM KIT Platform

> **Версия:** 1.0  
> **Дата:** 2026-03-17  
> **Статус:** Draft

---

## CONTROL PLANE

---

### Organization

**Назначение:** Корневой агрегат мультитенантности. Каждый tenant — это одна Organization.

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | UUID | PK |
| `slug` | string | Уникальный идентификатор (URL-safe) |
| `name` | string | Отображаемое название |
| `plan` | enum | `free \| starter \| pro \| enterprise` |
| `status` | enum | `active \| suspended \| deleted` |
| `max_users` | int | Лимит пользователей по плану |
| `max_projects` | int | Лимит проектов |
| `created_at` | timestamp | — |
| `deleted_at` | timestamp? | Soft delete |

**Связи:**  
- 1:N → `User` (через `Membership`)  
- 1:N → `Role`  
- 1:N → `ServiceAccess`  
- 1:N → `ProviderConfig`  
- 1:N → `AuditLog`  

**Ограничения:**  
- `slug` — уникален глобально  
- При `status=suspended` все сервисные запросы отклоняются  
- Удаление — только soft delete  

**Tenant scope:** Сам является tenant root  
**Lifecycle:** `active → suspended → active` | `active → deleted`

---

### User

**Назначение:** Физический или сервисный пользователь, связанный с одной или несколькими Organization.

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | UUID | PK |
| `email` | string | Уникален глобально |
| `password_hash` | string | bcrypt / argon2 |
| `mfa_secret` | string? | TOTP secret (зашифрован) |
| `mfa_enabled` | bool | — |
| `status` | enum | `active \| locked \| pending \| deleted` |
| `last_login_at` | timestamp? | — |
| `created_at` | timestamp | — |
| `deleted_at` | timestamp? | Soft delete |

**Связи:**  
- 1:N → `Membership`  
- 1:N → `AuditLog` (actor)  

**Ограничения:**  
- `email` уникален глобально  
- Пользователь может состоять в нескольких org  
- MFA обязательна для `org_owner` и `super_admin`  
- Пароль не логируется, не сериализуется в ответах  

**Tenant scope:** Глобальный (связь с tenant через Membership)  
**Lifecycle:** `pending → active → locked → active` | `active → deleted`

---

### Membership

**Назначение:** Связь User ↔ Organization с ролью и ограничениями доступа.

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | UUID | PK |
| `org_id` | UUID | FK → Organization |
| `user_id` | UUID | FK → User |
| `role_id` | UUID | FK → Role |
| `status` | enum | `active \| invited \| suspended \| removed` |
| `invited_by` | UUID? | FK → User |
| `valid_from` | timestamp | Начало доступа |
| `valid_until` | timestamp? | Окончание доступа (null = бессрочно) |
| `created_at` | timestamp | — |

**Связи:**  
- N:1 → `Organization`  
- N:1 → `User`  
- N:1 → `Role`  

**Ограничения:**  
- Уникально: `(org_id, user_id)`  
- `valid_until` проверяется при каждом запросе  
- При `status=suspended` — доступ к сервисам закрыт  

**Tenant scope:** `org_id`  
**Lifecycle:** `invited → active → suspended → active` | `active → removed`

---

### Role

**Назначение:** Именованный набор прав внутри Organization.

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | UUID | PK |
| `org_id` | UUID? | FK → Organization (null = системная роль) |
| `name` | string | `org_owner \| org_admin \| analyst \| viewer \| ...` |
| `description` | string | — |
| `is_system` | bool | Системная (не редактируется) |
| `created_at` | timestamp | — |

**Связи:**  
- N:1 → `Organization`  
- 1:N → `Permission` (через join table `RolePermission`)  
- 1:N → `Membership`  

**Ограничения:**  
- Системные роли не удаляются и не редактируются  
- Кастомные роли ограничены своей org  

**Tenant scope:** `org_id` (null для системных)  
**Lifecycle:** `active` (системные) | `active → deleted` (кастомные)

---

### Permission

**Назначение:** Атомарное право на действие над ресурсом.

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | UUID | PK |
| `resource` | string | `project \| job \| schema \| export \| user \| ...` |
| `action` | string | `create \| read \| update \| delete \| approve \| export` |
| `description` | string | — |

**Связи:**  
- N:M → `Role` (через `RolePermission`)  

**Ограничения:**  
- Read-only, управляется только через деплой  
- Формат: `resource:action`  

**Tenant scope:** Глобальный (применяется в контексте Membership)

---

### Service

**Назначение:** Описание моносервиса Service Plane, зарегистрированного на платформе.

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | UUID | PK |
| `slug` | string | `csv-enrichment \| seo-gen \| ...` |
| `name` | string | — |
| `base_url` | string | Internal endpoint |
| `version` | string | SemVer |
| `status` | enum | `active \| maintenance \| deprecated` |
| `created_at` | timestamp | — |

**Связи:**  
- 1:N → `ServiceAccess`  

**Ограничения:**  
- `slug` уникален глобально  
- `base_url` не передаётся на клиент  

**Tenant scope:** Глобальный (платформенная сущность)

---

### ServiceAccess

**Назначение:** Контроль доступа конкретной Organization к конкретному Service.

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | UUID | PK |
| `org_id` | UUID | FK → Organization |
| `service_id` | UUID | FK → Service |
| `enabled` | bool | Доступ включён |
| `valid_from` | timestamp | — |
| `valid_until` | timestamp? | Окончание доступа |
| `granted_by` | UUID | FK → User (super_admin) |
| `created_at` | timestamp | — |

**Связи:**  
- N:1 → `Organization`  
- N:1 → `Service`  

**Ограничения:**  
- Уникально: `(org_id, service_id)`  
- `valid_until` проверяется на каждом запросе к сервису  
- Только `super_admin` может создавать и изменять  

**Tenant scope:** `org_id`  
**Lifecycle:** `active → disabled → active` | `active → expired`

---

### AccessGrant

**Назначение:** Временный токен (service token) для межсервисных вызовов Service → Control Plane.

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | UUID | PK |
| `org_id` | UUID | FK → Organization |
| `service_id` | UUID | FK → Service |
| `token_hash` | string | SHA-256 хэш токена |
| `scopes` | string[] | Разрешённые scopes |
| `expires_at` | timestamp | Короткий TTL (15 мин) |
| `revoked_at` | timestamp? | — |
| `created_at` | timestamp | — |

**Связи:**  
- N:1 → `Organization`  
- N:1 → `Service`  

**Ограничения:**  
- Только хэш хранится в БД, сырой токен — только при создании  
- TTL ≤ 15 минут  
- Не возобновляется, создаётся заново  

**Tenant scope:** `org_id`  
**Lifecycle:** `active → expired` | `active → revoked`

---

### ProviderConfig

**Назначение:** Зашифрованные настройки внешних провайдеров (OpenRouter API key и т.д.).

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | UUID | PK |
| `org_id` | UUID | FK → Organization |
| `provider` | enum | `openrouter \| stripe \| webhook \| ...` |
| `encrypted_value` | bytes | AES-256-GCM, ключ в Vault |
| `key_hint` | string | Последние 4 символа для UI |
| `rotated_at` | timestamp? | Последняя ротация |
| `created_by` | UUID | FK → User |
| `created_at` | timestamp | — |

**Связи:**  
- N:1 → `Organization`  

**Ограничения:**  
- `encrypted_value` никогда не сериализуется в API ответах и логах  
- Только `org_owner` может читать/писать  
- При ротации старый ключ помечается `rotated_at`, но хранится ещё 24 ч (grace period)  

**Tenant scope:** `org_id`

---

### AuditLog

**Назначение:** Иммутабельная запись каждого значимого действия в системе.

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | UUID | PK |
| `org_id` | UUID? | FK → Organization (null для super_admin действий) |
| `actor_id` | UUID? | FK → User |
| `actor_type` | enum | `user \| service \| system` |
| `action` | string | `user.login \| job.created \| schema.approved \| ...` |
| `resource_type` | string | Тип ресурса |
| `resource_id` | UUID? | ID ресурса |
| `payload` | jsonb | Контекст без secrets |
| `ip_address` | string | — |
| `user_agent` | string | — |
| `created_at` | timestamp | Иммутабельно |

**Связи:**  
- N:1 → `Organization`  
- N:1 → `User`  

**Ограничения:**  
- INSERT ONLY — никакого UPDATE/DELETE  
- `payload` не содержит `password`, `token`, `encrypted_value`  
- Индексируется по `(org_id, created_at)`, `(actor_id)`, `(resource_type, resource_id)`  

**Tenant scope:** `org_id`

---

## SERVICE PLANE — CSV Enrichment Service

---

### Project

**Назначение:** Логический контейнер для группировки UploadJob'ов одного клиента по теме/категории.

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | UUID | PK |
| `org_id` | UUID | Tenant scope |
| `created_by` | UUID | FK → User |
| `name` | string | — |
| `description` | string? | — |
| `status` | enum | `active \| archived` |
| `created_at` | timestamp | — |
| `archived_at` | timestamp? | — |

**Связи:**  
- 1:N → `UploadJob`  

**Ограничения:**  
- Принадлежит только одному tenant  
- Архивированный Project запрещает создание новых Job  

**Tenant scope:** `org_id`  
**Lifecycle:** `active → archived`

---

### UploadJob

**Назначение:** Центральный агрегат пайплайна. Представляет один загруженный CSV файл и весь его жизненный цикл обработки.

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | UUID | PK |
| `org_id` | UUID | Tenant scope |
| `project_id` | UUID | FK → Project |
| `created_by` | UUID | FK → User |
| `original_filename` | string | — |
| `s3_key_raw` | string | Путь к сырому файлу |
| `s3_key_result` | string? | Путь к итоговому файлу |
| `row_count` | int? | Заполняется после парсинга |
| `status` | enum | см. Lifecycle |
| `error_message` | string? | Last error |
| `created_at` | timestamp | — |
| `completed_at` | timestamp? | — |

**Связи:**  
- N:1 → `Project`  
- 1:1 → `SchemaTemplate` (активный)  
- 1:N → `EnrichmentRun`  
- 1:N → `ReviewTask`  
- 1:N → `ExportJob`  

**Ограничения:**  
- Максимальный размер файла по плану org  
- S3 prefix: `{org_id}/{job_id}/`  
- Нельзя удалить Job в процессе обработки  

**Tenant scope:** `org_id`  
**Lifecycle:** `PENDING → PARSING → PARSED → SCHEMA_DRAFT → SCHEMA_REVIEW → SCHEMA_CONFIRMED → ENRICHING → ENRICHED → NEEDS_COLLISION_REVIEW → READY → EXPORTING → DONE` | `* → FAILED`

---

### SchemaTemplate

**Назначение:** Шаблон характеристик товаров — результат AI генерации, подтверждённый человеком.

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | UUID | PK |
| `org_id` | UUID | Tenant scope |
| `job_id` | UUID | FK → UploadJob |
| `version` | int | Версия (инкрементируется при правках) |
| `status` | enum | `draft \| in_review \| confirmed \| rejected` |
| `confirmed_by` | UUID? | FK → User |
| `confirmed_at` | timestamp? | — |
| `ai_model` | string | Модель, сгенерировавшая шаблон |
| `created_at` | timestamp | — |

**Связи:**  
- N:1 → `UploadJob`  
- 1:N → `SchemaField`  

**Ограничения:**  
- Только один `confirmed` шаблон на Job  
- Версия увеличивается при каждом редактировании  
- Подтверждение требует роли ≥ `service_manager`  

**Tenant scope:** `org_id`  
**Lifecycle:** `draft → in_review → confirmed` | `in_review → rejected → draft`

---

### SchemaField

**Назначение:** Одна характеристика товара в шаблоне (атрибут с типом и ограничениями).

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | UUID | PK |
| `schema_id` | UUID | FK → SchemaTemplate |
| `org_id` | UUID | Tenant scope |
| `name` | string | Машинный ключ (snake_case) |
| `label` | string | Отображаемое название |
| `field_type` | enum | `text \| number \| boolean \| enum \| url` |
| `is_required` | bool | — |
| `allowed_values` | string[]? | Для enum типа |
| `description` | string? | Подсказка для AI |
| `sort_order` | int | Порядок в шаблоне |

**Связи:**  
- N:1 → `SchemaTemplate`  

**Ограничения:**  
- `name` уникален в рамках `schema_id`  
- Нельзя изменить после `schema confirmed`  

**Tenant scope:** `org_id`

---

### EnrichmentRun

**Назначение:** Одна попытка AI-обогащения всех SKU по подтверждённому шаблону.

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | UUID | PK |
| `org_id` | UUID | Tenant scope |
| `job_id` | UUID | FK → UploadJob |
| `schema_id` | UUID | FK → SchemaTemplate |
| `status` | enum | `queued \| running \| completed \| failed` |
| `total_items` | int | — |
| `processed_items` | int | — |
| `failed_items` | int | — |
| `tokens_used` | int | Суммарный расход токенов |
| `started_at` | timestamp? | — |
| `completed_at` | timestamp? | — |

**Связи:**  
- N:1 → `UploadJob`  
- 1:N → `EnrichedItem`  
- 1:N → `Collision`  

**Ограничения:**  
- Не более одного `running` run на Job  
- При `failed` можно запустить повторный run  

**Tenant scope:** `org_id`  
**Lifecycle:** `queued → running → completed` | `running → failed`

---

### EnrichedItem

**Назначение:** Результат AI-обогащения одного SKU — набор значений характеристик.

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | UUID | PK |
| `org_id` | UUID | Tenant scope |
| `run_id` | UUID | FK → EnrichmentRun |
| `sku_external_id` | string | ID товара из исходного CSV |
| `raw_data` | jsonb | Исходные данные SKU |
| `enriched_data` | jsonb | `{field_name: value}` |
| `confidence` | float? | Средняя уверенность AI |
| `status` | enum | `ok \| collision \| manual_override` |
| `reviewed_by` | UUID? | FK → User |
| `reviewed_at` | timestamp? | — |

**Связи:**  
- N:1 → `EnrichmentRun`  
- 1:N → `Collision`  

**Tenant scope:** `org_id`

---

### Collision

**Назначение:** Конфликт значений одной характеристики (AI vs AI, AI vs manual, дубль SKU).

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | UUID | PK |
| `org_id` | UUID | Tenant scope |
| `run_id` | UUID | FK → EnrichmentRun |
| `item_id` | UUID | FK → EnrichedItem |
| `field_name` | string | Проблемная характеристика |
| `collision_type` | enum | `value_conflict \| duplicate_sku \| out_of_range \| missing_required` |
| `value_a` | string? | Первое значение |
| `value_b` | string? | Конкурирующее значение |
| `resolved_value` | string? | Принятое значение |
| `status` | enum | `open \| resolved \| ignored` |
| `resolved_by` | UUID? | FK → User |
| `resolved_at` | timestamp? | — |

**Связи:**  
- N:1 → `EnrichedItem`  

**Ограничения:**  
- Экспорт блокируется если есть `open` коллизии (конфигурируемо)  

**Tenant scope:** `org_id`  
**Lifecycle:** `open → resolved` | `open → ignored`

---

### ReviewTask

**Назначение:** Human-in-the-loop задача — запрос подтверждения/правки от пользователя.

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | UUID | PK |
| `org_id` | UUID | Tenant scope |
| `job_id` | UUID | FK → UploadJob |
| `task_type` | enum | `schema_review \| collision_review \| seo_review` |
| `status` | enum | `pending \| in_progress \| completed \| skipped` |
| `assigned_to` | UUID? | FK → User |
| `completed_by` | UUID? | FK → User |
| `due_at` | timestamp? | Дедлайн |
| `completed_at` | timestamp? | — |
| `created_at` | timestamp | — |

**Связи:**  
- N:1 → `UploadJob`  

**Ограничения:**  
- Pipeline не продвигается до `completed` основной ReviewTask  
- Только один `pending` task данного типа на Job  

**Tenant scope:** `org_id`  
**Lifecycle:** `pending → in_progress → completed` | `pending → skipped`

---

### ExportJob

**Назначение:** Задача генерации и выгрузки итогового CSV файла.

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | UUID | PK |
| `org_id` | UUID | Tenant scope |
| `job_id` | UUID | FK → UploadJob |
| `requested_by` | UUID | FK → User |
| `status` | enum | `queued \| generating \| ready \| expired \| failed` |
| `s3_key` | string? | Путь к файлу |
| `signed_url` | string? | Pre-signed URL |
| `url_expires_at` | timestamp? | TTL URL (1 час) |
| `include_seo` | bool | Включать SEO описания |
| `created_at` | timestamp | — |
| `completed_at` | timestamp? | — |

**Связи:**  
- N:1 → `UploadJob`  

**Ограничения:**  
- `signed_url` истекает через 1 час  
- Требует `status=READY` у UploadJob  
- Блокируется при наличии `open` Collision (если настроено)  

**Tenant scope:** `org_id`  
**Lifecycle:** `queued → generating → ready → expired` | `generating → failed`

---

### SEOGenerationTask

**Назначение:** AI-задача генерации SEO описаний для SKU.

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | UUID | PK |
| `org_id` | UUID | Tenant scope |
| `job_id` | UUID | FK → UploadJob |
| `run_id` | UUID | FK → EnrichmentRun |
| `status` | enum | `queued \| running \| completed \| failed` |
| `lang` | string | `ru \| en \| uk \| ...` |
| `total_items` | int | — |
| `processed_items` | int | — |
| `tokens_used` | int | — |
| `started_at` | timestamp? | — |
| `completed_at` | timestamp? | — |

**Связи:**  
- N:1 → `UploadJob`  
- N:1 → `EnrichmentRun`  

**Ограничения:**  
- Запускается только после `EnrichmentRun.status=completed`  
- Результаты хранятся в `EnrichedItem.enriched_data` под ключом `seo_*`  

**Tenant scope:** `org_id`  
**Lifecycle:** `queued → running → completed` | `running → failed`

---

## ER Модель

```
CONTROL PLANE
─────────────────────────────────────────────────────────────────
Organization (1) ──────────── (N) Membership (N) ──── (1) User
     │                                  │
     │                              (N:1) Role (N:M) Permission
     │
     ├── (1:N) ServiceAccess (N:1) Service
     │              │
     │           (1:N) AccessGrant
     │
     ├── (1:N) ProviderConfig
     └── (1:N) AuditLog ◄── (actor) User

SERVICE PLANE — CSV Enrichment
─────────────────────────────────────────────────────────────────
Organization.org_id (scope для всех сущностей)

Project (1) ─────────────── (N) UploadJob
                                    │
                          ┌─────────┤─────────────────────┐
                          │         │                     │
                     (1:1) SchemaTemplate           (1:N) ReviewTask
                          │ (1:N) SchemaField
                          │
                    (1:N) EnrichmentRun
                          │
                ┌─────────┴──────────┐
                │                   │
          (1:N) EnrichedItem   (1:N) Collision
                │
         (1:N) Collision (item level)

UploadJob (1) ── (1:N) ExportJob
UploadJob (1) ── (1:N) SEOGenerationTask ◄── EnrichmentRun
```

---

## Бизнес-правила

### Control Plane

| № | Правило |
|---|---------|
| BR-CP-01 | Пользователь может быть членом нескольких Organization (разные Membership) |
| BR-CP-02 | `valid_until` в Membership проверяется при каждом запросе; истёкший доступ = отказ |
| BR-CP-03 | Только `super_admin` может создавать Organization и управлять ServiceAccess |
| BR-CP-04 | Только `org_owner` может создавать/ротировать ProviderConfig |
| BR-CP-05 | MFA обязательна для ролей `super_admin` и `org_owner` |
| BR-CP-06 | AuditLog — только append; UPDATE и DELETE запрещены на уровне DB |
| BR-CP-07 | Secrets (`encrypted_value`) не появляются в API ответах, логах и audit payload |
| BR-CP-08 | AccessGrant TTL ≤ 15 минут; используется только конкретным Service |
| BR-CP-09 | При `Organization.status=suspended` все запросы к сервисам возвращают 403 |
| BR-CP-10 | Удаление User — только soft delete; email не переиспользуется |

### Service Plane — CSV Enrichment

| № | Правило |
|---|---------|
| BR-SV-01 | Каждый UploadJob принадлежит ровно одному Project и одному org |
| BR-SV-02 | EnrichmentRun запускается только при `SchemaTemplate.status=confirmed` |
| BR-SV-03 | Не более одного `running` EnrichmentRun на UploadJob одновременно |
| BR-SV-04 | ExportJob блокируется при наличии `open` Collision (настраивается per-org) |
| BR-SV-05 | SchemaTemplate версионируется; каждое изменение = новая версия |
| BR-SV-06 | SEOGenerationTask запускается только после `EnrichmentRun.status=completed` |
| BR-SV-07 | Pipeline не продвигается без `completed` ReviewTask соответствующего типа |
| BR-SV-08 | S3 путь всегда начинается с `{org_id}/{job_id}/` — tenant isolation на уровне storage |
| BR-SV-09 | `signed_url` в ExportJob истекает через 1 час |
| BR-SV-10 | Лимит SKU на Job определяется планом Organization |
| BR-SV-11 | Токен-бюджет (TokenBudgetGuard) проверяется per-org перед каждым AI вызовом |
| BR-SV-12 | Collision типа `duplicate_sku` блокирует обогащение дубля до разрешения |

---

## Lifecycle States

### UploadJob

```
PENDING
  │ (ParseCsvJob queued)
  ▼
PARSING
  │ (parsing complete)
  ▼
PARSED
  │ (GenerateSchemaJob queued)
  ▼
SCHEMA_DRAFT
  │ (ReviewTask created)
  ▼
SCHEMA_REVIEW ── (reject) ──► SCHEMA_DRAFT
  │ (human confirms)
  ▼
SCHEMA_CONFIRMED
  │ (EnrichmentRun queued)
  ▼
ENRICHING
  │ (enrichment complete)
  ▼
ENRICHED
  │ (collisions found?)
  ├── YES ──► NEEDS_COLLISION_REVIEW ── (resolved) ──► READY
  └── NO  ──► READY
                │ (ExportJob requested)
                ▼
             EXPORTING
                │
                ▼
              DONE

Any state ──► FAILED (on unrecoverable error)
```

### SchemaTemplate

```
draft ──► in_review ──► confirmed
              │
              └──► rejected ──► draft (new version)
```

### EnrichmentRun / SEOGenerationTask

```
queued ──► running ──► completed
               └──► failed (retriable)
```

### Collision

```
open ──► resolved (human picks value)
  └──► ignored (manual override)
```

### ReviewTask

```
pending ──► in_progress ──► completed
   └──► skipped (by org_admin)
```

### AccessGrant

```
active ──► expired (TTL)
   └──► revoked (explicit)
```

### Membership

```
invited ──► active ──► suspended ──► active
               └──► removed
```
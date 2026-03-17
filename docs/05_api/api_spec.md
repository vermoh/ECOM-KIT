# API Specification — ECOM KIT Platform

> **Версия:** 1.0 · **Дата:** 2026-03-17  
> **Base URLs:**  
> Control Plane: `https://api.ecomkit.io/cp/v1`  
> CSV Service: `https://api.ecomkit.io/csv/v1`  
>
> **Auth header:** `Authorization: Bearer <jwt>`  
> **Content-Type:** `application/json`  
> **Tenant header:** автоматически извлекается из JWT `org_id`

---

## Глобальная модель ошибок

```json
{
  "error": {
    "code": "PERMISSION_DENIED",
    "message": "You do not have permission to perform this action.",
    "request_id": "req_01HX...",
    "timestamp": "2026-03-17T14:00:00Z"
  }
}
```

| HTTP | Code | Описание |
|------|------|----------|
| 400 | `VALIDATION_ERROR` | Невалидный запрос |
| 401 | `AUTH_TOKEN_MISSING` / `AUTH_TOKEN_EXPIRED` | Нет или истёк JWT |
| 403 | `PERMISSION_DENIED` / `ORG_SUSPENDED` / `ACCESS_EXPIRED` | Нет прав |
| 404 | `NOT_FOUND` | Ресурс не найден |
| 409 | `CONFLICT` | Конфликт состояния |
| 422 | `UNPROCESSABLE` | Бизнес-логика отклонила запрос |
| 429 | `RATE_LIMITED` | Превышен лимит запросов |
| 500 | `INTERNAL_ERROR` | Внутренняя ошибка |

---

## 1. AUTH API

### POST `/auth/login`

**Назначение:** Аутентификация пользователя, выдача JWT + refresh token.  
**Роль:** Публичный

**Request:**
```json
{
  "email": "user@example.com",
  "password": "s3cr3t",
  "org_slug": "acme-corp",
  "mfa_code": "123456"
}
```

| Поле | Тип | Обязательно |
|------|-----|-------------|
| `email` | string | ✅ |
| `password` | string | ✅ |
| `org_slug` | string | ✅ |
| `mfa_code` | string | Если MFA включена |

**Response** `200 OK`:
```json
{
  "access_token": "eyJhbGciOiJSUzI1NiJ9...",
  "refresh_token": "rt_01HX...",
  "token_type": "Bearer",
  "expires_in": 900,
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "role": "manager",
    "org_id": "org-uuid"
  }
}
```

**Errors:**

| Code | Описание |
|------|----------|
| `INVALID_CREDENTIALS` | Неверный email/пароль |
| `MFA_REQUIRED` | MFA требуется, код не передан |
| `MFA_INVALID` | Неверный MFA код |
| `ORG_NOT_FOUND` | org_slug не существует |
| `USER_LOCKED` | Аккаунт заблокирован |
| `ACCESS_EXPIRED` | Membership.valid_until истёк |

---

### POST `/auth/refresh`

**Назначение:** Обновление access token по refresh token.  
**Роль:** Публичный (с валидным refresh token)

**Request:**
```json
{ "refresh_token": "rt_01HX..." }
```

**Response** `200 OK`:
```json
{
  "access_token": "eyJ...",
  "expires_in": 900
}
```

**Errors:** `REFRESH_TOKEN_INVALID`, `REFRESH_TOKEN_EXPIRED`, `ACCESS_EXPIRED`

---

### POST `/auth/logout`

**Назначение:** Инвалидация refresh token и сессии.  
**Роль:** Любой аутентифицированный

**Request:** `{}` (JWT в заголовке)

**Response** `204 No Content`

---

### POST `/auth/mfa/enable`

**Назначение:** Включение TOTP-MFA для текущего пользователя.  
**Роль:** Любой аутентифицированный

**Response** `200 OK`:
```json
{
  "totp_secret": "BASE32SECRET",
  "qr_code_url": "otpauth://totp/...",
  "backup_codes": ["abc123", "def456"]
}
```

---

## 2. ORGANIZATION API

### POST `/organizations`

**Назначение:** Создать новую организацию (tenant).  
**Роль:** `super_admin`  
**Permission:** `organization:create`

**Request:**
```json
{
  "slug": "acme-corp",
  "name": "Acme Corporation",
  "plan": "pro",
  "owner_email": "owner@acme.com"
}
```

**Response** `201 Created`:
```json
{
  "id": "org-uuid",
  "slug": "acme-corp",
  "name": "Acme Corporation",
  "plan": "pro",
  "status": "active",
  "created_at": "2026-03-17T14:00:00Z"
}
```

**Errors:** `SLUG_TAKEN`, `OWNER_EMAIL_NOT_FOUND`, `VALIDATION_ERROR`

---

### GET `/organizations/:org_id`

**Назначение:** Получить данные организации.  
**Роль:** `org_owner`, `org_admin`, `super_admin`  
**Permission:** `organization:read`

**Response** `200 OK`:
```json
{
  "id": "org-uuid",
  "slug": "acme-corp",
  "name": "Acme Corporation",
  "plan": "pro",
  "status": "active",
  "max_users": 50,
  "max_projects": 20,
  "created_at": "2026-03-17T12:00:00Z"
}
```

---

### PATCH `/organizations/:org_id`

**Назначение:** Обновить настройки организации.  
**Роль:** `org_owner`, `super_admin`  
**Permission:** `organization:update`

**Request:**
```json
{
  "name": "Acme Corp (Updated)",
  "max_users": 100
}
```

**Response** `200 OK`: обновлённый объект организации.

**Errors:** `FORBIDDEN`, `VALIDATION_ERROR`

---

### POST `/organizations/:org_id/suspend`

**Назначение:** Приостановить доступ всей организации.  
**Роль:** `super_admin`  
**Permission:** `organization:suspend`

**Response** `200 OK`:
```json
{ "status": "suspended", "suspended_at": "2026-03-17T14:00:00Z" }
```

---

## 3. USER MANAGEMENT API

### POST `/organizations/:org_id/users/invite`

**Назначение:** Пригласить пользователя в организацию.  
**Роль:** `org_owner`, `org_admin`  
**Permission:** `user:invite`

**Request:**
```json
{
  "email": "new@example.com",
  "role_id": "role-uuid",
  "valid_until": "2026-12-31T23:59:59Z"
}
```

| Поле | Тип | Обязательно |
|------|-----|-------------|
| `email` | string | ✅ |
| `role_id` | UUID | ✅ |
| `valid_until` | ISO8601 | ❌ (null = бессрочно) |

**Response** `201 Created`:
```json
{
  "membership_id": "mem-uuid",
  "user_id": "user-uuid",
  "email": "new@example.com",
  "role": "manager",
  "status": "invited",
  "valid_until": "2026-12-31T23:59:59Z"
}
```

**Errors:** `USER_ALREADY_MEMBER`, `ROLE_NOT_FOUND`, `USER_LIMIT_REACHED`

---

### GET `/organizations/:org_id/users`

**Назначение:** Список пользователей организации.  
**Роль:** `org_owner`, `org_admin`  
**Permission:** `user:read`

**Query params:** `?status=active&page=1&limit=50`

**Response** `200 OK`:
```json
{
  "data": [
    {
      "user_id": "uuid",
      "email": "user@example.com",
      "role": "manager",
      "status": "active",
      "valid_until": null,
      "last_login_at": "2026-03-17T10:00:00Z"
    }
  ],
  "pagination": { "page": 1, "limit": 50, "total": 12 }
}
```

---

### PATCH `/organizations/:org_id/users/:user_id/role`

**Назначение:** Изменить роль пользователя в организации.  
**Роль:** `org_owner`, `org_admin`  
**Permission:** `user:update_role`

**Request:**
```json
{ "role_id": "new-role-uuid" }
```

**Response** `200 OK`:
```json
{ "user_id": "uuid", "role": "analyst", "updated_at": "2026-03-17T14:00:00Z" }
```

**Errors:** `CANNOT_CHANGE_OWNER_ROLE`, `ROLE_NOT_FOUND`

---

### PATCH `/organizations/:org_id/users/:user_id/expiry`

**Назначение:** Установить или изменить срок доступа пользователя.  
**Роль:** `org_owner`, `super_admin`  
**Permission:** `user:set_expiry`

**Request:**
```json
{
  "valid_from": "2026-04-01T00:00:00Z",
  "valid_until": "2026-06-30T23:59:59Z"
}
```

**Response** `200 OK`:
```json
{
  "membership_id": "mem-uuid",
  "valid_from": "2026-04-01T00:00:00Z",
  "valid_until": "2026-06-30T23:59:59Z"
}
```

---

### DELETE `/organizations/:org_id/users/:user_id`

**Назначение:** Удалить пользователя из организации (membership → removed).  
**Роль:** `org_owner`, `org_admin`  
**Permission:** `user:remove`

**Response** `204 No Content`

**Errors:** `CANNOT_REMOVE_LAST_OWNER`

---

### PATCH `/organizations/:org_id/users/:user_id/assign-role`

**Назначение:** Назначить роль пользователю.  
**Роль:** `org_owner`, `org_admin`  
**Permission:** `user:update_role`

**Request:**
```json
{ "role_id": "role-uuid" }
```

**Response** `200 OK`: обновлённый membership объект.

---

## 4. SERVICE ACCESS API

### POST `/organizations/:org_id/service-access`

**Назначение:** Выдать организации доступ к сервису.  
**Роль:** `super_admin`  
**Permission:** `service:grant_access`

**Request:**
```json
{
  "service_id": "svc-uuid",
  "valid_from": "2026-03-17T00:00:00Z",
  "valid_until": null
}
```

**Response** `201 Created`:
```json
{
  "id": "sa-uuid",
  "org_id": "org-uuid",
  "service_id": "svc-uuid",
  "service_slug": "csv-enrichment",
  "enabled": true,
  "valid_from": "2026-03-17T00:00:00Z",
  "valid_until": null,
  "granted_by": "user-uuid"
}
```

**Errors:** `SERVICE_NOT_FOUND`, `ACCESS_ALREADY_GRANTED`

---

### GET `/organizations/:org_id/service-access`

**Назначение:** Список доступных сервисов организации.  
**Роль:** `org_owner`, `org_admin`, `super_admin`  
**Permission:** `service:read`

**Response** `200 OK`:
```json
{
  "data": [
    {
      "service_slug": "csv-enrichment",
      "service_name": "CSV Enrichment Service",
      "enabled": true,
      "valid_until": null
    }
  ]
}
```

---

### DELETE `/organizations/:org_id/service-access/:service_id`

**Назначение:** Отозвать доступ организации к сервису.  
**Роль:** `super_admin`  
**Permission:** `service:revoke_access`

**Response** `204 No Content`

---

## 5. AI PROVIDER API

### POST `/organizations/:org_id/provider-configs`

**Назначение:** Сохранить зашифрованный API ключ провайдера (OpenRouter и др.).  
**Роль:** `org_owner`  
**Permission:** `secret:create`

**Request:**
```json
{
  "provider": "openrouter",
  "api_key": "sk-or-v1-..."
}
```

> `api_key` передаётся по HTTPS, шифруется на backend (AES-256-GCM), сохраняется как `encrypted_value`. Открытое значение нигде не хранится.

**Response** `201 Created`:
```json
{
  "id": "pc-uuid",
  "provider": "openrouter",
  "key_hint": "...ab3f",
  "created_at": "2026-03-17T14:00:00Z"
}
```

**Errors:** `PROVIDER_ALREADY_CONFIGURED`, `INVALID_API_KEY_FORMAT`

---

### GET `/organizations/:org_id/provider-configs`

**Назначение:** Список сохранённых провайдеров (только hint — не ключ).  
**Роль:** `org_owner`, `org_admin`  
**Permission:** `secret:read_hint`

**Response** `200 OK`:
```json
{
  "data": [
    {
      "id": "pc-uuid",
      "provider": "openrouter",
      "key_hint": "...ab3f",
      "rotated_at": null,
      "created_at": "2026-03-17T14:00:00Z"
    }
  ]
}
```

---

### POST `/organizations/:org_id/provider-configs/:id/rotate`

**Назначение:** Ротировать API ключ (заменить на новый).  
**Роль:** `org_owner`  
**Permission:** `secret:rotate`

**Request:**
```json
{ "api_key": "sk-or-v1-new..." }
```

**Response** `200 OK`:
```json
{
  "id": "pc-uuid",
  "key_hint": "...zz99",
  "rotated_at": "2026-03-17T14:05:00Z"
}
```

---

### DELETE `/organizations/:org_id/provider-configs/:id`

**Назначение:** Удалить конфигурацию провайдера.  
**Роль:** `org_owner`  
**Permission:** `secret:delete`

**Response** `204 No Content`

---

## 6. CSV SERVICE API

### POST `/projects`

**Назначение:** Создать новый проект.  
**Роль:** `manager`, `org_admin`, `org_owner`, `service_user`  
**Permission:** `project:create`

**Request:**
```json
{
  "name": "Электроника Q2 2026",
  "description": "Обогащение каталога электроники"
}
```

**Response** `201 Created`:
```json
{
  "id": "proj-uuid",
  "name": "Электроника Q2 2026",
  "status": "active",
  "created_at": "2026-03-17T14:00:00Z"
}
```

---

### POST `/projects/:project_id/uploads`

**Назначение:** Загрузить CSV файл, инициировать pipeline.  
**Роль:** `manager`, `operator`, `service_user`  
**Permission:** `upload:create`  
**Content-Type:** `multipart/form-data`

**Request:**
```
file: <CSV file>
```

**Response** `201 Created`:
```json
{
  "id": "upload-uuid",
  "project_id": "proj-uuid",
  "original_filename": "products.csv",
  "status": "pending",
  "file_size_bytes": 204800,
  "created_at": "2026-03-17T14:00:00Z"
}
```

> После создания автоматически ставится в очередь `ParseCsvJob`.

**Errors:** `FILE_TOO_LARGE`, `INVALID_CSV_FORMAT`, `PROJECT_ARCHIVED`, `UPLOAD_LIMIT_REACHED`

---

### GET `/projects/:project_id/uploads/:upload_id`

**Назначение:** Получить статус загрузки и pipeline.  
**Роль:** Все аутентифицированные с доступом к проекту  
**Permission:** `upload:read`

**Response** `200 OK`:
```json
{
  "id": "upload-uuid",
  "status": "schema_review",
  "original_filename": "products.csv",
  "row_count": 5420,
  "file_size_bytes": 204800,
  "error_message": null,
  "created_at": "2026-03-17T14:00:00Z",
  "completed_at": null
}
```

---

### POST `/projects/:project_id/uploads/:upload_id/generate-schema`

**Назначение:** Запустить AI-генерацию шаблона характеристик.  
**Роль:** `manager`, `operator`, `service_user`  
**Permission:** `schema:update`

> Доступно только когда `upload.status = parsed`. Ставит в очередь `GenerateSchemaJob`.

**Response** `202 Accepted`:
```json
{
  "schema_template_id": "st-uuid",
  "status": "draft",
  "message": "Schema generation queued."
}
```

**Errors:** `UPLOAD_NOT_IN_PARSED_STATE`, `SCHEMA_ALREADY_EXISTS`

---

### GET `/projects/:project_id/uploads/:upload_id/schema`

**Назначение:** Получить текущий шаблон характеристик (draft или confirmed).  
**Роль:** Все с доступом к проекту  
**Permission:** `schema:read`

**Response** `200 OK`:
```json
{
  "id": "st-uuid",
  "version": 2,
  "status": "in_review",
  "ai_model": "openai/gpt-4o",
  "fields": [
    {
      "id": "sf-uuid",
      "name": "brand",
      "label": "Бренд",
      "field_type": "text",
      "is_required": true,
      "allowed_values": null,
      "description": "Производитель товара",
      "sort_order": 1
    },
    {
      "id": "sf-uuid-2",
      "name": "color",
      "label": "Цвет",
      "field_type": "enum",
      "is_required": false,
      "allowed_values": ["красный", "синий", "чёрный", "белый"],
      "description": "Основной цвет",
      "sort_order": 2
    }
  ]
}
```

---

### PATCH `/projects/:project_id/uploads/:upload_id/schema`

**Назначение:** Редактировать поля шаблона перед подтверждением.  
**Роль:** `manager`, `operator`, `service_user`  
**Permission:** `schema:update`

**Request:**
```json
{
  "fields": [
    {
      "id": "sf-uuid",
      "label": "Производитель",
      "is_required": true,
      "description": "Официальное название бренда"
    }
  ]
}
```

**Response** `200 OK`: обновлённый schema object с `version++`.

**Errors:** `SCHEMA_ALREADY_CONFIRMED`, `FIELD_NOT_FOUND`

---

### POST `/projects/:project_id/uploads/:upload_id/enrichment`

**Назначение:** Запустить AI-обогащение SKU по подтверждённому шаблону.  
**Роль:** `manager`, `operator`, `service_user`  
**Permission:** `enrichment:start`

> Требует `upload.status = schema_confirmed`. Ставит в очередь `EnrichSkuJob`.

**Response** `202 Accepted`:
```json
{
  "run_id": "run-uuid",
  "status": "queued",
  "total_items": 5420,
  "message": "Enrichment job queued."
}
```

**Errors:** `SCHEMA_NOT_CONFIRMED`, `RUN_ALREADY_IN_PROGRESS`

---

### GET `/projects/:project_id/uploads/:upload_id/enrichment/:run_id`

**Назначение:** Статус и прогресс enrichment run.  
**Роль:** Все с доступом  
**Permission:** `enrichment:read`

**Response** `200 OK`:
```json
{
  "run_id": "run-uuid",
  "status": "running",
  "total_items": 5420,
  "processed_items": 2100,
  "failed_items": 3,
  "tokens_used": 184500,
  "started_at": "2026-03-17T14:10:00Z",
  "completed_at": null,
  "progress_pct": 38.7
}
```

---

### POST `/projects/:project_id/uploads/:upload_id/seo`

**Назначение:** Запустить AI-генерацию SEO описаний для SKU.  
**Роль:** `manager`, `operator`, `service_user`  
**Permission:** `seo:start`

**Request:**
```json
{ "lang": "ru" }
```

**Response** `202 Accepted`:
```json
{
  "seo_task_id": "seo-uuid",
  "status": "queued",
  "lang": "ru",
  "total_items": 5420
}
```

**Errors:** `ENRICHMENT_NOT_COMPLETED`, `SEO_TASK_ALREADY_RUNNING`

---

## 7. REVIEW API

### POST `/projects/:project_id/uploads/:upload_id/schema/approve`

**Назначение:** Подтвердить шаблон характеристик (human-in-the-loop).  
**Роль:** `manager`, `reviewer`, `org_admin`, `org_owner`  
**Permission:** `schema:approve`

> Переводит `schema_template.status → confirmed` и `upload.status → schema_confirmed`.  
> Далее автоматически ставится в очередь задача обогащения.

**Response** `200 OK`:
```json
{
  "schema_template_id": "st-uuid",
  "status": "confirmed",
  "confirmed_by": "user-uuid",
  "confirmed_at": "2026-03-17T14:20:00Z"
}
```

**Errors:** `SCHEMA_NOT_IN_REVIEW`, `PERMISSION_DENIED`

---

### POST `/projects/:project_id/uploads/:upload_id/schema/reject`

**Назначение:** Отклонить шаблон и запросить новую генерацию.  
**Роль:** `manager`, `reviewer`, `org_admin`  
**Permission:** `schema:reject`

**Request:**
```json
{ "reason": "Отсутствуют поля для размеров и материала" }
```

**Response** `200 OK`:
```json
{
  "schema_template_id": "st-uuid",
  "status": "rejected",
  "version": 2
}
```

---

### GET `/projects/:project_id/uploads/:upload_id/collisions`

**Назначение:** Список коллизий, требующих разрешения.  
**Роль:** `manager`, `reviewer`, `analyst`, `org_admin`  
**Permission:** `collision:read`

**Query params:** `?status=open&page=1&limit=100`

**Response** `200 OK`:
```json
{
  "data": [
    {
      "id": "col-uuid",
      "sku_external_id": "SKU-10042",
      "field_name": "brand",
      "collision_type": "value_conflict",
      "value_a": "Samsung",
      "value_b": "SAMSUNG Electronics",
      "status": "open",
      "created_at": "2026-03-17T14:15:00Z"
    }
  ],
  "summary": {
    "total": 47,
    "open": 23,
    "resolved": 20,
    "ignored": 4
  },
  "pagination": { "page": 1, "limit": 100, "total": 47 }
}
```

---

### POST `/projects/:project_id/uploads/:upload_id/collisions/:collision_id/resolve`

**Назначение:** Разрешить коллизию — выбрать итоговое значение.  
**Роль:** `manager`, `reviewer`, `org_admin`  
**Permission:** `collision:resolve`

**Request:**
```json
{
  "action": "resolve",
  "resolved_value": "Samsung"
}
```

| `action` | Описание |
|----------|----------|
| `resolve` | Принять `resolved_value` |
| `ignore` | Оставить текущее значение, закрыть коллизию |

**Response** `200 OK`:
```json
{
  "id": "col-uuid",
  "status": "resolved",
  "resolved_value": "Samsung",
  "resolved_by": "user-uuid",
  "resolved_at": "2026-03-17T14:25:00Z"
}
```

**Errors:** `COLLISION_ALREADY_RESOLVED`, `INVALID_ACTION`

---

### POST `/projects/:project_id/uploads/:upload_id/collisions/resolve-all`

**Назначение:** Массово разрешить все коллизии (игнорировать все open).  
**Роль:** `manager`, `org_admin`  
**Permission:** `collision:resolve`

**Request:**
```json
{ "action": "ignore_all" }
```

**Response** `200 OK`:
```json
{ "resolved_count": 23, "action": "ignore_all" }
```

---

## 8. EXPORT API

### POST `/projects/:project_id/uploads/:upload_id/exports`

**Назначение:** Запустить генерацию итогового CSV файла.  
**Роль:** `manager`, `analyst`, `service_user`  
**Permission:** `export:create`

> Доступно только при `upload.status = ready`.  
> Блокируется если есть `open` коллизии (конфигурируемо per-org).

**Request:**
```json
{ "include_seo": true }
```

**Response** `202 Accepted`:
```json
{
  "export_job_id": "exp-uuid",
  "status": "queued",
  "include_seo": true,
  "message": "Export job queued."
}
```

**Errors:** `UPLOAD_NOT_READY`, `OPEN_COLLISIONS_EXIST`, `EXPORT_IN_PROGRESS`

---

### GET `/projects/:project_id/uploads/:upload_id/exports/:export_id`

**Назначение:** Проверить статус экспорта и получить download URL.  
**Роль:** `manager`, `analyst`, `service_user`  
**Permission:** `export:read`

**Response** `200 OK`:
```json
{
  "id": "exp-uuid",
  "status": "ready",
  "include_seo": true,
  "signed_url": "https://s3.amazonaws.com/...",
  "url_expires_at": "2026-03-17T15:30:00Z",
  "completed_at": "2026-03-17T14:30:00Z"
}
```

> `signed_url` доступен только 1 час. При `status = expired` — запросить новый экспорт.

---

### GET `/projects/:project_id/uploads/:upload_id/exports/:export_id/download`

**Назначение:** Прямая загрузка файла через redirect на signed_url.  
**Роль:** `manager`, `analyst`, `service_user`  
**Permission:** `export:download`

**Response** `302 Found` → redirect на S3 pre-signed URL

**Errors:** `EXPORT_NOT_READY`, `EXPORT_URL_EXPIRED`

---

## 9. AUDIT API

### GET `/organizations/:org_id/audit-logs`

**Назначение:** Список событий аудита организации.  
**Роль:** `org_owner`, `org_admin`, `super_admin`  
**Permission:** `audit:read_own_org`

**Query params:**

| Параметр | Тип | Описание |
|----------|-----|----------|
| `from` | ISO8601 | Начало периода |
| `to` | ISO8601 | Конец периода |
| `action` | string | Фильтр по action (e.g. `job.created`) |
| `actor_id` | UUID | Фильтр по пользователю |
| `resource_type` | string | Фильтр по типу ресурса |
| `page` | int | — |
| `limit` | int | Макс. 500 |

**Response** `200 OK`:
```json
{
  "data": [
    {
      "id": "aud-uuid",
      "actor_id": "user-uuid",
      "actor_type": "user",
      "action": "schema.approved",
      "resource_type": "schema_template",
      "resource_id": "st-uuid",
      "payload": {
        "upload_id": "upload-uuid",
        "version": 2
      },
      "ip_address": "192.168.1.1",
      "created_at": "2026-03-17T14:20:00Z"
    }
  ],
  "pagination": { "page": 1, "limit": 100, "total": 348 }
}
```

---

### GET `/audit-logs` *(super admin)*

**Назначение:** Глобальный аудит по всем организациям.  
**Роль:** `super_admin`  
**Permission:** `audit:read_all_orgs`

**Query params:** аналогично выше + `org_id` для фильтрации по конкретной org.

---

### POST `/organizations/:org_id/audit-logs/export`

**Назначение:** Экспортировать аудит в CSV/JSON.  
**Роль:** `org_owner`, `super_admin`  
**Permission:** `audit:export`

**Request:**
```json
{
  "from": "2026-01-01T00:00:00Z",
  "to": "2026-03-31T23:59:59Z",
  "format": "csv"
}
```

**Response** `202 Accepted`:
```json
{
  "export_id": "aexp-uuid",
  "status": "queued",
  "message": "Audit export queued. Download link will be available shortly."
}
```

---

## Сводная таблица эндпойнтов

| # | Method | Route | Permission | Async |
|---|--------|-------|-----------|-------|
| 1 | POST | `/auth/login` | Public | ❌ |
| 2 | POST | `/auth/refresh` | Public | ❌ |
| 3 | POST | `/auth/logout` | Authenticated | ❌ |
| 4 | POST | `/auth/mfa/enable` | Authenticated | ❌ |
| 5 | POST | `/organizations` | `organization:create` | ❌ |
| 6 | GET | `/organizations/:id` | `organization:read` | ❌ |
| 7 | PATCH | `/organizations/:id` | `organization:update` | ❌ |
| 8 | POST | `/organizations/:id/suspend` | `organization:suspend` | ❌ |
| 9 | POST | `/organizations/:id/users/invite` | `user:invite` | ❌ |
| 10 | GET | `/organizations/:id/users` | `user:read` | ❌ |
| 11 | PATCH | `/organizations/:id/users/:uid/role` | `user:update_role` | ❌ |
| 12 | PATCH | `/organizations/:id/users/:uid/expiry` | `user:set_expiry` | ❌ |
| 13 | PATCH | `/organizations/:id/users/:uid/assign-role` | `user:update_role` | ❌ |
| 14 | DELETE | `/organizations/:id/users/:uid` | `user:remove` | ❌ |
| 15 | POST | `/organizations/:id/service-access` | `service:grant_access` | ❌ |
| 16 | GET | `/organizations/:id/service-access` | `service:read` | ❌ |
| 17 | DELETE | `/organizations/:id/service-access/:sid` | `service:revoke_access` | ❌ |
| 18 | POST | `/organizations/:id/provider-configs` | `secret:create` | ❌ |
| 19 | GET | `/organizations/:id/provider-configs` | `secret:read_hint` | ❌ |
| 20 | POST | `/organizations/:id/provider-configs/:pid/rotate` | `secret:rotate` | ❌ |
| 21 | DELETE | `/organizations/:id/provider-configs/:pid` | `secret:delete` | ❌ |
| 22 | POST | `/projects` | `project:create` | ❌ |
| 23 | POST | `/projects/:pid/uploads` | `upload:create` | ✅ |
| 24 | GET | `/projects/:pid/uploads/:uid` | `upload:read` | ❌ |
| 25 | POST | `/projects/:pid/uploads/:uid/generate-schema` | `schema:update` | ✅ |
| 26 | GET | `/projects/:pid/uploads/:uid/schema` | `schema:read` | ❌ |
| 27 | PATCH | `/projects/:pid/uploads/:uid/schema` | `schema:update` | ❌ |
| 28 | POST | `/projects/:pid/uploads/:uid/schema/approve` | `schema:approve` | ❌ |
| 29 | POST | `/projects/:pid/uploads/:uid/schema/reject` | `schema:reject` | ❌ |
| 30 | POST | `/projects/:pid/uploads/:uid/enrichment` | `enrichment:start` | ✅ |
| 31 | GET | `/projects/:pid/uploads/:uid/enrichment/:rid` | `enrichment:read` | ❌ |
| 32 | POST | `/projects/:pid/uploads/:uid/seo` | `seo:start` | ✅ |
| 33 | GET | `/projects/:pid/uploads/:uid/collisions` | `collision:read` | ❌ |
| 34 | POST | `/projects/:pid/uploads/:uid/collisions/:cid/resolve` | `collision:resolve` | ❌ |
| 35 | POST | `/projects/:pid/uploads/:uid/collisions/resolve-all` | `collision:resolve` | ❌ |
| 36 | POST | `/projects/:pid/uploads/:uid/exports` | `export:create` | ✅ |
| 37 | GET | `/projects/:pid/uploads/:uid/exports/:eid` | `export:read` | ❌ |
| 38 | GET | `/projects/:pid/uploads/:uid/exports/:eid/download` | `export:download` | ❌ |
| 39 | GET | `/organizations/:id/audit-logs` | `audit:read_own_org` | ❌ |
| 40 | GET | `/audit-logs` | `audit:read_all_orgs` | ❌ |
| 41 | POST | `/organizations/:id/audit-logs/export` | `audit:export` | ✅ |
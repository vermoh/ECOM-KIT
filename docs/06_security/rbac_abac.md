# RBAC Model — ECOM KIT Platform

> **Версия:** 1.0  
> **Дата:** 2026-03-17  
> **Принцип:** Deny by default. Все права — явные. Проверка только на backend.

---

## 1. Роли и иерархия

```
super_admin
  └── (платформа целиком, все орги)

organization_owner
  └── organization_admin
        ├── manager
        │     ├── operator
        │     ├── reviewer
        │     └── analyst
        ├── service_user
        └── read_only
```

| Роль | Scope | Назначение |
|------|-------|------------|
| `super_admin` | Platform | Управление всей платформой, всеми org, сервисами, биллингом |
| `organization_owner` | Org | Полный контроль org включая secrets и billing |
| `organization_admin` | Org | Управление users/roles, нет secrets/billing |
| `manager` | Org | Управление проектами, запуск обогащения, экспорт |
| `operator` | Org | Загрузка CSV, запуск задач, нет approval и экспорта |
| `reviewer` | Org | Только human-in-the-loop задачи: approve schema, resolve collisions |
| `analyst` | Org | Read results и export, нет write-операций |
| `service_user` | Org | Машинный API доступ (CI/CD, интеграции) |
| `read_only` | Org | Просмотр всего без возможности изменений |

> **Правило:** Роли не наследуются автоматически. Каждая роль — явный набор прав.

---

## 2. Resource Permission Matrix

Обозначения: ✅ разрешено · ❌ запрещено · 〇 только своё · ⚠️ с ограничениями

### 2.1 Organizations

| Право | super_admin | org_owner | org_admin | manager | operator | reviewer | analyst | service_user | read_only |
|-------|:-----------:|:---------:|:---------:|:-------:|:--------:|:--------:|:-------:|:------------:|:---------:|
| `organization:create` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `organization:read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `organization:update` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `organization:suspend` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `organization:delete` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

### 2.2 Users & Memberships

| Право | super_admin | org_owner | org_admin | manager | operator | reviewer | analyst | service_user | read_only |
|-------|:-----------:|:---------:|:---------:|:-------:|:--------:|:--------:|:-------:|:------------:|:---------:|
| `user:invite` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `user:read` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `user:update_role` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `user:suspend` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `user:remove` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `user:set_expiry` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

### 2.3 Services (Service Registry & Access)

| Право | super_admin | org_owner | org_admin | manager | operator | reviewer | analyst | service_user | read_only |
|-------|:-----------:|:---------:|:---------:|:-------:|:--------:|:--------:|:-------:|:------------:|:---------:|
| `service:register` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `service:grant_access` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `service:revoke_access` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `service:read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

### 2.4 CSV Projects

| Право | super_admin | org_owner | org_admin | manager | operator | reviewer | analyst | service_user | read_only |
|-------|:-----------:|:---------:|:---------:|:-------:|:--------:|:--------:|:-------:|:------------:|:---------:|
| `project:create` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ |
| `project:read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `project:update` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ |
| `project:archive` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `upload:create` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| `upload:read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `upload:delete` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

### 2.5 Schema Approval

| Право | super_admin | org_owner | org_admin | manager | operator | reviewer | analyst | service_user | read_only |
|-------|:-----------:|:---------:|:---------:|:-------:|:--------:|:--------:|:-------:|:------------:|:---------:|
| `schema:read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `schema:update` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| `schema:approve` | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| `schema:reject` | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |

### 2.6 Enrichment

| Право | super_admin | org_owner | org_admin | manager | operator | reviewer | analyst | service_user | read_only |
|-------|:-----------:|:---------:|:---------:|:-------:|:--------:|:--------:|:-------:|:------------:|:---------:|
| `enrichment:start` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| `enrichment:read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `enrichment:cancel` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `collision:read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `collision:resolve` | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| `seo:start` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| `seo:read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

### 2.7 Export

| Право | super_admin | org_owner | org_admin | manager | operator | reviewer | analyst | service_user | read_only |
|-------|:-----------:|:---------:|:---------:|:-------:|:--------:|:--------:|:-------:|:------------:|:---------:|
| `export:create` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ |
| `export:read` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ |
| `export:download` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ |

### 2.8 AI Keys (Provider Configs)

| Право | super_admin | org_owner | org_admin | manager | operator | reviewer | analyst | service_user | read_only |
|-------|:-----------:|:---------:|:---------:|:-------:|:--------:|:--------:|:-------:|:------------:|:---------:|
| `secret:create` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `secret:read_hint` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `secret:rotate` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `secret:delete` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

> `secret:read` (расшифрованное значение) — **нет ни у одной роли**. Только AI Gateway Proxy читает через Vault.

### 2.9 Audit Logs

| Право | super_admin | org_owner | org_admin | manager | operator | reviewer | analyst | service_user | read_only |
|-------|:-----------:|:---------:|:---------:|:-------:|:--------:|:--------:|:-------:|:------------:|:---------:|
| `audit:read_own_org` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `audit:read_all_orgs` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `audit:export` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

---

## 3. Доступ по сроку действия (Temporal Access)

### Механизм

```
Membership.valid_from  — начало доступа (по умолчанию: now())
Membership.valid_until — конец доступа  (NULL = бессрочно)
```

### Алгоритм проверки (pseudocode)

```
function isTemporallyValid(membership):
    now = currentUtcTimestamp()

    if membership.valid_from > now:
        return DENY  -- доступ ещё не начался

    if membership.valid_until IS NOT NULL AND membership.valid_until <= now:
        return DENY  -- доступ истёк → автологаут + событие в audit_log

    return ALLOW
```

### Применение

| Сценарий | Конфигурация |
|----------|-------------|
| Временный подрядчик | `valid_until = now() + 30 days` |
| Сезонный оператор | `valid_from = 2026-06-01`, `valid_until = 2026-08-31` |
| Бессрочный сотрудник | `valid_until = NULL` |
| Отзыв мгновенный | `membership.status = 'suspended'` (без изменения дат) |

### Аудит событий при истечении

```
action: 'membership.expired'
payload: { membership_id, user_id, org_id, expired_at }
```

---

## 4. Tenant Membership Logic

### Правила членства

```
1. Пользователь может состоять в НЕСКОЛЬКИХ орг (разные Membership строки).
2. Права определяются по Membership конкретной org — никакого cross-tenant spillover.
3. JWT содержит: { user_id, org_id, role, permissions[], exp }.
4. При смене org пользователь получает новый JWT с другим org_id.
5. super_admin не имеет Membership — исключение; права проверяются через claims.
```

### JWT Claims структура

```json
{
  "sub":         "user-uuid",
  "org_id":      "org-uuid",
  "role":        "manager",
  "permissions": ["project:create", "upload:create", "enrichment:start", "..."],
  "valid_until": "2026-06-01T00:00:00Z",
  "exp":         1744000000,
  "iat":         1743913600,
  "iss":         "ecomkit-cp"
}
```

### Правило инвалидации токена

```
JWT exp (15 мин) < membership.valid_until

При истечении valid_until:
  - refresh token отклоняется
  - активные сессии завершаются (через Redis session store TTL)
  - audit event: membership.expired
```

### Приглашение пользователя

```
1. org_admin отправляет invite (POST /memberships)
2. Система создаёт Membership{status=invited} + отправляет email с magic link
3. Пользователь принимает → Membership{status=active}
4. Аудит: membership.invited, membership.accepted
```

---

## 5. Deny by Default

### Принцип

> Любой запрос, для которого нет явного `ALLOW`, считается `DENY`.

### Уровни применения

```
Layer 1 — API Gateway
  Запрос без валидного JWT → 401 Unauthorized

Layer 2 — Auth Middleware (каждый сервис)
  JWT невалиден / организация suspended → 403 Forbidden

Layer 3 — Permission Guard (route level)
  Нет нужного permission в JWT claims → 403 Forbidden

Layer 4 — Resource Guard (бизнес-логика)
  Ресурс принадлежит другому org_id → 403 Forbidden
  Membership.valid_until истёк → 403 Forbidden + logout

Layer 5 — Database (Postgres RLS)
  org_id в строке ≠ app.current_org_id → 0 rows (silently filtered)
```

### Ответы при отказе

| Сценарий | HTTP | Код ошибки |
|----------|------|-----------|
| Нет JWT / невалидный | 401 | `AUTH_TOKEN_MISSING` |
| Истёкший JWT | 401 | `AUTH_TOKEN_EXPIRED` |
| Org suspended | 403 | `ORG_SUSPENDED` |
| Нет permission | 403 | `PERMISSION_DENIED` |
| Ресурс другого tenant | 403 | `PERMISSION_DENIED` (не 404, чтобы не раскрывать существование) |
| Membership expired | 403 | `ACCESS_EXPIRED` |

---

## 6. Effective Permissions Calculation

### Алгоритм

```
function getEffectivePermissions(userId, orgId):

    # 1. Получить Membership
    membership = db.memberships.findOne({user_id, org_id, status != 'removed'})
    if not membership:
        return DENY_ALL

    # 2. Temporal check
    if not isTemporallyValid(membership):
        return DENY_ALL

    # 3. Org access check
    org = db.organizations.findOne({id: orgId})
    if org.status != 'active':
        return DENY_ALL

    # 4. ServiceAccess check (для запросов к Service Plane)
    serviceAccess = db.service_access.findOne({org_id, service_id, enabled: true})
    if not serviceAccess OR not isTemporallyValid(serviceAccess):
        return DENY_ALL

    # 5. Собрать permissions из роли
    role = db.roles.findOne({id: membership.role_id})
    permissions = db.role_permissions
                    .join(permissions)
                    .where({role_id: role.id})
                    .map(p => p.resource + ':' + p.action)

    # 6. super_admin shortcut
    if role.name == 'super_admin':
        return ALL_PERMISSIONS

    return permissions
```

### Кэширование

```
Пересчёт при:
  - смене роли пользователя
  - изменении permissions роли
  - изменении org.status
  - изменении membership.valid_until

Хранилище: Redis (TTL = JWT exp, ~15 мин)
Ключ: perm:{user_id}:{org_id}
```

---

## 7. Backend Guard Strategy

### Структура middleware (Node.js / Fastify)

```
Request
  │
  ▼
[1] JWT Verify Middleware
    - Проверяет RS256 подпись
    - Декодирует { user_id, org_id, role, permissions[], valid_until }
    - 401 если невалидный / истёкший
  │
  ▼
[2] Org Status Middleware
    - Проверяет org.status = 'active' (через Redis cache)
    - 403 ORG_SUSPENDED если нет
  │
  ▼
[3] Temporal Access Middleware
    - Проверяет membership.valid_until из JWT claims
    - 403 ACCESS_EXPIRED + logout если истёк
  │
  ▼
[4] Permission Guard (per route)
    - requirePermission('schema:approve')
    - Сверяет claims.permissions[]
    - 403 PERMISSION_DENIED если нет
  │
  ▼
[5] Resource Ownership Guard (per handler)
    - Проверяет resource.org_id === claims.org_id
    - 403 если нет (silently, как 404 не возвращаем)
  │
  ▼
[6] Postgres RLS
    - SET app.current_org_id = claims.org_id
    - DB-уровень гарантии tenant isolation
  │
  ▼
Handler
```

### Декоратор guard (пример интерфейса)

```typescript
// Route definition
fastify.post(
  '/schema/:id/approve',
  {
    preHandler: [
      requireAuth(),
      requirePermission('schema:approve'),
      requireServiceAccess('csv-enrichment'),
    ]
  },
  approveSchemaHandler
)
```

### Правила реализации

| Правило | Описание |
|---------|----------|
| **Checks only on backend** | Frontend никогда не является источником истины по правам |
| **No permission in URL** | Права не передаются в query params или headers от клиента |
| **Explicit resource check** | После permission check всегда проверяем `resource.org_id === jwt.org_id` |
| **Audit on deny** | Каждый 403 логируется в `audit_logs` с action `access.denied` |
| **No info leak** | 403 вместо 404 на чужих ресурсах (не раскрывать существование) |

---

## 8. Frontend Guard Strategy

> **Важно:** Frontend guards — UX-оптимизация, не security. Вся безопасность — на backend.

### Принципы

```
1. Права отображения получаем из JWT claims (уже есть в токене).
2. Никогда не принимаем решения о показе на основе role name — только по permissions[].
3. При 403 от API — перерисовываем UI без повторного запроса.
4. При ACCESS_EXPIRED — автоматический logout + редирект на /login.
```

### Паттерн компонент-guard

```typescript
// Компонент-обёртка
<PermissionGate permission="schema:approve">
  <ApproveButton onClick={handleApprove} />
</PermissionGate>

// Хук для условного рендера
const { can } = usePermissions()
{can('export:create') && <ExportButton />}

// Навигационный guard (Next.js middleware)
export function middleware(request: NextRequest) {
  const token = getToken(request)
  const required = routePermissions[request.nextUrl.pathname]
  if (required && !token?.permissions.includes(required)) {
    return NextResponse.redirect('/403')
  }
}
```

### Поведение при 403

| Ситуация | Поведение UI |
|----------|-------------|
| Кнопка без прав | Скрыта (не disabled — не показываем вообще) |
| API вернул 403 | Toast «Недостаточно прав» + лог в консоль |
| `ACCESS_EXPIRED` | Автологаут → `/login?reason=session_expired` |
| `ORG_SUSPENDED` | Блокирующий экран с сообщением о приостановке |

### Маппинг прав → UI элементы

| Permission | UI элемент |
|-----------|-----------|
| `schema:approve` | Кнопка «Подтвердить схему» |
| `collision:resolve` | Форма разрешения коллизии |
| `export:create` | Кнопка «Экспортировать» |
| `secret:rotate` | Кнопка «Ротировать ключ» |
| `user:invite` | Кнопка «Пригласить пользователя» |
| `audit:read_own_org` | Раздел «Аудит» в навигации |
| `enrichment:start` | Кнопка «Запустить обогащение» |

---

## Self-Review

### Проверка нарушений

| Пункт | Статус | Комментарий |
|-------|--------|-------------|
| Tenant isolation | ✅ | org_id в каждом check; RLS на DB уровне |
| Смешение CP / SP | ✅ нет | Права SP проверяются локально в сервисе через JWT |
| Permission check только backend | ✅ | Frontend — только UX |
| Secrets не на клиенте | ✅ | `secret:read` нет у **никакой** роли; только Vault+AI Gateway |
| Deny by default | ✅ | 5 слоёв отказа, явные ALLOW |
| Temporal access | ✅ | valid_until проверяется на middleware и в JWT claims |
| Audit при 403 | ✅ | `access.denied` событие на каждый отказ |
| State machines совместимы | ✅ | approval/resolve требуют нужных прав |
# Integration Contract

## Цель
Определить правила интеграции между Control Plane и моносервисами.

## Authentication / Authorization flow
1. Пользователь логинится через Control Plane.
2. Control Plane формирует token / session с claims.
3. При входе в конкретный сервис сервис валидирует token.
4. Сервис проверяет:
   - user_id
   - organization_id
   - active membership
   - service_enabled
   - access_expiry
   - role / permissions

## Required claims
- sub (user_id)
- organization_id
- membership_id
- roles
- permissions or permission references
- service_access map or service-specific claims
- exp
- session_id

## AI Provider config access
1. Моносервис не получает сырой ключ на клиент.
2. Ключ используется только на backend / worker стороне.
3. Доступ к provider config выполняется по policy:
   - local copy from control plane sync
   - or service-to-service secure fetch
4. Все обращения логируются.

## Revocation policy
- revoked access must block new mutations immediately;
- active long-running jobs follow configured revocation behavior:
  - complete current item then stop,
  - or stop immediately on next checkpoint.

## Audit propagation
- Control Plane логирует административные действия;
- моносервис логирует предметные действия;
- correlation_id обязателен для сквозной трассировки.

## Forbidden integration patterns
- прямой доступ CSV service к БД Control Plane;
- передача AI keys в frontend;
- доверие только frontend-флагам доступа;
- выполнение service authorization только на UI стороне.
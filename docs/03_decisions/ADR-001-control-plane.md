# ADR-001 Separate Control Plane

## Context
Платформа должна поддерживать множество моносервисов с единым управлением доступом, пользователями и AI provider configuration.

## Decision
Control Plane выделяется в отдельный bounded context и логический слой платформы.

## Rationale
- единая точка управления auth/authz;
- единая модель организаций и membership;
- повторное использование для будущих сервисов;
- снижение дублирования и хаоса.

## Consequences
+ расширяемость платформы;
+ единообразие доступа;
+ легче добавлять новые сервисы;
- повышается сложность интеграции между слоями;
- нужны чёткие integration contracts.

## Forbidden
- внедрять org/user/auth logic в предметный сервис как primary source of truth.
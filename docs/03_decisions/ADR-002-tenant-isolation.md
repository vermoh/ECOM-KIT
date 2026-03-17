# ADR-002 Tenant Isolation

## Context
Система обслуживает множество организаций.

## Decision
Все сущности содержат organization_id.

Все запросы фильтруются по tenant.

## Consequences
+ безопасность
+ простота
- усложнение аналитики

## Forbidden
- глобальные таблицы без tenant scope
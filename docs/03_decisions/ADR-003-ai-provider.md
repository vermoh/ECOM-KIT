# ADR-003 Centralized AI Provider Configuration

## Context
Система использует внешний AI provider для schema generation, enrichment и SEO tasks.

## Decision
Конфигурация AI provider управляется централизованно через Control Plane, с возможностью scoped overrides по policy.

## Rationale
- единый контроль ключей;
- auditability;
- возможность будущих лимитов и биллинга;
- единообразная политика retry/timeout/model selection.

## Consequences
+ безопаснее;
+ проще управлять доступом;
+ легче строить usage tracking;
- сервисы становятся зависимыми от integration contract;
- требуется secure propagation mechanism.

## Forbidden
- хранить AI provider key в plain text в сервисе;
- передавать key в frontend;
- позволять сервису самостоятельно “придумывать” источник ключа.
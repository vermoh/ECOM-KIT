# Antigravity Default Rules

## Purpose
Эти правила обязательны для всех задач по генерации web app, backend, frontend, API, jobs, integrations и документации в рамках данного проекта.

## 1. Source of truth priority
При любом конфликте документов использовать такой приоритет:
1. /docs/03_decisions/*
2. /docs/06_security/*
3. /docs/02_architecture/*
4. /docs/04_domain/*
5. /docs/01_product/*
6. /docs/05_api/*
7. /docs/09_engineering/*
8. /docs/08_services/*
9. /docs/10_ai/*

Запрещено молча игнорировать документы более высокого приоритета.

## 2. Architecture invariants
Всегда соблюдать:
- Control Plane и Service Plane разделены;
- tenant isolation обязателен;
- все долгие операции выполняются асинхронно через queue/worker;
- AI provider keys не выходят на frontend;
- backend является авторитетным уровнем проверки прав;
- enrichment запрещён до approval схемы;
- audit обязателен для критичных действий;
- service-to-service interaction идёт через явный integration contract;
- прямой cross-service DB access запрещён.

## 3. Web app generation rules
При генерации web app:
- сначала определить bounded context экрана;
- затем определить data dependencies;
- затем определить permissions;
- только потом генерировать UI и API integration;
- UI должен отражать состояния loading / empty / error / forbidden / success;
- все destructive и критические действия требуют подтверждения;
- все формы должны иметь явную валидацию;
- роль пользователя влияет на доступность действий и интерфейса, но backend остаётся финальной точкой контроля;
- wizard-like flows не должны позволять пропустить обязательные этапы без явного правила.

## 4. Backend generation rules
- controllers must stay thin;
- business logic only in services/use-cases;
- repositories are data access only;
- DTOs and persistence models are not the domain model;
- every tenant-scoped query must filter by organization_id or equivalent tenant key;
- permission checks must exist for critical mutations;
- no sync execution of long-running jobs;
- retries and failures must be explicit;
- status transitions must follow state machine docs;
- every external provider call must be wrapped with timeout/retry/error normalization logic.

## 5. Frontend generation rules
- UI architecture must be modular;
- avoid business-critical logic inside dumb UI components;
- route guards and component guards must align with permissions model;
- generated tables and forms must support realistic enterprise use-cases;
- pages must expose stage, status and user feedback clearly;
- never hide important uncertainty from the user;
- manual review UI must show AI suggestion and final accepted value separately.

## 6. Security rules
- never expose secrets in UI, logs or client bundles;
- never trust frontend-only permission checks;
- never access another tenant's data by assumption;
- always validate access_expiry on backend for protected actions;
- use deny-by-default semantics;
- avoid returning sensitive internals in error responses.

## 7. Documentation rules
При создании нового модуля, экрана или workflow:
- проверять, покрыт ли он текущими docs;
- если решения не хватает, сначала сформулировать недостающий doc fragment или ADR;
- не придумывать новую архитектуру без запроса;
- при важном новом решении предлагать новый ADR.

## 8. Output rules
Если задача на генерацию:
- сначала выдать краткий plan;
- затем structure/files/components/modules;
- затем code/specification;
- затем self-review against docs and invariants.

## 9. Mandatory self-review
После любой генерации проверять:
- tenant isolation
- auth/authz correctness
- async boundaries
- adherence to ADR
- state transition correctness
- audit coverage
- security leaks
- docs conflicts

Если есть нарушения, исправлять до финального результата.

## 10. Forbidden behaviors
Запрещено:
- объединять control plane и service plane в одну кодовую сущность без явного решения;
- делать “магические” fallback permissions;
- запускать enrichment без approved schema;
- читать/писать cross-tenant данные без авторизованного механизма;
- выполнять full pipeline в одном HTTP request;
- терять audit trail;
- изменять архитектурные решения молча;
- генерировать произвольные сущности, которых нет в модели, без явного обоснования.
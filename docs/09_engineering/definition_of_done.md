# Definition of Done

## Backend task is done when
- code compiles;
- module follows architecture rules;
- tenant scope enforced;
- permission checks present;
- validation added;
- errors mapped to standard error model;
- audit hooks added for critical mutations;
- tests added for primary business paths.

## Frontend task is done when
- UI reflects correct states;
- validation present;
- loading, empty, error states covered;
- permission-aware rendering present;
- no critical action without explicit confirmation;
- API integration uses typed contracts.

## Job / Worker task is done when
- retry policy defined;
- idempotency considered;
- status transitions explicit;
- failure path logged;
- recovery behavior defined.

## Documentation task is done when
- document is internally consistent;
- no conflict with ADR;
- source of truth is clear;
- terminology matches glossary.
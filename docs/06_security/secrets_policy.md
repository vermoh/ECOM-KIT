# Secrets Policy

## Scope
Документ покрывает управление:
- AI provider keys
- JWT secrets / signing keys
- database credentials
- redis credentials
- object storage credentials
- internal service secrets

## Rules
1. Секреты не хранятся в репозитории.
2. Секреты не выводятся в логи.
3. Секреты не передаются во frontend.
4. Секреты хранятся в encrypted storage / secret manager или эквивалентном безопасном механизме.
5. AI provider keys шифруются at rest.
6. Доступ к секретам ограничивается минимально необходимым числом сервисов и ролей.
7. Изменение секрета логируется как событие без раскрытия значения.
8. Ротация должна быть поддержана архитектурно.

## AI Provider Key policy
- organization-level key хранится отдельно от user-level overrides;
- plaintext недоступен после сохранения;
- при отображении в UI допускается только masked representation;
- использование ключа происходит только на сервере.

## Operational Requirements
- env variables only for runtime injection, not as persistent source of truth for tenant-level secrets;
- production secrets must support rotation without redeploy where feasible.
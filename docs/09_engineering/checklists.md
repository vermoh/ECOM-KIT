# Production & Security Checklists

## 1. Production Readiness Checklist
- [ ] **Structured Logging**: Все сервисы пишут в JSON, `correlation_id` прокидывается.
- [ ] **Metrics Scrapping**: Prometheus успешно собирает данные с `/metrics` всех сервисов.
- [ ] **Retention Policies**: Настроена ротация логов и очистка старых задач в Redis.
- [ ] **Health Checks**: Настроены Liveness и Readiness пробы в оркестраторе.
- [ ] **Backups**: Проверено восстановление из ежедневных бэкапов БД.
- [ ] **S3 Versioning**: Включено для бакета с пользовательскими CSV.

## 2. Security Checklist
- [ ] **Audit Logging**: Любой 403 Forbidden логируется с экшеном `access.denied`.
- [ ] **Tenant Isolation**: Включена и проверена PostgreSQL RLS (Row Level Security).
- [ ] **Secret Rotation**: Секреты (DB, Redis, AI Keys) хранятся во внешнем Secret Manager.
- [ ] **Minimial Privileges**: Сервисы имеют доступ только к своим очередям и бакетам.
- [ ] **AI Key Protection**: Ключи AI провайдеров зашифрованы at rest и не передаются на UI.
- [ ] **Cost Protection**: Установлены жесткие лимиты токенов на тенанта (AccessGrant).
- [ ] **Validation Guard**: Все входные CSV валидируются на worker-стороне перед AI-процессингом.

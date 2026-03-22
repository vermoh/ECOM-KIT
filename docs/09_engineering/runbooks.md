# Runbooks

## RB-001: Investigating Job Failures
1. **Identify**: Откройте `BullBoard` и найдите задачи в статусе `FAILED`.
2. **Trace**: Скопируйте `correlation_id` из данных задачи.
3. **Log Search**: Выполните поиск по `correlation_id` в системе сбора логов (Elasticsearch/Loki).
4. **Analyze**: Разделите ошибки на `data-related` (кривой CSV) и `system-related` (AI timeout, S3 error).
5. **Resolve**: 
   - При ошибках данных: обновите статус `UploadJob` и уведомьте пользователя.
   - При системных ошибках: проверьте мониторинг провайдера AI или инфраструктуры.

## RB-002: AI Provider Latency / Outage
1. **Symptom**: Дашборд "AI Provider" показывает рост `request_duration` > 30s или `errors_total` > 5%.
2. **Mitigation**:
   - Проверьте [OpenRouter Status](https://status.openrouter.ai/).
   - При сбое конкретной модели: переключите модель в настройках Control Plane (для всех или конкретного тенанта).
   - При глобальном сбое: временно приостановите воркеры обогащения, чтобы не тратить попытки ретраев.

## RB-003: High Database Connection Usage
1. **Symptom**: Метрика `active_connections` приближается к `max_connections` (80%+).
2. **Action**:
   - Проверьте топ медленных запросов.
   - Если проблема в `enrichment_worker`: проверьте размер пула соединений в `shared-db`.
   - Если проблема в утечке соединений: перезапустите соответствующие инстансы API.

## RB-004: Tenant Budget Depletion
1. **Symptom**: Задачи тенанта падают с ошибкой `OUT_OF_BUDGET`.
2. **Mitigation**:
   - Проверьте `UsageLogs` тенанта в базе.
   - Уведомите тенанта через систему тикетов или email.
   - При необходимости ручного пополнения: обновите `AccessGrant` лимиты в Control Plane.

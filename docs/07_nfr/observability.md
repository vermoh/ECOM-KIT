# Observability

## Goals
- видеть состояние системы и jobs;
- быстро находить причину ошибок (MTTR < 15 min);
- отслеживать деградацию качества AI processing;
- контролировать стоимость AI usage по каждому тенанту.

## Logging
Все сервисы используют **Pino** для генерации structured logs в JSON формате.
### Обязательные поля:
- `timestamp`: ISO-8601;
- `level`: info, warn, error, fatal;
- `service_name`: e.g., `csv-service-worker`;
- `correlation_id`: сквозной ID для трассировки запроса;
- `organization_id`: UUID организации;
- `user_id`: UUID инициатора (если применимо);
- `action`: e.g., `enrichment.started`, `access_denied`;
- `metadata`: объект со специфичными данными (e.g., `job_id`, `tokens_used`).

## Metrics (Prometheus / Grafana)
### Infrastructure Metrics:
- `requests_total`: общее кол-во запросов (по кодам ответа);
- `request_duration_seconds`: гистограмма задержек;
- `active_connections`: кол-во активных соединений к БД/Redis.

### Job/Pipeline Metrics:
- `csv_worker_jobs_processed_total`: по типу и статусу;
- `csv_worker_items_enriched_total`: кол-во успешно обработанных SKU;
- `csv_worker_collision_rate`: % коллизий от общего объема;
- `bull_job_wait_time`: время нахождения задачи в очереди.

### AI Cost Metrics:
- `csv_worker_tokens_consumed_total`: (labels: `org_id`, `model`, `purpose`);
- `ai_provider_errors_total`: (labels: `provider`, `error_code`).

## Tracing
- **X-Correlation-ID**: обязательный хедер для всех межсервисных вызовов;
- **BullMQ Job Data**: `correlationId` передается в данных задачи для связки API -> Worker.

## Job Monitoring & DLQ
- **Dashboard**: Для оперативного мониторинга очередей используется **BullBoard** (доступ только `super_admin`).
- **DLQ Strategy**: 
  - Ремонтопригодные ошибки: 3 попытки, экспоненциальный backoff.
  - Критичные ошибки: перевод в статус `FAILED`, логирование `correlation_id` для расследования.

## Dashboards
1. **System Health**: CPU, Ram, DB connections, Redis throughput.
2. **Business Pipeline**: Скорость обработки CSV, ошибки обогащения, коллизии.
3. **AI Provider Dashboard**: Usage, Quotas, Latency per provider.
4. **Security Audit**: `access.denied` events, token refresh failures.

## Retention
- **Application Logs**: 30 дней (Hot storage).
- **Audit Logs**: 90 дней (Compliance).
- **Usage Metrics**: 1 год (для биллинга).
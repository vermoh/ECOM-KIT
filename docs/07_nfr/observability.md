# Observability

## Goals
- видеть состояние системы и jobs;
- быстро находить причину ошибок;
- отслеживать деградацию качества AI processing;
- контролировать стоимость AI usage.

## Logging
Все сервисы должны писать structured logs со следующими полями:
- timestamp
- level
- service_name
- environment
- correlation_id
- request_id if applicable
- user_id if available
- organization_id if available
- action
- target_type
- target_id
- message
- metadata

## Metrics
Минимальный набор:
- requests_total
- request_duration
- auth_failures_total
- active_jobs
- failed_jobs_total
- retry_count
- collision_rate
- enrichment_success_rate
- export_duration
- ai_provider_latency
- ai_provider_errors_total
- ai_token_usage if available
- ai_cost_estimate if available

## Tracing
- correlation_id обязателен между Control Plane, CSV Service API и Worker;
- long-running job должен иметь job_id как traceable entity;
- integration calls to AI provider должны быть трассируемы.

## Alerts
Нужны оповещения при:
- росте failed_jobs;
- недоступности AI provider;
- массовых authorization errors;
- росте collision rate выше baseline;
- проблемах object storage;
- queue backlog выше порога.

## Dashboards
Минимум:
1. Platform Health
2. CSV Pipeline Health
3. AI Usage and Cost
4. Access / Security anomalies

## Retention
- application logs: по policy окружения;
- audit logs: минимум 90 дней или по бизнес-политике;
- job execution history: минимум достаточно для расследования инцидентов и поддержки пользователей.
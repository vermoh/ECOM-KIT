# Self-Review (Draft Validation)
**Найденные проблемы при первичном формировании фаз:**
1. **Нарушение Audit-лога:** В черновике не было явно прописано отправка audit-событий из Service Plane в Control Plane для фиксации предметных действий.
2. **Безопасность ключей провайдеров:** Не было специфицировано, как Worker (Service Plane) получает зашифрованный API ключ из Control Plane (требуется `AccessGrant`).
3. **State Machines:** Завершение `ExportJob` не переводило основную зависимость `UploadJob` в статус `DONE`.
4. **Tenant Isolation для S3:** Не везде явно указывался префикс `{org_id}` для временных файлов.

---

# Исправленная версия

## 1. Plan

Реализация разделена на 11 фаз, начиная от фундаментальных настроек Control Plane (CP) и Service Plane (SP), через систему авторизации и управления тенантами, к основному бизнес-пайплайну (загрузка CSV, генерация схемы, обогащение через AI, проверка коллизий и экспорт результатов).
Процесс завершается подготовкой к SaaS-формату (биллинг и лимиты).

## 2. Structure

Строгое разделение:
- **Control Plane**: `Organization`, `User`, `Membership`, `Role`, `Permission`, `ProviderConfig`, `Service`, `AccessGrant`, `AuditLog`.
- **Service Plane (CSV Enrichment)**: `Project`, `UploadJob`, `SchemaTemplate`, `SchemaField`, `EnrichmentRun`, `EnrichedItem`, `Collision`, `ReviewTask`, `ExportJob`, `SEOGenerationTask`.
Все интеграции между слоями — по HTTP с валидацией JWT и `AccessGrant`. Long-running processing исключительно через очереди. Основные UI-модули подключаются к CP (авторизация) и к SP (предметная область).

## 3. Implementation

### Phase 0: Foundation
- **Цель**: Настройка монорепозитория, инфраструктуры БД и логического разделения CP/SP.
- **User stories**: Как разработчик платформы, я хочу иметь базовый контур микросервисов для начала работы.
- **Backend tasks**: Инициализация Fastify/Node для CP и SP. Настройка Error Handler (401, 403, 500) с Deny-by-default архитектурой.
- **Frontend tasks**: Развёртывание Next.js с UI-kit (shadcn/ui). Настройка базового роутинга.
- **Database tasks**: Инициализация Postgres с RLS (Row-Level Security) для изоляции тенантов, миграции.
- **Infra tasks**: `docker-compose.yml` (pg, redis, mq), базовая настройка пайплайна CI/CD.
- **Acceptance criteria**: Контейнеры запускаются локально. Подключение к БД работает. RLS гарантированно фильтрует по `app.current_org_id`.
- **Definition of done**: Код замержен в `main`, сервисы отвечают HTTP 200 на `/health`.

### Phase 1: Auth
- **Цель**: Аутентификация и выпуск JWT токенов с claims.
- **User stories**: Как зарегистрированный пользователь, я хочу войти в систему и получить доступ.
- **Backend tasks**: CRUD для `User`. Эндпоинты Login/Logout. Хэширование паролей. Генерация JWT (содержащего `sub`, `org_id`, `permissions`). JWT Middleware Guard. Запись в `AuditLog` (`user.login`).
- **Frontend tasks**: Страница логина. AuthContextProvider + интерцепт 401 запросов (редирект на `/login`).
- **Database tasks**: Таблица `User`.
- **Infra tasks**: Redis для хранения сессий и работы с refresh-токенами.
- **Acceptance criteria**: Вход возможен по валидным кредам. Отказ (HTTP 401) при неверных. Guard отклоняет запросы без JWT.
- **Definition of done**: Тесты авторизации пройдены, эндпоинты защищены.

### Phase 2: Organizations (Tenant Isolation & RBAC)
- **Цель**: Multitenancy, роли, членство в организациях.
- **User stories**: Как admin, я хочу приглашать пользователей и управлять их ролями.
- **Backend tasks**: CRUD `Organization`, `Membership`, `Role`, `Permission`. Endpoint отправки invites. Middleware `Org Status` и `Temporal Access` (`valid_until`). Расчёт Effective Permissions. Запись в AuditLog всех изменений доступа.
- **Frontend tasks**: Дашборд организации, экран участников. Форма приглашения. `PermissionGate` компонент.
- **Database tasks**: Таблицы `Organization`, `Membership`, `Role`, `RolePermission`. Настройка жесткого RLS для всего слоя SP по `org_id`.
- **Infra tasks**: Mock сервиса отправки email-инвайтов.
- **Acceptance criteria**: JWT содержит только права текущей org. Истёкший `valid_until` даёт 403. Пользователи видят только свои Org.
- **Definition of done**: Security matrix (RBAC) полностью соблюдена и покрыта API тестами.

### Phase 3: Service Registry
- **Цель**: Межсервисное взаимодействие и безопасное хранение ключей AI провайдеров.
- **User stories**: Как org_owner, я хочу безопасно ввести ключ OpenRouter, чтобы модули могли его использовать.
- **Backend tasks**: CRUD `ProviderConfig` (через AES-256-GCM). Механизм выдачи и проверки `AccessGrant` для межсервисных вызовов от SP к CP.
- **Frontend tasks**: UI настроек ключей провайдеров (только запись и удаление, чтение `secret:read` запрещено). Дашборд управления сервисами для `super_admin`.
- **Database tasks**: Таблицы `Service`, `ServiceAccess`, `AccessGrant`, `ProviderConfig`.
- **Infra tasks**: Настройка хранилища мастер-ключа для Vault/KMS.
- **Acceptance criteria**: Worker SP запрашивает ProviderConfig у CP через кратковременный AccessGrant. Secret никогда не отдаётся на клиент.
- **Definition of done**: Межсервисная аутентификация работает, тестовый ключ провайдера расшифровывается в Worker'е.

### Phase 4: CSV Upload
- **Цель**: Приём файлов, парсинг и создание задачи обогащения.
- **User stories**: Как operator (если есть permission `upload:create`), я хочу загрузить CSV для бизнес обработки.
- **Backend tasks**: CRUD `Project`. Генерация S3 pre-signed URL. Сохранение файла с префиксом `{org_id}/{job_id}/`. Создание `UploadJob` (состояние `PENDING`). Асинхронный воркер парсинга. Обновление статуса в `PARSING` -> `PARSED`.
- **Frontend tasks**: Контейнер проектов, форма Drag-and-Drop загрузки. Long-polling/WebSocket для UI апдейта Job status.
- **Database tasks**: Таблицы `Project`, `UploadJob`. Внедрение RLS.
- **Infra tasks**: Настройка S3-хранилища (MinIO локально). RabbitMQ / BullMQ для очередей задач.
- **Acceptance criteria**: Файл изолированно сохранен в корзине, UploadJob создан, `row_count` рассчитан.
- **Definition of done**: Покрытие тестами больших потоковых CSV без блокировки API.

### Phase 5: Schema Generation
- **Цель**: AI-генерация структуры характеристик с Human-in-the-loop подтверждением.
- **User stories**: Как reviewer, я хочу проверить предложенную AI схему и доработать её.
- **Backend tasks**: Очередь `GenerateSchemaJob`. Worker обращается к AI Gateway (используя AccessGrant + ProviderConfig). Переход UploadJob в `SCHEMA_DRAFT`. Определение `ReviewTask`(`schema_review`). Endpoints апдейта свойств `SchemaField` и подтверждения (`schema:approve`). Push audit events в CP напрямую.
- **Frontend tasks**: UI редактора схемы `SchemaField` (типы, constraints / is_required). Кнопки "Confirm/Reject".
- **Database tasks**: `SchemaTemplate`, `SchemaField`, `ReviewTask`.
- **Infra tasks**: Интеграция AI Gateway/Моков на уровне Worker.
- **Acceptance criteria**: Шаблон генерируется, пользователь с правом `schema:approve` может править атрибуты. Подтверждение переводит UploadJob в `SCHEMA_CONFIRMED`.
- **Definition of done**: Схема сохраняется с версионированием.

### Phase 6: Enrichment Worker
- **Цель**: Асинхронное AI-обогащение строк (SKU).
- **User stories**: Как manager, я хочу запустить процесс обогащения по подтверждённой схеме.
- **Backend tasks**: Endpoint запуска `enrichment:start`. Worker Service Plan читает CSV, за счет AccessGrant берёт ключи провайдера. Для каждой строки запрашивает AI, сохраняет результаты в `EnrichedItem`. Сборщик статистики(`tokens_used`, `processed_items`). Статус UploadJob: `ENRICHING -> ENRICHED`.
- **Frontend tasks**: Просмотр состояния задачи с progress bar.
- **Database tasks**: `EnrichmentRun`, `EnrichedItem`.
- **Infra tasks**: Limit Concurrency для AI Provider Rate Limits + Retry Strategy.
- **Acceptance criteria**: Строки (до 100 000 SKU) обогащаются в фоне. API `enrichment:start` завершается синхронно (Task Accepted).
- **Definition of done**: Worker корректно выдерживает сбои сети API и восстанавливает state.

### Phase 7: Collision Review
- **Цель**: Разрешение конфликтов значений от AI (human-in-the-loop).
- **User stories**: Как reviewer, я хочу вручную исправить сомнительные данные или разрешить дубли.
- **Backend tasks**: Детекция коллизий в финале EnrichmentWorker. Создание записей `Collision`. Перевод UploadJob в `NEEDS_COLLISION_REVIEW`. Endpoint резолва (проверяет право `collision:resolve`). Отправка audit лога на CP.
- **Frontend tasks**: UI попарного сравнения/списка коллизий с возможностью ручного ввода текста.
- **Database tasks**: `Collision`.
- **Infra tasks**: Специфичных нет.
- **Acceptance criteria**: UploadJob не переходит в `READY`, пока остаются коллизии со статусом `open`. Игнор/резолв коллизии разрешает UploadJob к экспорту.
- **Definition of done**: Экспорт 100% заблокирован при `open` коллизиях. Разрешение всех коллизий переводит UploadJob в `READY`.

### Phase 8: Export
- **Цель**: Выгрузка итогового CSV-файла.
- **User stories**: Как analyst, я хочу запросить выгрузку и скачать результат.
- **Backend tasks**: Endpoint генерации `ExportJob`. Worker компилирует `EnrichedItem` обратно в CSV-формат (с учетом Schema). Сохраняет в S3 (`{org_id}/exports/...`). Генерирует 1-часовой pre-signed URL. UploadJob `READY -> EXPORTING -> DONE`.
- **Frontend tasks**: Кнопка экспорта, получение временной ссылки.
- **Database tasks**: `ExportJob`.
- **Infra tasks**: S3 Lifecycle policy для очистки экспортированных файлов через 24h.
- **Acceptance criteria**: Ссылка живёт не более 1 часа. CSV содержит только данные требуемого. `UploadJob.status` становится `DONE`.
- **Definition of done**: Worker экспорта успешно справляется с объемами >100к строк и лимитированной RAM.

### Phase 9: SEO
- **Цель**: Постобработка для генерации SEO-атрибутов.
- **User stories**: Совместно с обогащением я хочу получить SEO-описания для экспорта на E-Com площадку.
- **Backend tasks**: `SEOGenerationTask` стартует только если `EnrichmentRun.status=completed`. Добавляет префикс `seo_` в `EnrichedItem.enriched_data`.
- **Frontend tasks**: Выбор "Включить SEO генерацию" при старте/настройке.
- **Database tasks**: `SEOGenerationTask`.
- **Infra tasks**: Специфичных нет.
- **Acceptance criteria**: При наличии включенного SEO пайплайн ожидает окончания SEO-воркера перед переходом в `READY`.
- **Definition of done**: Экспортируемый CSV автоматически расширяется полями `seo_*`.

### Phase 10: SaaS Readiness
- **Цель**: Биллинг, квотирование токенов, production metrics.
- **User stories**: Владелец Control Plane (супер-админ) хочет контролировать списание токенов с тенантов.
- **Backend tasks**: Внедрение `TokenBudgetGuard` перед AI Gateway. Интеграция платежной системы (Stripe Webhooks). Вывод метрик Prometheus.
- **Frontend tasks**: Dashboard потребления бюджета организации. Страница биллинга для `org_owner`.
- **Database tasks**: Таблицы биллинга/учета токенов в CP.
- **Infra tasks**: Дашборды Grafana, alerting на лимиты.
- **Acceptance criteria**: При перерасходе лимита (по тарифному плану) EnrichmentRun останавливается или уходит в paused().
- **Definition of done**: Система готова к onboarding реальных enterprise клиентов.

---

## 4. Self-review & Rule Validation

1. **Tenant Isolation:** Жёстко обеспечено на 3 слоях. Postgres RLS не позволит запросам SP прочитать чужие строки даже при программной ошибке; префиксы ключей S3 разделены (`{org_id}/...`); `org_id` прошит во всём API.
2. **CP vs SP:** Роли, токены, ключи провайдеров — строго в базе CP. Задачи, CSV проекты и схемы хранятся строго в базах SP. Взаимодействие только через `integration_contract` и выдачу AccessGrant.
3. **Permission Checks Backend:** Внедрена архитектура Deny-by-default. На каждом endpoint висит Explicit Guard (`permission:action`).
4. **No sync Long-Running:** Все ресурсоемкие задачи (загрузка, генерация схем, энричмент, экспорт, SEO) вынесены в Async Workers (ADR-004 Job Processing).
5. **State Machines:** Цикл `UploadJob` (PENDING -> PARSING ... -> DONE) полностью соблюден, так же как параллельные стейты из [state_machines.md](file:///Users/vitalik/Antigravity/ECOM%20KIT/docs/04_domain/state_machines.md).
6. **No Secret Leaks:** Зашифрованный `provider_config.encrypted_value` ни разу не пересекает границу HTTP response для Dashboard Fronted; расшифровывается только внутри Backend AI Gateway Connector.
7. **ADR Alignment:** Service/Control Plane ADR-001, Tenant Proxy ADR-002, Async ADR-004 валидированы и имплементированы в дизайне фаз.
8. **Audit Coverage:** Мутирующие события (включая события от SP вроде `schema_approved` или `collision_resolved`) отправляют audit payload в CP для фиксации.
9. **Canonical Model:** Data Dictionary строго соблюдается; дополнительных Data Entities не изобретено.

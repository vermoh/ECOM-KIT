# CSV Pipeline

> **Версия:** 1.0  
> **Дата:** 2026-03-17  

Асинхронный отказоустойчивый пайплайн строится на базе Service Plane (CSV Enrichment Service). Используется архитектура Event-Driven/Message Queue для долгих задач (ADR-004). Все данные изолированы по `org_id`. Ручной контроль (Human-in-the-loop) реализован через сущность `ReviewTask` и явные Backend Guards.

## Этапы

### 1. Upload (Загрузка CSV)
* **Input:** Multipart CSV file c базовыми колонками (sku, name, categories, attributes), JWT token, `project_id`.
* **Processing:** Авторизация (`upload:create`). Валидация размера, запись сырого файла в S3 (`{org_id}/{job_id}/raw.csv`).
* **Output:** Создание сущности `UploadJob` (status = `PENDING`). HTTP 202.
* **Failure Modes:** Превышен лимит плана, битый файл, S3 timeout.
* **Retry Policy:** На UI — ручной повтор.
* **Human Checkpoints:** Отсутствуют.
* **Storage Artifacts:** Сырой CSV в S3, запись `UploadJob` в БД. Состояние: `PENDING`.

### 2. Validation (Первичный Парсинг и Валидация)
* **Input:** S3 URI из `UploadJob`.
* **Processing:** Асинхронный воркер читает файл, подсчитывает `row_count`, парсит заголовки, проверяет базовые обязательные поля (например, уникальность `sku` в рамках файла). Состояние: `PARSING`.
* **Output:** Job status update: `PARSED` (или `FAILED`).
* **Failure Modes:** OOM kill (огромный файл), неверная кодировка, отсутствие `sku`.
* **Retry Policy:** Exponential backoff до 3 раз при инфраструктурной ошибке; если ошибка формата — fail fast без retries.
* **Storage Artifacts:** Обновление сущности `UploadJob` (row_count).

### 3. Normalization & 4. Category Understanding (Понимание структуры)
*Эти логические шаги объединены в шаг перед сборкой схемы.*
* **Input:** Сырые данные из CSV (сэмпл до 100 строк) и контекст `org_id`.
* **Processing:** AI анализирует уникальные значения `category` и `brand`, приводит их к единому регистру. Определяет, к какому домену относятся товары.
* **Output:** Внутреннее представление (JSON) для построения шаблона характеристик.
* **Failure Modes:** Провайдер LLM недоступен, timeout, rate limit (429).
* **Retry Policy:** Авто-retry с jitter на AI вызовы.

### 5. Schema Generation (Генерация шаблона)
* **Input:** Нормализованные категории и примеры атрибутов.
* **Processing:** AI генерирует `SchemaTemplate` и массив `SchemaField` (названия, типы данных: enum, boolean, text, required-флаги). Выделение фильтров: схлопывание синонимов атрибутов в `allowed_values` для enum.
* **Output:** `SchemaTemplate` в статусе `draft`. `UploadJob` переходит в `SCHEMA_DRAFT`. Создается задача `ReviewTask` (type: `schema_review`, status: `pending`).
* **Storage Artifacts:** БД записи: `SchemaTemplate` + `SchemaField` (v1).

### 6. Human Review (Валидация схемы человеком)
* **Input:** `SchemaTemplate` (draft).
* **Processing:** Пользователь с ролью `reviewer` или `manager` просматривает предложенную схему, правит типы/названия полей (Backend guard: `requirePermission('schema:approve')`).
* **Output:** При подтверждении статус `UploadJob` меняется на `SCHEMA_CONFIRMED`. `ReviewTask` переходит в `completed`. Схема переходит в `confirmed`, сохраняются AuditLog и ID `confirmed_by`.
* **Failure Modes:** Пользователь может отклонить (rejected) — AI перегенерирует схему (инкремент версии, возврат к п.5).
* **Storage Artifacts:** `AuditLog` с `action: schema.approved`.

### 7. Enrichment (Обогащение товаров)
* **Input:** Подтверждённый `SchemaTemplate`, сырые данные из S3.
* **Processing:** Запускается `EnrichmentRun` (требует `enrichment:start`). Воркер батчами читает CSV, отправляет промпты с жесткой JSON-схемой к ИИ. Каждый SKU мапится, характеристики извлекаются в `EnrichedItem`. Паузалика: батчевая обработка позволяет останавливать обогащение по команде пользователя или исчерпанию лимита (`paused`). Прогресс сохраняется в `processed_items`.
* **Output:** Записи `EnrichedItem` (`enriched_data`, `confidence`).
* **Failure Modes:** Ошибки галлюцинаций, rate limits AI, нехватка Token Budget.
* **Retry Policy:** Идемпотентные воркеры. При падении продолжают с непокрытых SKU (`EnrichedItem` сохраняется атомарно).
* **Storage Artifacts:** Записи `EnrichedItem` в БД. Состояние `UploadJob` = `ENRICHED`.

### 8. Confidence Scoring & 9. Collision Detection
* **Processing:** Воркер анализирует все `EnrichedItem`. Если: `confidence` < порога, выдан `out_of_range`, найден `duplicate_sku` или товар неоднозначный (под две категории) — создается запись агрегата `Collision` (status = `open`).
* **Output:** Если есть `open` коллизии, статус работы → `NEEDS_COLLISION_REVIEW`. Создаётся `ReviewTask` (type = `collision_review`).
* **Storage Artifacts:** Таблица `Collision`.

### 10. Manual Resolution (Ручное разрешение коллизий)
* **Input:** Список коллизий (`open`).
* **Processing:** Пользователь (с правом `collision:resolve`) выбирает правильное значение (`value_a` / `value_b`) или вписывает `resolved_value`.
* **Output:** Запись БД `Collision` (status = `resolved`, `resolved_by`), обновление JSON в `EnrichedItem`. Когда все коллизии `resolved` / `ignored`, флаг `UploadJob` → `READY`.
* **Storage Artifacts:** `AuditLog` (`action: collision.resolved`).

### 11. Export (Генерация результата)
* **Input:** Список готовых `EnrichedItem` в привязке к Job.
* **Processing:** Если статус `READY`, пользователь запускает экспорт (`export:create`). Инициируется `ExportJob` (status = `generating`). Воркер собирает CSV файл, грузит в S3 (`{org_id}/{job_id}/result.csv`).
* **Output:** Генерируется Pre-signed URL с TTL 1 час. `UploadJob` → `DONE`. `ExportJob` → `ready`.
* **Failure Modes:** Ошибки I/O S3, OOM на огромных файлах.
* **Storage Artifacts:** Итоговый файл в S3, строка `ExportJob` в БД.

### 12. SEO Generation (Опционально)
* **Input:** Обогащённый `EnrichmentRun` (статус `completed`).
* **Processing:** Запускается `SEOGenerationTask` (`seo:start`). Специфичный воркер пишет многоязычное SEO-описание (title, description).
* **Output:** Добавление ключа вида `seo_ru`, `seo_en` в `EnrichedItem.enriched_data`.

## Правила
- Enrichment запрещён без `confirmed` схемы.
- Все длительные вычисления выполняются в queue (`ADR-004`).
- `AuditLog` обязателен для всех Human Checkpoints (`confirmed`, `resolved`).
- Секреты (AI keys) запрашиваются только Backend worker'ом из Vault.
- Строгая изоляция s3 ключей по `{org_id}`.
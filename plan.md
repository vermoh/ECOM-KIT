# Improvement Plan — AI Enrichment Quality

Декомпозированный план по улучшению качества AI-обогащения CSV-каталогов.
Каждый этап — самодостаточная завершённая единица работы, результат которой можно протестировать сразу.

**Статусы:** `[ ]` не начато · `[→]` в работе · `[x]` завершено

---

## Спринт 1 — Быстрые улучшения промптов
> ~1 день работы. Изменения только в `ai.ts`, деплой без миграций.

### 1.1 Температура и детерминизм
- [x] Добавить `temperature: 0.2` в вызовы `enrichItem` и `generateSchemaSuggestion`
- [x] Добавить `temperature: 0.7` в `generateSeoAttributes` (SEO требует вариативности)
- [x] Убедиться что `top_p` не переопределён (должен быть дефолтным)

**Проверка:** запустить обогащение одного и того же файла дважды — значения должны совпадать на 90%+.

---

### 1.2 Chain-of-thought в enrichItem
- [x] Добавить в промпт `enrichItem` шаг рассуждения перед JSON:
  ```
  Before filling the fields, briefly analyse:
  - Product type and niche
  - Brand (if identifiable)
  - Key characteristics visible in the name/description
  Then fill all fields based on this analysis.
  ```
- [x] Переместить анализ в отдельный `<thinking>` блок, а JSON оставить как финальный вывод
- [x] Проверить что `response_format: json_object` совместим с этим (если нет — убрать json_object и парсить вручную)

**Проверка:** качество заполнения полей для продуктов с короткими названиями (например `Cola Ice`).

---

### 1.3 Few-shot примеры в enrichItem → ПЕРЕРАБОТАНО в универсальный подход (Вариант C)
- [x] ~~Хардкод по категориям~~ → Заменено на `generateFewShotExamples()` (авто-генерация из реальных данных + схемы)
- [x] Добавлено поле `catalogContext` (text) в таблицу `upload_jobs` — пользователь описывает домен каталога
- [x] `catalogContext` инжектируется в промпты `generateSchemaSuggestion` и `enrichItem`
- [x] `generateFewShotExamples(sampleRows, schemaFields, apiKey, catalogContext)` — 1 AI-вызов на старте enrichment run
- [x] UI: textarea "Catalog description" в `ProjectUpload.tsx`, передаётся через API → DB → worker
- [x] Удалены `detectRowCategory()` и `buildFewShotExamples()` (hardcoded vape/tobacco)

**Проверка:** для продукта `HQD EOS 600 Lemon Lime` должны корректно заполняться `puff_count`, `flavor`, `nicotine_content`.

---

## Спринт 2 — Двухэтапная генерация схемы
> ~0.5 дня. Изменения в `ai.ts` и `worker.ts` (processSchemaJob).

### 2.1 Этап A — анализ категорий
- [x] Добавить функцию `analyseProductCatalog(sampleRows, apiKey)` в `ai.ts`
- [x] Промпт: *"Identify all distinct product categories/niches in this catalog. For each category list its key commercial and technical attributes."*
- [x] Модель: `gpt-4o` (однократный вызов, высокое качество важнее стоимости)
- [x] Результат: `{ categories: [{ name, attributes: string[], exampleRow }] }`

### 2.2 Этап B — генерация полей на основе анализа
- [x] Переписать `generateSchemaSuggestion` чтобы принимал результат этапа A
- [x] Промпт: *"Based on this catalog analysis, propose enrichment fields. For each category suggest specific fields, then identify universal fields applicable to all products."*
- [x] Дедупликация полей между категориями — поля с одинаковым смыслом должны стать одним полем
- [x] Обновить вызов в `processSchemaJob`: сначала `analyseProductCatalog`, потом `generateSchemaSuggestion`

**Проверка:** для `products2.csv` схема должна содержать и `puff_count` (для одноразовых), и `volume_ml` (для жидкостей), и `joint_size_mm` (для стекла) — то есть поля из разных ниш.

---

## Спринт 3 — Маршрутизация по категориям
> ~1 день. Изменения в `ai.ts` и `worker.ts`.

### 3.1 Определение категории строки
- [x] Добавить функцию `detectRowCategory(row, knownCategories)` в `ai.ts`
- [x] Логика: сначала проверить явное поле категории, затем keyword overlap scoring по названию/описанию
- [x] Результат кешировать в `categoryHintCache` воркера (одна категория → один hint)

### 3.2 Category-specific system prompts → АДАПТИРОВАНО: динамические hints из Stage A анализа
- [x] ~~Хардкод промптов~~ → `buildCategoryHint(category)` строит hint из `CatalogAnalysis`
- [x] `catalogAnalysis` сохраняется в `schemaTemplates.catalog_analysis` при генерации схемы
- [x] Загружается в `processEnrichmentJob`, матчится к каждой строке через `detectRowCategory`
- [x] Инжектируется как `PRODUCT CATEGORY DETECTED: ... Key attributes: ...` блок в промпт `enrichItem`
- [x] Полностью универсальный — работает с любыми товарами без хардкода

**Проверка:** `Pod VAPORESSO XROS 5 MINI` — `battery_mah`, `resistance_ohm`, `refillable` должны заполняться корректно.

---

## Спринт 4 — Structured outputs
> ~0.5 дня. Изменения только в `ai.ts`.

### 4.1 JSON Schema для enrichItem
- [x] Добавить функцию `buildEnrichmentJsonSchema(schemaFields)` → JSON Schema объект
- [x] Маппинг: `text` → `string`, `number` → `number`, `boolean` → `boolean`, `enum` → `string` с `enum: [...]`
- [x] `response_format: { type: "json_schema", json_schema: { name: "enriched_product", strict: true, schema: {...} } }`
- [x] `uncertain_fields` переведён в array формат `[{ field, alternatives }]` для совместимости со strict mode
- [x] `postProcessEnrichedData` упрощён — типы гарантированы, оставлены safety net + enum case-normalization

### 4.2 JSON Schema для generateSchemaSuggestion
- [x] Статическая схема `SCHEMA_SUGGESTION_RESPONSE_SCHEMA` с strict: true
- [x] `allowed_values` теперь обязательный (пустой массив для non-enum) — совместимо со strict mode
- [x] Убрана нормализация ключей (`parsed.suggested_fields ?? parsed.schema ?? ...`) — формат гарантирован

**Проверка:** число ошибок парсинга в логах должно стать 0. Тип `number` возвращается как число, а не строка.

---

## Спринт 5 — Контекст похожих продуктов
> ~1.5 дня. Изменения в `worker.ts` и `ai.ts`. Требует хранения промежуточных данных.

### 5.1 Накопление примеров во время обогащения
- [x] В `processEnrichmentJob` добавить `Map<string, any[]> categoryExamples` (category → последние 3 enriched row)
- [x] После каждой успешной строки: если `rowCollisions.length === 0` и `confidence >= 80` — добавить в `categoryExamples[category]`
- [x] Ограничить размер: не более 3 примеров на категорию (FIFO — shift при overflow)

### 5.2 Передача примеров в enrichItem
- [x] Обновить сигнатуру: `enrichItem(..., liveExamples?)`
- [x] Если `liveExamples` переданы — добавить в промпт блок `PREVIOUSLY ENRICHED SIMILAR PRODUCTS` с input/output парами
- [x] Примеры берутся из `categoryExamples[catKey]` — той же категории что и текущая строка

**Проверка:** для серии продуктов одного бренда (`Elf Bar Lux 800`, `Elf Bar Lux 1500`) значения `brand`, `product_line` должны быть идентичными.

---

## Спринт 6 — Нормализация после обогащения
> ~1 день. Новый пост-процессинг шаг, новый тип BullMQ job.

### 6.1 Анализ консистентности
- [x] Добавить функцию `analyseFieldConsistency(items, schemaFields)` в `ai.ts`
- [x] Для каждого текстового поля: собрать все уникальные значения
- [x] Кластеризация через case-insensitive grouping + whitespace normalization (без внешних зависимостей)
- [x] Возвращает: `FieldConsistencyResult[]` с `{ field, clusters: [{ canonical, variants, itemIds }] }`

### 6.2 Авто-нормализация очевидных случаев
- [x] Если варианты отличаются только регистром/пробелами — авто-фикс к каноническому (самому частому) значению
- [x] Если отличия существенные — создать `collision` с `reason: 'inconsistent_value'` + suggestedValues для ревью

### 6.3 Новый воркер-шаг `normalisation`
- [x] Добавить очередь `NORMALISATION_QUEUE` + `normalisationQueue` + `normalisationWorker` в `worker.ts`
- [x] `processNormalisationJob`: загружает все enrichedItems, запускает анализ, авто-фиксит или создаёт коллизии
- [x] Запускается из finalize-секции `processEnrichmentJob` (после enrichment, перед SEO)
- [x] Non-fatal: при ошибке не ломает pipeline (catch без throw)

**Проверка:** `Vaporesso`, `VAPORESSO`, `vaporesso` в поле `brand` должны стать единым значением.

---

## Спринт 7 — Обратная связь из ревью (self-improving pipeline)
> ~2 дня. Новые таблицы в БД, изменения в API и воркере.

### 7.1 Сохранение правок пользователя → РАСШИРЕНО: кросс-орг база знаний
- [x] Добавить таблицу `enrichment_knowledge` (кросс-орг): `id, org_id, field_name, product_category, input_context, ai_value, correct_value, source (correction|confirmed), created_at`
- [x] Миграция применена (`pnpm push`)
- [x] В `POST /collisions/:id/resolve` — при resolve записывает correction в knowledge base (с input_context из rawData)
- [x] В worker — каждый 5й high-confidence результат сохраняется как `confirmed` знание (brand, product_type, material, color)

### 7.2 Использование правок как few-shot примеров
- [x] Добавить модуль `apps/csv-service-worker/src/lib/knowledge.ts`: `loadKnowledge()`, `saveConfirmedKnowledge()`, `formatKnowledgeForPrompt()`
- [x] `loadKnowledge(fieldNames)` — кросс-орг запрос, приоритет corrections → confirmed, дедупликация
- [x] `formatKnowledgeForPrompt()` — формирует блок `KNOWLEDGE BASE` с секциями CORRECTIONS и CONFIRMED VALUES
- [x] Загружается 1 раз в начале enrichment run, инжектируется в каждый `enrichItem` вызов

### 7.3 Анализ паттернов правок
- [x] Добавить endpoint `GET /knowledge/stats` — топ-15 полей с наибольшим числом corrections + общее количество записей
- [ ] Отображать на странице Billing/Settings (UI — отложено)

**Проверка:** после 5 ручных правок поля `brand` следующий запуск должен использовать их как примеры и перестать ошибаться на тех же продуктах.

---

## Спринт 8 — Verification pass для сложных случаев
> ~1 день. Дополнительный AI-вызов только для low-confidence строк.

### 8.1 Идентификация кандидатов для проверки
- [x] После основного enrichment прохода — собрать строки с `confidence < 70`
- [x] Лимит: не более 20% от общего числа строк (минимум 1 если есть кандидаты)
- [x] Budget check перед запуском — пропускается если бюджет недостаточен

### 8.2 Verification промпт
- [x] Добавить функцию `verifyEnrichedItem(row, enrichedData, schemaFields, apiKey, catalogContext?)` в `ai.ts`
- [x] Модель: `gpt-4o` (лучшее рассуждение), `temperature: 0.1`
- [x] Structured output (json_schema, strict: true): `{ corrections: [{ field, old_value, new_value, reason }], revised_confidence }`
- [x] Принимает `catalogContext` для доменного контекста

### 8.3 Применение поправок
- [x] Обновить `enrichedData` в БД для каждого correction
- [x] Обновить `confidence` на `revisedConfidence`
- [x] Если `revisedConfidence >= 80` — status → `ok`, resolve все `low_confidence` коллизии по этому item
- [x] Логирование каждой коррекции: `[Verification] row-3 → brand: "lenovo" → "Lenovo" (reason)`
- [x] Budget consumed per verification call as `purpose: 'verification'`

**Проверка:** строка `Мундштук груша жен. Слим - 100` (минимум данных) — после verification pass значения должны стать точнее.

---

## Технический долг (параллельно, без приоритета)

- [x] **Параллельное обогащение** — `CONCURRENCY = 5`, batch из 5 строк обрабатывается через `Promise.all`. Checkpoint сохраняется после каждого batch. `rowIndex` детерминирован (абсолютный счётчик из CSV-потока).
- [x] **Retry с exponential backoff на уровне строки** — `MAX_ROW_RETRIES = 2`, backoff 1s → 2s. После 3 неудачных попыток строка сохраняется как failed с `confidence: 0`.
- [x] **Checkpoint/resume** — `lastProcessedRowIndex` в `enrichmentRuns`. При BullMQ retry строки до checkpoint пропускаются. Checkpoint обновляется после каждого batch.
- [x] **Метрики качества** — `csv_worker_avg_confidence` (Gauge), `csv_worker_failed_ratio` (Gauge), `csv_worker_items_failed_total` (Counter). Обновляются в конце enrichment run.

---

## Зависимости между спринтами

```
1.1 → 1.2 → 1.3        (промпты, можно делать независимо)
2.1 → 2.2              (этапы A и B схемы)
3.1 → 3.2              (определение категории нужно для routing)
4.1 → 4.2              (structured outputs — единый рефактор)

1.3 + 3.2 → 5.2        (few-shot требует примеров и категорий)
5.1 + 5.2 → 6.x        (нормализация полезна после контекстного обогащения)
6.x → 7.x              (коррекции более значимы когда нормализация уже работает)
5.x + 7.x → 8.x        (verification pass наиболее эффективен с контекстом и коррекциями)
```

Спринты 1–4 независимы друг от друга и от 5–8.
Спринты 5–8 дают максимум в комбинации, но каждый полезен сам по себе.

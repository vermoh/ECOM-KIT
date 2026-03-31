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
- [ ] Добавить функцию `detectRowCategory(row, knownCategories)` в `ai.ts`
- [ ] Логика: сначала проверить явное поле категории, затем fuzzy-match по названию/описанию
- [ ] Результат кешировать в память воркера (одна категория → один ключ)

### 3.2 Category-specific system prompts
- [ ] Создать файл `apps/csv-service-worker/src/lib/category-prompts.ts`
- [ ] Определить `systemPromptFor(category: string): string` — возвращает специализированный system prompt
  - Vape devices: *"Expert in electronic cigarettes, pod systems, disposables. You know puff counts, resistance, battery capacity by model name."*
  - E-liquids: *"Expert in vape liquids. You know VG/PG ratios, nicotine salt vs freebase, standard volumes (10ml, 30ml, 60ml)."*
  - Glass/accessories: *"Expert in smoking accessories. You know joint sizes (14.5mm, 18.8mm), glass types, percolator designs."*
  - Tobacco/papers: *"Expert in rolling tobacco and accessories. You know tobacco cuts, paper sizes, filter types."*
  - Default: универсальный промпт
- [ ] Передавать соответствующий system prompt в `enrichItem`

**Проверка:** `Pod VAPORESSO XROS 5 MINI` — `battery_mah`, `resistance_ohm`, `refillable` должны заполняться корректно.

---

## Спринт 4 — Structured outputs
> ~0.5 дня. Изменения только в `ai.ts`.

### 4.1 JSON Schema для enrichItem
- [ ] Добавить функцию `buildJsonSchema(schemaFields)` → JSON Schema объект
- [ ] Поддержать маппинг: `text` → `string`, `number` → `number`, `boolean` → `boolean`, `enum` → `string` с `enum: [...]`
- [ ] Передавать как `response_format: { type: "json_schema", json_schema: { name: "enriched_product", schema: {...}, strict: true } }`
- [ ] Убрать постобработку нормализации типов (станет ненужной — OpenAI гарантирует типы)
- [ ] Оставить `postProcessEnrichedData` только для enum case-normalization

### 4.2 JSON Schema для generateSchemaSuggestion
- [ ] Аналогично добавить строгую схему для ответа: `{ fields: [{ name, label, field_type, description, allowed_values? }] }`
- [ ] Убрать нормализацию ключей (`raw.field_name ?? raw.fieldName ?? ...`) — она больше не нужна

**Проверка:** число ошибок парсинга в логах должно стать 0. Тип `number` возвращается как число, а не строка.

---

## Спринт 5 — Контекст похожих продуктов
> ~1.5 дня. Изменения в `worker.ts` и `ai.ts`. Требует хранения промежуточных данных.

### 5.1 Накопление примеров во время обогащения
- [ ] В `processEnrichmentJob` добавить `Map<string, any[]> categoryExamples` (category → последние 3 enriched row)
- [ ] После каждой успешной строки: если `enrichedItem.status === 'ok'` и `confidence >= 80` — добавить в `categoryExamples[category]`
- [ ] Ограничить размер: не более 3 примеров на категорию

### 5.2 Передача примеров в enrichItem
- [ ] Обновить сигнатуру: `enrichItem(row, schemaFields, apiKey, examples?)`
- [ ] Если `examples` переданы — добавить в промпт:
  ```
  EXAMPLES OF CORRECTLY ENRICHED SIMILAR PRODUCTS:
  [JSON of 2-3 examples]
  Use these as reference for style, values, and inference patterns.
  ```
- [ ] Примеры берутся из той же категории что и текущая строка

**Проверка:** для серии продуктов одного бренда (`Elf Bar Lux 800`, `Elf Bar Lux 1500`) значения `brand`, `product_line` должны быть идентичными.

---

## Спринт 6 — Нормализация после обогащения
> ~1 день. Новый пост-процессинг шаг, новый тип BullMQ job.

### 6.1 Анализ консистентности
- [ ] Добавить функцию `analyseFieldConsistency(enrichedItems, schemaFields)` в `ai.ts`
- [ ] Для каждого текстового поля: собрать все уникальные значения
- [ ] Кластеризовать похожие значения через fuzzy-matching (библиотека `fastest-levenshtein` или аналог)
- [ ] Вернуть: `{ field, clusters: [{ canonical, variants: string[], rowIds: string[] }] }`

### 6.2 Авто-нормализация очевидных случаев
- [ ] Если кластер имеет 1 вариант и ≥3 строки — считать его каноническим, обновить все строки
- [ ] Если вариантов несколько — создать `collision` с `reason: 'inconsistent_value'` для ревью пользователем

### 6.3 Новый воркер-шаг `normalisation`
- [ ] Добавить очередь `normalisation` в `worker.ts`
- [ ] Запускать после завершения enrichment run (до SEO)
- [ ] UI: показывать статус нормализации в прогрессе задачи

**Проверка:** `Vaporesso`, `VAPORESSO`, `vaporesso` в поле `brand` должны стать единым значением.

---

## Спринт 7 — Обратная связь из ревью (self-improving pipeline)
> ~2 дня. Новые таблицы в БД, изменения в API и воркере.

### 7.1 Сохранение правок пользователя
- [ ] Добавить таблицу `enrichment_corrections` в схему БД:
  ```sql
  id, org_id, field_name, product_category, ai_value, corrected_value, created_at
  ```
- [ ] Запускать миграцию
- [ ] В endpoint `POST /collisions/:id/resolve` — при сохранении resolved value записывать в `enrichment_corrections`

### 7.2 Использование правок как few-shot примеров
- [ ] Добавить функцию `loadCorrections(orgId, category, fieldName, limit = 3)` в `lib/budget.ts` или отдельный файл
- [ ] Вызывать из воркера перед обогащением, передавать как additional few-shot в промпт
- [ ] Формат в промпте: *"Previous corrections by your team: AI said X, correct answer was Y"*

### 7.3 Анализ паттернов правок
- [ ] Добавить endpoint `GET /billing/usage/corrections` — возвращает топ-10 полей с наибольшим числом правок
- [ ] Отображать на странице Billing как *"Fields most frequently corrected"*
- [ ] Это сигнал что поле плохо описано или AI не справляется — подсказка пересмотреть схему

**Проверка:** после 5 ручных правок поля `brand` следующий запуск должен использовать их как примеры и перестать ошибаться на тех же продуктах.

---

## Спринт 8 — Verification pass для сложных случаев
> ~1 день. Дополнительный AI-вызов только для low-confidence строк.

### 8.1 Идентификация кандидатов для проверки
- [ ] После основного enrichment прохода — собрать строки с `confidence < 70`
- [ ] Лимит: не более 20% от общего числа строк (чтобы контролировать стоимость)

### 8.2 Verification промпт
- [ ] Добавить функцию `verifyEnrichedItem(row, enrichedData, schemaFields, apiKey)` в `ai.ts`
- [ ] Модель: `gpt-4o` (лучшее рассуждение для неоднозначных случаев)
- [ ] Промпт: *"Review these enriched values for accuracy. For each field: is the value plausible? If not, provide the correct value and explain why."*
- [ ] Возвращать: `{ corrections: [{ field, oldValue, newValue, reason }], revisedConfidence }`

### 8.3 Применение поправок
- [ ] Обновить `enrichedData` в БД для исправленных полей
- [ ] Обновить `confidence` на `revisedConfidence`
- [ ] Если `revisedConfidence >= 80` — убрать существующие коллизии по этой строке

**Проверка:** строка `Мундштук груша жен. Слим - 100` (минимум данных) — после verification pass значения должны стать точнее.

---

## Технический долг (параллельно, без приоритета)

- [ ] **Параллельное обогащение** — запускать N строк одновременно (Promise.all с concurrency limit 5), сократит время обработки в 5x. Аккуратно с порядком rowIndex.
- [ ] **Retry с exponential backoff на уровне строки** — сейчас ошибка строки сохраняется как failed без retry. Добавить 2 retry с задержкой перед финальным сохранением как failed.
- [ ] **Checkpoint/resume** — сохранять `lastProcessedRowIndex` в `enrichmentRuns`, при BullMQ retry начинать с него, а не с начала.
- [ ] **Метрики качества** — добавить в Prometheus: среднее confidence по запуску, процент failed строк, распределение `_enrichment_status`.

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

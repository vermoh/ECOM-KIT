# Prompt Specifications

## Goal
Определить шаблоны внутренних AI-задач для воспроизводимой работы.

## 1. Schema Generation Prompt

### Input
- category
- subcategory
- product name samples
- optional brand
- optional source attributes

### Expected Output
JSON object:
- suggested_fields[]
- each field: name, type, is_filterable, unit, allowed_values, rationale, confidence

### Rules
- не придумывать характеристики, которые не поддерживаются контекстом;
- избегать слишком общих полей;
- при сомнении снижать confidence;
- указывать unit для размерных полей.

## 2. Enrichment Prompt

### Input
- product row
- approved schema
- category context

### Expected Output
JSON object:
- filled_attributes
- per-field confidence
- unresolved_fields
- notes

### Rules
- использовать только approved schema;
- не генерировать поля вне схемы;
- не заполнять значение при низкой уверенности, лучше вернуть unresolved;
- сохранять machine-readable output.

## 3. Collision Classification Prompt

### Input
- raw row
- approved schema
- attempted output
- validation notes

### Expected Output
JSON object:
- collision_type
- severity
- explanation
- candidate_resolutions

### Rules
- blocking collisions выделять отдельно;
- explanation должна быть краткой и прикладной;
- candidate_resolutions не должны маскировать неопределённость как факт.

## 4. SEO Generation Prompt

### Input
- product name
- category
- approved enriched attributes
- brand if available

### Expected Output
JSON object:
- title
- short_description
- long_description
- seo_meta_description

### Rules
- не выдумывать характеристики вне enriched data;
- не использовать неподтверждённые claims;
- текст должен быть совместим с e-commerce usage, а не рекламной фантазией.
# Human-in-the-Loop Rules

## Цель
Обеспечить управляемость AI-процесса и не допустить неконтролируемой порчи данных.

## Этапы, где участие человека обязательно
1. Утверждение первичного SchemaTemplate.
2. Разбор blocking collisions.
3. Подтверждение повторного запуска после критической ошибки, если система не может безопасно продолжить автоматически.
4. Подтверждение спорных schema changes после approval.

## Этапы, где участие человека желательно, но не обязательно
1. Редактирование автоматически предложенных schema fields.
2. Проверка confidence thresholds перед массовым enrichment.
3. Просмотр выборочных enriched items перед экспортом.

## Этапы, которые могут идти автоматически
1. Upload validation.
2. CSV normalization.
3. Очередная асинхронная обработка enrichment, если schema уже approved.
4. Retry transient failures.
5. Сбор export файла, если нет blocking collisions.

## Trigger conditions for manual review
- confidence ниже threshold;
- несколько одинаково вероятных значений;
- unit ambiguity;
- schema mismatch;
- missing required attribute;
- конфликт между исходными атрибутами и inferred result;
- подозрение на категориальную ошибку.

## Override rules
- override может делать только reviewer или выше;
- override сохраняется с actor_id, reason и timestamp;
- override не должен удалять исходный AI результат, только помечать финальное принятое значение;
- override должен быть доступен в аудите.

## UI requirements
- пользователь должен видеть, что предложено AI, а что утверждено человеком;
- должна быть причина возникновения collision;
- должна быть история принятых решений;
- должна быть возможность фильтровать blocking/non-blocking collisions.
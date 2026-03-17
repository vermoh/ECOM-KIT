# Quality Gate Checklist

Перед принятием результата проверить:
- соответствует ли TDD;
- не нарушает ли ADR;
- нет ли cross-tenant риска;
- есть ли permission checks;
- есть ли audit hooks;
- соблюдены ли state transitions;
- нет ли forbidden sync processing;
- нормализованы ли ошибки;
- соответствует ли UI product flow.
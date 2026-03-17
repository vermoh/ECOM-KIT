# Error Model

## Цели
- единый формат ошибок;
- предсказуемость для frontend;
- трассируемость для backend и observability.

## Standard Error Response
- code
- message
- details
- correlation_id
- timestamp

## Error Categories

### AUTHENTICATION_ERROR
Пользователь не аутентифицирован или token недействителен.

### AUTHORIZATION_ERROR
Пользователь аутентифицирован, но не имеет прав.

### TENANT_SCOPE_ERROR
Попытка доступа к чужому tenant-scoped ресурсу.

### VALIDATION_ERROR
Некорректные данные запроса или CSV.

### BUSINESS_RULE_VIOLATION
Нарушено бизнес-правило, например enrichment без approved schema.

### CONFLICT_ERROR
Состояние ресурса конфликтует с действием.

### EXTERNAL_PROVIDER_ERROR
Ошибка внешнего AI provider.

### JOB_EXECUTION_ERROR
Ошибка асинхронного задания.

### RATE_LIMIT_ERROR
Превышение лимита запросов.

### INTERNAL_ERROR
Необработанная ошибка сервера.

## Rules
- backend не должен возвращать сырые stack traces клиенту;
- correlation_id обязателен для всех server-side ошибок;
- ошибки внешних систем должны нормализоваться в общий формат.
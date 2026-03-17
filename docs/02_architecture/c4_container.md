# C4 Container

## Containers

### control-plane-web
Frontend-админка для входа, управления организациями, пользователями, ролями и доступом к сервисам.

### control-plane-api
Backend для auth, org management, users, roles, provider configs, service access, audit.

### csv-service-web
Frontend для работы с CSV project lifecycle.

### csv-service-api
Backend для projects, uploads, schema management, collisions, exports.

### csv-service-worker
Worker для enrichment, retries, export preparation и SEO tasks.

### postgres
Основное хранилище бизнес-данных.

### redis
Очереди, distributed locks, transient coordination.

### object-storage
Хранение исходных и итоговых файлов.

### ai-provider
Внешний сервис AI inference.
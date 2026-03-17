# C4 Context

## System Context

Система состоит из:
- Users
- Control Plane
- CSV Enrichment Service
- Future Monoservices
- PostgreSQL
- Redis / Queue
- Object Storage
- OpenRouter / AI Provider

## External actors
- Super Admin
- Organization Admin
- Service User
- Reviewer
- External AI Provider

## High-level interactions
1. Пользователи входят через Control Plane.
2. Control Plane аутентифицирует пользователя и определяет tenant + permissions.
3. Пользователь переходит в CSV Service, передавая claims и service access context.
4. CSV Service обрабатывает данные и при необходимости использует AI Provider.
5. Jobs исполняются асинхронно через queue/worker.
6. Все критические действия фиксируются в audit trail.
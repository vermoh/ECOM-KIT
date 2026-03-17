# Bounded Contexts

## Control Plane Context

Сущности:
- Organization
- User
- Membership
- Role
- ServiceAccess
- ProviderConfig

## CSV Service Context

Сущности:
- Project
- Upload
- SchemaTemplate
- EnrichmentRun
- Collision
- ExportJob

## Запрещено

- прямой доступ CSV сервиса к таблицам Control Plane
- shared mutable state между сервисами
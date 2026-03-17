# Service Registry Specification

## Purpose
Определить, как новые моносервисы подключаются к платформе.

## Required service metadata
- service_key
- display_name
- description
- status
- version
- entry_url
- api_base_url
- required_permissions
- feature_flags
- supports_org_level_access
- supports_user_level_access

## Required capabilities
- health endpoint
- auth validation support
- tenant context support
- audit hooks
- correlation_id support

## Registration rules
1. Сервис должен быть зарегистрирован в Control Plane.
2. Сервис должен объявить required permissions.
3. Сервис должен поддерживать revocation-safe access checks.
4. Сервис не должен использовать Control Plane DB напрямую.

## Future extension points
- billing hooks
- usage metrics
- capability negotiation
- service-level quotas
# Code Conventions

## General
- TypeScript-first for web and API layers unless a service explicitly chooses Python for worker-heavy processing.
- Strict typing required.
- No implicit any.
- Clear module boundaries.

## Naming
- files: kebab-case
- classes: PascalCase
- functions/variables: camelCase
- enums: PascalCase
- constants: UPPER_SNAKE_CASE where appropriate

## Backend
- controllers thin
- services contain business logic
- repositories only data access
- DTOs separated from domain models
- validation at input boundaries
- centralized error mapping

## Frontend
- components separated into page, feature, shared/ui levels
- business logic not hidden inside presentational components
- forms use explicit validation schemas
- permission checks both in UI and backend, but backend authoritative

## API
- predictable route naming
- no inconsistent response envelopes without reason
- pagination standardized
- correlation_id propagated when relevant

## State
- async operations modeled explicitly
- status enums centralized
- no hidden implicit transitions
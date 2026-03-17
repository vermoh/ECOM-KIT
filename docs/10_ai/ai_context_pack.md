# AI Context Pack

SYSTEM:
SaaS платформа с Control Plane и CSV сервисом

SERVICES:
- control-plane
- csv-enrichment

CORE RULES:
- tenant isolation обязателен
- RBAC обязателен
- enrichment только после schema approval
- async processing

SOURCE OF TRUTH:
1. ADR
2. Architecture docs
3. Domain model

FORBIDDEN:
- менять архитектуру
- упрощать доступ
- смешивать сервисы
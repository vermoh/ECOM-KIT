# Тестовая стратегия ECOM KIT

> **Статус:** Draft  
> **Версия:** 1.0  
> **Последнее обновление:** 2026-03-22  

---

## 1. Пирамида тестирования и Coverage Strategy

Мы следуем расширенной пирамиде тестирования с особым упором на **Tenant Isolation** и **Security**.

| Слой теста | Описание | Инструменты | Целевое покрытие |
|------------|----------|-------------|-------------------|
| **Unit** | Чистая логика, парсеры, мапперы, бизнес-правила | Vitest / Jest | > 90% logic |
| **Integration** | DB (RLS), Redis, BullMQ, Service-to-Service | Vitest + TestContainers | > 80% API/Jobs |
| **Contract** | Взаимодействие Control Plane ↔ Service Plane | Pact / custom JSON Schema | 100% Shared Types |
| **E2E** | Критические пути пользователя (Wizard flow) | Playwright / Cypress | 100% Happy Paths |
| **Security** | RBAC, Tenant Leakage, Secret exposure | Custom test suites | 100% Permissions |

---

## 2. Специализированные области тестирования

### 2.1 Tenant Isolation Tests (Критично)
**Цель:** Убедиться, что данные Tenant A никогда не видны Tenant B.
- **RLS Verification:** Тесты на уровне БД, выполняющие запросы под разными `app.current_org_id`.
- **Prefix Isolation:** Проверка путей в S3 (`s3://bucket/{org_id}/...`).
- **Cross-Tenant Attack Simulation:** Попытка доступа к `job_id` другого тенанта через API. Ожидаемый результат: 403 Forbidden.

### 2.2 RBAC & ABAC Tests
**Цель:** Проверка матрицы прав доступа.
- **Negative Tests:** Попытка выполнения `schema:approve` ролью `operator`.
- **Temporal Access:** Тесты на истечение `valid_until` в JWT (mocking time).
- **Service Access:** Проверка доступа к CSV Service только при наличии `ServiceGrant`.
- **Audit Logging:** Тесты, проверяющие, что каждый 403 (Forbidden) и каждое критическое действие (загрузка, экспорт) порождают запись в `audit_log`.

### 2.3 CSV Parsing & Processing
- **Parsing Robustness:** Тесты на битые CSV, разные кодировки, огромные файлы (streaming test).
- **Job Lifecycle:** Проверка переходов статусов `PENDING` → `PARSING` → `PARSED` согласно `state_machines.md`.

### 2.4 AI Schema & Enrichment
- **Schema Generation:** Проверка структуры сгенерированного JSON шаблона.
- **Collision Handling:** Моделирование ситуации с дублирующимися SKU. Проверка флага `collision_flag`.
- **Prompt Regression:** Сравнение результатов AI на фиксированных датасетах.

### 2.5 Export Validation
- **Data Integrity:** Сравнение данных в БД и в итоговом экспортированном файле.
- **Signed URL Security:** Проверка срока жизни и аттрибутов доступа к S3 URL.

---

## 3. Обязательные тесты до релиза (Gatekeeper)

Любой PR должен проходить следующие проверки:
1. **Security Scan:** Отсутствие secrets в коде и логах.
2. **Tenant Isolation Suite:** Все 100% тестов на изоляцию должны быть зелеными.
3. **RBAC Matrix Check:** Автоматизированная проверка ключевых ролей (`admin`, `manager`, `reviewer`).
4. **Migration Test:** Успешное выполнение миграций (Drizzle) на копии prod-схемы.
5. **Contract Compatibility:** Проверка, что изменения в CP не ломают Service Plane.

---

## 4. Risk-Based Testing

Мы приоритизируем тесты на основе рисков:

| Риск | Вероятность | Ущерб | Стратегия минимизации |
|------|:-----------:|:-----:|-----------------------|
| Утечка данных между Tenant | Низкая | 🔥 Критич. | RLS тесты на каждом PR. |
| Ошибка в AI обогащении | Высокая | Средний | Human-in-the-loop (Review Step). |
| Отказ OpenRouter (SPOF) | Средняя | Высокий | Fallback модели + Circuit Breaker. |
| Некорректный биллинг | Низкая | Высокий | Integration тесты со Stripe Sandbox. |
| Потеря CSV файла в S3 | Низкая | Высокий | Проверка persistence после загрузки. |

---

## 5. Методология выполнения

1. **Local Dev:** Запуск unit и простых integration тестов.
2. **CI (GitHub Actions):** 
   - Полный прогон всех слоёв.
   - Сборка и деплой в `staging` для E2E.
3. **Staging:** 
   - Нагрузочное тестирование (загрузка файлов 100MB+).
   - Smoke tests после каждого деплоя.

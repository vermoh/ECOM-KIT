# ADR-004 Async Job Processing

## Context
CSV validation, schema generation, enrichment, collision processing и export могут занимать значительное время и не должны блокировать пользовательский поток.

## Decision
Все длительные операции выполняются через queue + worker.

## Rationale
- устойчивость к долгим операциям;
- retry strategy;
- resumable processing;
- изоляция UI от долгих задач.

## Consequences
+ надёжнее;
+ масштабируемо;
+ можно контролировать retries и dead letters;
- сложнее orchestration;
- нужны state machines и observability.

## Forbidden
- выполнять full enrichment синхронно в API request;
- держать пользовательский HTTP-запрос открытым до полного завершения job.
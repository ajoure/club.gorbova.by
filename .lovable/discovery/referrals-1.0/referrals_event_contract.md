# План: event contract

`domain_events(id,event_type,source,entity_id,payload,created_at)` и `domain_executions(id,event_id,step,status,error,attempt,created_at)` подтверждены миграцией и types.

Недостатки для финансового consumer: нет подтверждённых idempotency key, available-at, lease/claim, next retry, dead-letter и транзакционной связки с коммерческим writer. Клиентский `DomainEventService` пишет напрямую из браузера и не используется для referral finance. Нужен серверный atomic RPC/outbox после live-аудита.

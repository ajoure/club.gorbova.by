# Backlog: удалить deprecated edge-функции документов

**Created:** 2026-05-21
**Owner:** docs canonical pipeline

## Контекст

После унификации «Моих покупок» на канонический пайплайн
(`canonical-document-generate-strict` + `canonical-document-send`) три legacy
edge-функции больше не вызываются из клиента:

- `generate-invoice-act` — старый dropdown «Документы» в `OrderListItem` (генерация + email + telegram текстом).
- `send-invoice` — вызывалась в `ConsultationPaymentDialog`.
- `generate-document-pdf` — старый HTML→PDF путь.

Они физически НЕ удалены, потому что могут вызываться:
- внешними webhook-ами,
- бэкграунд cron-ами,
- старыми ссылками в письмах.

## DoD удаления

1. 14 дней нулевых вызовов в `supabase--edge_function_logs` для каждой из трёх функций.
2. Grep по всему репозиторию — нет ни одного `invoke("<имя>")`.
3. Удалить директории `supabase/functions/{generate-invoice-act,send-invoice,generate-document-pdf}/`.
4. Удалить упоминания из `supabase/functions.registry.txt` (если есть).
5. Audit `audit_logs` — нет событий с `entity_type='generated_documents'` за последние 14 дней (legacy таблица).

## Связанное

- `mem://commercial-logic/documents/cabinet-documents-canonical-sot` (создаётся в этом же спринте).
- Канонический writer: `canonical-document-generate-strict` → `ai_generated_documents`.
- Канонический sender: `canonical-document-send`.

# BACKLOG: PATCH-STRIPE-TEST-FIXTURE-MARKER-V1

Статус: deferred (создан в рамках PATCH-STRIPE-DOCUMENTS-DRAWER-V2 / Approve B).
Зависит от: ничего.
Блокирует: возможность безопасно возвращать `TEST_PAYMENT_DOCUMENT_BLOCKED`
из resolver-а документов и аналогичных мест.

## Проблема

Канонического marker «технической / fixture-оплаты» в системе сейчас НЕТ.
Inventory в `.lovable/discovery/stripe_documents_drawer_v2.md` § A6 подтвердил:
- `meta.test_payment` / `meta.fixture` нигде не выставлены;
- `meta.stripe.test_mode` присутствует только концептуально (на live аккаунте
  Stripe не отдаёт это поле; нужно резолвить через `acquiring_connections.test_mode`);
- сумма (например, 2 USD) НЕ является marker'ом и не может использоваться как эвристика.

В `admin-payment-documents-resolve` (Approve B) поэтому НЕ выставляется
`TEST_PAYMENT_DOCUMENT_BLOCKED` и НЕ блокируется выдача production-номера —
такая логика появится только после введения canonical marker.

## Решение (формально вне Approve B)

1. Зафиксировать canonical marker (предлагаемые варианты, окончательный выбор —
   в отдельном Discovery):
   - `payments_v2.meta.fixture = true` (вариант A, добавляется на write-paths),
   - `payments_v2.meta.test_payment = true` (вариант B, для обратной совместимости),
   - `acquiring_connections.test_mode = true` (вариант C, derived через account_code).
2. Описать write-paths, на которых marker выставляется (Stripe `stripe-webhook`,
   admin manual charge, internal test harness).
3. Расширить `generation-status.ts`:
   - при наличии marker → `blocked_reason = TEST_PAYMENT_DOCUMENT_BLOCKED`;
   - запретить выделение production-номера;
   - оставить provider documents (receipt/invoice) показывать как есть.
4. Бэкфилл существующих fixture-row (включая 2 USD `00b39954…`).
5. Покрыть тестами:
   - marker присутствует → `can_generate=false`, `blocked_reason=TEST_PAYMENT_DOCUMENT_BLOCKED`,
   - marker отсутствует → поведение Approve B сохраняется.

## Что НЕЛЬЗЯ делать до закрытия патча

- определять fixture по сумме (`amount == 2 USD`),
- хардкодить UUID конкретных платежей,
- возвращать `TEST_PAYMENT_DOCUMENT_BLOCKED` из любого resolver-а без marker.

## Связанные артефакты

- Discovery: `.lovable/discovery/stripe_documents_drawer_v2.md` § A6, § A9.
- Resolver (Approve B): `supabase/functions/admin-payment-documents-resolve/index.ts`.
- Generation classifier (Approve B): `supabase/functions/_shared/payments/documents/generation-status.ts`.

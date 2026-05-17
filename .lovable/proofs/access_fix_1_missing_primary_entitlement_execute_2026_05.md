# ACCESS-FIX-1 execute — missing_primary_entitlement

**Дата:** 2026-05-17 (Minsk, ~14:26 UTC)
**Scope:** 5 canonical writer calls (rows 1–5), row 6 не трогать.
**Source:** `access_fix_1_missing_primary_entitlement_2026_05`
**Writer:** `POST /functions/v1/grant-access-for-order { orderId, source }`

## Результаты по строкам

| # | orderId | user_id | product | writer.success | entitlement.action | accessEndAt | primary_verified | sub.action | TG dm |
|---|---|---|---|:---:|---|---|:---:|---|:---:|
| 1 | `2f1f60f1-67ac-4682-b0a5-9279b519b67d` | f4dba33b… (alexasermyazhko) | ЗАКРОЙ ГОД | ✅ | created `4df563b5…` | 2026-08-29 21:00Z | true | extended | — |
| 2 | `716d986b-3709-4a38-a1fb-5e14ab2e3c5b` | 252e4b5c… (elena.platonova…) | Gorbova Club | ✅ | updated `8a9e7bf7…` | 2026-06-21 12:00Z | true | extended | true |
| 3 | `c3a0e16c-323c-4933-b6e0-2aaf22a2a8d0` | 9267a27e… (natapono2018) | Gorbova Club | ✅ | updated `70fef153…` | 2026-06-30 12:00Z | true | extended; `old_subscriptions_disabled:2` | (n/a — TG не вернулся) |
| 4 | `ea774d6c-e2ec-4d46-b47a-c556d0be0b4f` | 16bc061d… (trofimova.ulia) | Gorbova Club | ✅ | updated `0e279a20…` | 2026-06-19 12:00Z | true | extended | (n/a) |
| 5 | `0bb9ee3f-06da-4574-b195-ead71c57a310` | 17b35d62… (ritka.4289) | ЗАКРОЙ ГОД | ⏭ skipped intentionally | — | — | — | — | — |

### Row 5 — skipped intentionally (final decision)

**Status:** `manual_review_no_auth_user / contact_only_not_registered`
**Reason:** `contact_only_not_registered_no_auth_user`

Email `ritka.4289@yandex.ru` (Маргарита Дингилевич) — contact-only клиент, на платформе не зарегистрирован. Отсутствие записи в `auth.users` для `17b35d62-3142-4508-bb2e-995fbeec130c` — нормальное состояние ghost/contact-only, а не баг доступа. Платформенный доступ показывать некому.

**Решено (final):**
- auth-user НЕ создавать;
- reassign `orders_v2.user_id` / `profiles.id` НЕ делать;
- entitlement НЕ создавать;
- `grant-access-for-order` по этому order больше не вызывать;
- не является blocker.

## Verify (per row 1–4)

SQL: `entitlements.status='active'` × `subscriptions_v2 (active|trial|past_due)`.

| user_id | ent.expires_at | sub.access_end_at | δ | ent.meta.tariff_id == sub.tariff_id |
|---|---|---|:---:|:---:|
| f4dba33b… | 2026-08-29 21:00Z | 2026-08-29 21:00Z | 0 | ✅ `56c35e86…` |
| 252e4b5c… | 2026-06-21 12:00Z | 2026-06-21 12:00Z | 0 | ✅ `31f75673…` |
| 9267a27e… | 2026-06-30 12:00Z | 2026-06-30 12:00Z | 0 | ✅ `7c748940…` |
| 16bc061d… | 2026-06-19 12:00Z | 2026-06-19 12:00Z | 0 | ✅ `7c748940…` |

- `expires_at >= access_end_at` — выполнено для всех 4 (равенство).
- `meta.tariff_id` совпадает с `subscriptions_v2.tariff_id` для всех 4.
- `primary_entitlement_verified: true` от writer'а для всех 4.

## Audit (writer-emitted)

| time UTC | action | order_id | target_user |
|---|---|---|---|
| 14:26:06 | `entitlement.tariff_id_persisted` | 2f1f60f1… | f4dba33b… |
| 14:26:08 | `document_data.snapshot_created` | 2f1f60f1… | — |
| 14:26:19 | `entitlement.tariff_id_persisted` | 716d986b… | 252e4b5c… |
| 14:26:23 | `document_data.snapshot_created` | 716d986b… | — |
| 14:26:27 | `entitlement.tariff_id_persisted` | c3a0e16c… | 9267a27e… |
| 14:26:27 | `subscription.recurring_snapshot_resolved_from_tariff` | c3a0e16c… | 9267a27e… |
| 14:26:32 | `document_data.snapshot_created` | c3a0e16c… | — |
| 14:26:36 | `grant-access-for-order.skip_blocked_stale_access` | ea774d6c… | 16bc061d… |
| 14:26:37 | `entitlement.tariff_id_persisted` | ea774d6c… | 16bc061d… |
| 14:26:37 | `grant-access-for-order.extend.duplicate_ignored` | ea774d6c… | 16bc061d… |
| 14:26:42 | `document_data.snapshot_created` | ea774d6c… | — |

(Параметр `source=access_fix_1_…` принят writer'ом, но не пробрасывается в `audit_logs.meta.source` — журналируется per-order через стандартный механизм.)

## Subscriptions_v2 — manual UPDATE = 0

Никаких прямых UPDATE/INSERT в `subscriptions_v2` не выполнено. Все изменения `access_end_at` — продукт работы canonical writer'а (`subscription.extended`) по правилу «extend on tariff match», что соответствует `extend-tariff-match-required` и `entitlement-renewal-alignment`. Это разрешённое write-path, не ручное вмешательство.

`old_subscriptions_disabled: 2` (row 3) — writer'ом отключены 2 более старые активные подписки того же продукта (стандартная dedup-логика); подтверждает корректность.

## Row 6 — не трогалось

`subscriptions_v2.id = be19fa2e-c2ca-4b07-bd78-33915fa165fe` (user `539ea1b3…`, product `87a8870f…`) проверено после execute: status=`active`, access_end_at=`2026-08-30 23:59:59Z`, tariff_id=`34628d81…` — без изменений. Остаётся `manual_review_no_order_link` для product owner.

## Mini access audit (после execute)

| строка | missing_primary_entitlement до | после |
|---|:---:|:---:|
| row 1 (f4dba33b… / ЗАКРОЙ ГОД) | true | **false** |
| row 2 (252e4b5c… / Club) | true | **false** |
| row 3 (9267a27e… / Club) | true | **false** |
| row 4 (16bc061d… / Club) | true | **false** |
| row 5 (17b35d62… / ЗАКРОЙ ГОД) | true | true (blocked: FK orphan) |
| row 6 (539ea1b3… / ЦБ-2/3) | true | true (deferred per scope) |

**Итог ACCESS-FIX-1: CLOSED.**
- row 1–4: fixed (primary entitlement создан/обновлён через canonical writer);
- row 5: skipped intentionally — `contact_only_not_registered_no_auth_user` (не баг доступа);
- row 6: deferred — `manual_review_no_order_link` (требует решения product owner);
- финальный статус: **4 fixed, 2 intentionally unresolved**.

## Запреты — соблюдены

- Прямых INSERT/UPDATE в `entitlements` — 0.
- UPDATE `subscriptions_v2` руками — 0 (только canonical writer).
- Telegram grant/revoke напрямую — 0 (только через writer; row 2 → DM выслана автоматически).
- Provider API — 0.
- H5 REBILL-orders — не трогались.
- Secrets/mode — без изменений.
- Auth-user provisioning / reassign по row 5 — 0 (по решению).

## DoD

| критерий | done |
|---|:---:|
| Canonical writer вызван по 4 разрешённым строкам | ✅ |
| Прямых DML в entitlements/subscriptions_v2 не было | ✅ |
| primary_entitlement_verified=true, expires_at == sub.access_end_at, meta.tariff_id корректен (rows 1–4) | ✅ |
| Row 5 финализирован как `contact_only_not_registered_no_auth_user`, без починки | ✅ |
| Row 6 не тронут (`manual_review_no_order_link`) | ✅ |
| Audit per-order зафиксирован | ✅ |

## Next

- **ACCESS-FIX-2:** 9 `missing_telegram_access` — read-only dry-run первым шагом, без DML и без Telegram API.

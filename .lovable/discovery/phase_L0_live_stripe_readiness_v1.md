# Phase L-0 Discovery — Live Stripe Production Gate

Дата: 2026-06-09
Режим: read-only. Никаких изменений в БД/коде/secrets/Vault.

## Цель
Определить, может ли существующий UI `/admin/integrations/payments`
самостоятельно сохранить **live** Stripe-подключение через тот же flow, что
test, и нужны ли минимальные UI-доработки до перехода к L-1. Никакие live
ключи в Supabase secrets вручную не вводились.

## Артефакты UI/edge, отвечающие за Stripe connection
- `src/components/admin/integrations/StripeConnectionDialog.tsx` — единая
  форма (создание + редактирование).
- `src/components/admin/integrations/PaymentsIntegrationsPanel.tsx` — список
  подключений + кнопка «Добавить подключение».
- `src/pages/admin/AdminAcquiring.tsx` — страница (`/admin/integrations/payments`).
- Edge functions:
  - `acquiring-save-connection` — UPSERT `acquiring_connections` + запись
    секретов через RPC `admin_save_acquiring_secret` (Vault).
  - `acquiring-test-connection` — проверка ключей у Stripe.
  - `acquiring-list-connections` / `acquiring-disable-connection`.
- Vault SOT: `_shared/acquiring/vault.ts` (`readAcquiringSecret`); env-fallback
  только при отсутствии записи в Vault.

## Что форма уже умеет (без правок)
| Поле | Поддержка |
|---|---|
| `account_name` | да, свободный ввод |
| `account_code` | да, редактируем при создании, immutable при edit. Авто-suffix `_2`, `_3` → можно ввести `stripe_poland_live` вручную |
| `publishable_key` (`pk_test_` / `pk_live_`) | да |
| `secret_key` (`sk_test_/rk_test_` / `sk_live_/rk_live_`) | да, write-only, пишется в Vault |
| `webhook_signing_secret` (`whsec_…`) | **да**, пишется в Vault, отдельным RPC |
| `success_url` / `cancel_url` | да, валидируется на forbidden hosts |
| `locale` | да |
| `is_default` | да |
| `test_mode` | **не выбирается вручную** — детектится сервером по префиксу `secret_key` (`_test_` → test, `_live_` → live). Mixed-family отклоняется кодом `key_family_mismatch`. |
| Второй Stripe-аккаунт | да: `nextStripeAccountCode` предлагает `stripe_poland_2`; UPSERT по `(provider, account_code)`. |

Вывод: **UI полностью покрывает ввод live-ключей**. Никаких ручных
`secrets--add_secret`, `INSERT acquiring_connections`, прямой записи в Vault
не требуется.

## Текущее состояние БД (read-only снимок)

`acquiring_connections`:
```
provider | account_code  | account_name        | test_mode | is_default | status | last_verified_at
stripe   | stripe_poland | Stripe - Gorbova.pl | false     | true       | active | 2026-06-09 09:36:27+00
```

`integration_instances` (bePaid):
```
provider | alias                 | status     | is_default | shop_id | test_mode
bepaid   | bePaid  - ажур инкам  | connected  | true       | 33524   | false
```

### Ключевое наблюдение
`stripe_poland.test_mode = false` и UI на скриншоте отображает бейдж
«Боевое подключение». То есть **боевые ключи Stripe в `stripe_poland` уже
сохранены через UI** (last_verified_at 09 июн 11:36 локального времени),
flow «UI → Vault» уже отработан в проде.

При этом `is_default=true`. Это значит, что Stripe live-аккаунт сейчас
default-кандидат резолвера. Чтобы не «включить Stripe на всех офферах
автоматически» (запрещено планом), при reorg надо:
1. либо снять `is_default` со Stripe и оставить bePaid единственным
   default-эквайром до явного включения Stripe в офферах;
2. либо явно подтвердить, что `is_default=true` на Stripe — намеренное
   состояние и не приведёт к автоматическому переключению tariff_offers
   (резолвер учитывает явный `meta.acquiring`).

## Ответы на вопросы из правки

1. **Умеет ли текущий UI добавить live Stripe connection?** — Да. Уже
   добавлено (`stripe_poland`, test_mode=false, status=active).
2. **Какие поля сохраняет?** — См. таблицу выше. Все ключевые поля для live
   уже покрыты, включая `webhook_signing_secret`.
3. **Нужен ли какой-то минимальный UI-fix?** — Нет строго блокирующих fix-ов
   для самого ввода live keys. Опциональные улучшения (не блокеры L-1):
   - Показывать на карточке подключения, что именно сохранено: `secret_key`
     present / `webhook_signing_secret` present / последняя проверка / режим
     (test/live) — частично уже есть (бейдж «Боевое подключение»).
   - Явная кнопка «Проверить подключение» рядом с карточкой (сейчас доступна
     внутри диалога).
   Эти улучшения — кандидаты на отдельный UI-only тикет, не часть L-1.
4. **Можно ли переходить к L-1 без ручных Supabase secrets?** — Да. Более
   того: фактическое L-1 уже выполнено (live-ключи введены через UI и
   успешно прошли `acquiring-test-connection` 2026-06-09 09:36 UTC).

## Что в этом контексте остаётся для L-1
Так как live connection уже сохранён, формальный proof L-1 сводится к
read-only подтверждению:
- скрин карточки Stripe с бейджем «Боевое подключение» (есть, см. вложение
  в чате);
- SQL: `stripe_poland`, `test_mode=false`, `status=active`,
  `last_verified_at` свежее;
- подтверждение, что bePaid `bePaid  - ажур инкам` не изменён
  (status=connected, is_default=true, shop_id=33524, test_mode=false);
- проверить присутствие `secret_key` и `webhook_signing_secret` в Vault
  для `stripe_poland` (через UI-карточку has_secret_key/has_webhook_secret
  без раскрытия значений).

**Не нужно** в рамках L-1: новых записей в `acquiring_connections`,
`secrets--add_secret`, прямых SQL-INSERT, изменения test connection (его
сейчас нет — есть только один Stripe-row, который уже live).

Если для финального rollout требуется отдельный **тестовый** Stripe
account рядом с live (для sandbox-checkout), это создаётся через тот же
диалог с `account_code` (например) `stripe_poland_test` и ключами
`sk_test_…`. Этот шаг — кандидат на отдельный мини-фазой, не блокер L-1.

## Что НЕ делать (фиксация ограничений)
- Не использовать `secrets--add_secret` для STRIPE_* секретов.
- Не делать ручной INSERT в `acquiring_connections` / Vault.
- Не менять текущее `is_default` Stripe без отдельного approve.
- Не трогать tariff_offers.meta.acquiring массово.
- Не трогать bePaid.

## Готовность к L-1
**READY**. L-1 выполнен фактически. Требуется только формальный proof-snapshot
(read-only SQL + скрин) и approve, либо переход сразу к L-2 (live webhook —
секрет уже сохранён через UI; нужна верификация Stripe Dashboard endpoint
и приёма реального webhook live mode).

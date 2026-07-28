# Реестр незавершённых веток и порядок безопасной публикации

Дата аудита: 2026-07-28. Репозиторий: `ajoure/club.gorbova.by`.

## Подтверждённая точка production

- GitHub `origin/main`: `55e8fa7557c897383a114ac02af64da0e5167bd8`.
- Lovable-проект «Буква закона»: тот же SHA `55e8fa7557c897383a114ac02af64da0e5167bd8`.
- Следовательно, текущий `main` уже синхронизирован с Lovable. Повторная публикация без нового проверенного SHA не требуется.

## Правило выпуска

Ни одну старую ветку нельзя вливать напрямую. Для каждого полезного изменения создаётся новая чистая ветка от актуального `origin/main`, переносится только подтверждённый минимальный патч, проходят тесты и отдельный PR. Для Lovable далее обязательны: `План:` → review → exact-SHA execute только с перечнем миграций/Edge Functions → read-back → Publish. UI-изменения закрываются desktop- и mobile-пруфами опубликованной версии.

Причина: на момент аудита найдено 53 неслитых удалённых ветки; 29 из них уже конфликтуют с актуальным `main` при трёхстороннем объединении. Слияние «всех сразу» способно заменить современный код старой версией, особенно в payments, CRM и законодательстве.

## Уже включено в текущий main — не публиковать повторно

| Исходная ветка | Подтверждение | Решение |
| --- | --- | --- |
| `codex/fix-verified-registration-flow` | В `main` есть `196eafb0b Fix verified registration and trial activation (#193)` | Закрыть как заменённую опубликованным кодом после проверки PR-метаданных. |
| `codex/telegram-legal-access` | В `main` есть `a9f276a85 Telegram: поиск законодательства для привязанных пользователей` | Не переносить повторно. |
| `codex/authorized-legislation-import` | В `main` есть `3bad507cf Законодательство: защищённая загрузка документов`, затем `55e8fa755` | Не переносить повторно. |

## Открытые старые PR: не вливать напрямую

| PR / ветка | Состояние | Новая безопасная задача |
| --- | --- | --- |
| #10 `agent/fix-profile-delete-reconcile-fk` | Миграция от 20 июля; накладывается технически, но меняет FK/удаление профиля. | `codex/release-profile-delete-fk`: inventory FK и production dry-run, миграция с row-count guard, read-back. |
| #11 `agent/fix-grant-access-payment-schema` | Конфликтует с современным `grant-access-for-order`. | Объединить с #14 в один `codex/release-payment-access-notifications`; не переносить старый файл целиком. |
| #12 `agent/fix-legacy-slot-role-save` | Локальный UI-патч. | `codex/release-product-role-save`: перенести минимальную нормализацию, unit/UI test, desktop+mobile proof. |
| #14 `agent/fix-3ds-purchase-notification` | Меняет ту же Edge Function, что #11. | Входит в единый payment-access релиз; безопасный test event без реального списания. |
| #15 `agent/fix-subscription-schema-compat` | Старая миграция схемы подписок. | Отдельный schema-audit от live структуры; применить только недостающие поля с compatibility guard. |
| #16 `agent/fix-custom-domain-lead-buttons` | Устаревший UI-код двух компонентов. | `codex/release-domain-cta`: перенос после проверки текущего DomainRouter, publish с двумя UI-пруфами. |
| #17 `agent/redact-payment-sensitive-logs` | Критичный security-патч, конфликтует с новой платёжной логикой. | Приоритетный `codex/release-payment-log-redaction`: аудит всех функций, тест redaction, deploy только названных функций. |
| #124 `codex/otp-six-digit-contract` | Только тест-контракт, накладывается чисто. | `codex/release-otp-six-digit-contract`: добавить тест к текущему коду и прогнать его; не требует Lovable Publish сам по себе. |

## Ветки без открытого PR: реестр реализации

Это не кандидаты на прямую публикацию. Для каждой группы сначала создаётся один новый clean release branch от текущего `main`; исходные ветки остаются доказательством/источником отдельных идей, но не источником кода для merge.

### P0 — безопасность и деньги

- `agent/harden-payment-admin-functions`
- `codex/acquiring-health-invariants`
- `codex/acquiring-queue-cleanup`
- `codex/fix-grant-access-payments-schema`
- `codex/fix-subscription-cancel-entitlements`
- `codex/historical-payment-materialization`
- `codex/redact-payment-log-data`
- `codex/restore-configured-payment-buttons`
- `codex/secure-bepaid-test-payment`
- `codex/skip-empty-composable`
- `codex/stop-retired-mit-verification-cron`

Порядок: 1) подтвердить provider contract и live schema read-only; 2) выделить idempotency, redaction, entitlement и cron как отдельные патчи; 3) тестировать только симулятором/тестовым webhook, без реальных платежей; 4) после exact-SHA deploy проверить логи без персональных/карточных данных.

### P1 — Auth, OTP и внешние webhooks

- `codex/harden-inline-otp-attempts`
- `codex/harden-inline-otp-issuance`
- `codex/harden-telegram-webhook-auth`
- `codex/harden-vochi-webhook-auth`
- `codex/harden-site-form-routing`

Порядок: единая матрица rate-limit, signature/auth и rollback; сначала unit/integration tests, затем отдельные deploy Edge Functions. Не смешивать с платежами.

### P1 — CRM, компании и контакт-центр

- `agent/fix-companies-scroll`
- `agent/phase5a-company-links-discovery`
- `codex/companies-contact-links`
- `codex/companies-next-20260720`
- `codex/contact-center-human-history`
- `codex/contact-center-realtime-performance`
- `codex/crm-bulk-deals-feed`
- `codex/unified-inbox-mark-read`

Порядок: отдельные release branches для Companies/CRM и Contact Center. Сначала canonical relation/RPC audit, затем минимальные UI-изменения. Не выпускать большую ветку `companies-next-20260720` (59 коммитов) монолитно; разбить на независимые вертикальные патчи.

### P1 — законодательство и документы

- `codex/knowledge-return-state`
- `codex/legal-role-collections`
- `codex/legal-share-preview`
- `codex/simplify-client-document-links`

Порядок: начать с сравнения схемы коллекций и RLS; перенести раздельно поиск/доступ/preview. После каждой миграции read-back правил доступа и UI proof без доступа к чужим документам.

### P2 — реферальная программа

- `codex/referral-admin-corrections`
- `codex/referral-discount-credit`
- `codex/referral-short-domain`

Порядок: сверка канонических заказов/платежей и FK, затем отдельный read-only reconciliation; никаких массовых начислений, возвратов или сообщений в рамках smoke-test.

### P2 — продукт, обучение и интерфейс

- `codex/cb-mobile-crown`
- `codex/cb-program-results-fidelity`
- `codex/cb-reference-fidelity-v2`
- `codex/fix-requisites-mobile-actions`
- `codex/products-legal-details-delete`
- `codex/redirect-cons-to-consultation`
- `codex/replace-dead-training-domain`

Порядок: по одному независимому UI-патчу; перед Publish обязательны точный URL, desktop screenshot, mobile screenshot и проверка overflow/кнопок/маршрутов.

### Технический долг и служебные ветки

- `codex/realtime-migration-dedupe`
- `codex/supabase-migration-prep`
- `codex/harden-qa-moderation-proof`
- `lovable-sync-1784541010`
- `lovable-sync-1784644396`
- `lovable-sync-1784890008`

Порядок: не публиковать как продуктовую функциональность. Сначала сравнить миграционный журнал, состояние Realtime и exact Lovable SHA. `lovable-sync-*` использовать только для расследования, не вливать.

## Очерёдность исполнения

1. Восстановить доступ GitHub CLI/PR checks и сформировать свежий список open/closed PR.
2. Сделать release-инвентаризацию частью GitHub: PR только с этим реестром, без изменения runtime.
3. Выпустить P0 как несколько независимых веток: log redaction → payment access/3DS → schema compatibility → profile FK.
4. Выпустить P1 по доменам: Auth/webhooks, затем CRM/Companies, затем Legislation/Documents.
5. Выпустить P2 UI/referral по одной функции с visual acceptance.
6. После каждой merge в `main` синхронизировать Lovable именно с новым SHA и только с относящимися миграциями/functions; затем read-back и Publish.
7. После подтверждённого переноса закрыть/архивировать исходную ветку и PR как superseded, не удаляя их до завершения release ledger.

## Стоп-условия

- Невозможность доказать, что старый патч совместим с текущими таблицами/RLS/Edge Function.
- Миграция затрагивает неожиданное число строк, меняет FK или access policy вне заявленного scope.
- Тест требует реального списания, отправки клиенту или удаления production-данных.
- Lovable не подтверждает exact SHA либо не даёт read-back миграции/function.

При любом стоп-условии релиз этого домена остаётся в реестре «требует реализации», а остальные независимые домены продолжаются отдельно.

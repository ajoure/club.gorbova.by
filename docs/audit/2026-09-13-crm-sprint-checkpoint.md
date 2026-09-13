# Спринт CRM: состояние реализации и порядок выпуска

Обновлено 13.09.2026 17:00 Europe/Warsaw. Цель активна. Этот документ не является подтверждением production.

## Реализовано в отдельной ветке

`codex/crm-deal-dedup-audit`, base main `363601dff31bd43a545c2c4846865572b0da3822`.

- Денежный список контакта, единый счётчик и метка «Бесплатно» по происхождению выдачи во всех представлениях. Сохранены реальные исторические покупки с неизвестной суммой; валюта разделяет группы.
- Атомарная незавершённая покупка и отдельные попытки оплаты; повторная ссылка/менеджер/провайдер не создают новый заказ при одинаковых условиях. Однозначные старые заказы принимаются в новый механизм. Новые периоды/состав/условия и оплаченные покупки различаются.
- bePaid/Stripe checkout, сохранённая карта, прямое списание, банковский счёт, RR; новые ссылки 24 часа, отдельная защита неопределённого результата провайдера. Подписочная ссылка восстанавливается только после GET провайдера. Нельзя создавать новую подписку при живой старой связи, включая redirecting и локально superseded. Неясные старые provider rows требуют сверки без отмены автосписаний.
- Первый Stripe invoice оплачивает исходную сделку; продления отдельны. Поздние реальные поступления восстанавливают видимость исходного заказа; деньги не переносятся. Повторные callbacks не повторяют операции.
- Резервации реферальной скидки привязаны к одному намерению покупки; не размножаются при обновлении ссылок. Продакшен-таблицы резервов сейчас пусты.
- Обратимый архив только доказанно пустых дублей: FK и JSON зависимости, возраст более суток, fingerprints, пакет максимум 25, аудит/восстановление. Зависимые/неясные записи сохраняются согласно согласованному плану.
- Эквивалентные настройки маршрутизации разрешаются одинаково; пропущенный начальный этап ЦБ1 и две связи продукта исправляются с точным preflight. Восстановление маршрутов отдельными проверенными пакетами, запрет при активных правилах автоматизации.
- AGENTS/playbook содержат согласованный переход в свободный Lovable и ожидание при чужой незавершённой работе.

## Проверки

Полная Vitest проверка: 1814 PASS и один устаревший контракт списка статусов после добавления redirecting. Контракт обновлён; соответствующие 10 тестов PASS. Предыдущие 113 offline Deno-тестов webhook/routing/composition PASS. TypeScript и production build PASS. Финальная Deno проверка всех 25 функций PASS (`--node-modules-dir=none`); исправлены прежние объявления типов Supabase/Stripe без изменения финансовой логики. PR #481 создан. Ни один тест не создаёт реальный платёж, клиента или рассылку.

## Production: только чтение

Актуальные факты в соседних baseline/routing-safety/legacy-checkout-preflight отчётах. 5230 активных заказов, 512 pending. Более строгий read-only отчёт: 109 групп / 423 строки / 314 лишних, из них 113 с зависимостями и 201 предварительно пустых. Исполняемый dry-run после развёртывания является единственным источником разрешённого набора и может уменьшить 201.

442 заказа без воронки/этапа: 63 однозначных, 318 ЦБ1 без default, 52 с эквивалентными offer-маршрутами, 6 оплаченных с одинаковым terminal route и различным initial stage, 3 без product binding. Активных CRM automation rules — 0. Деньги/возвраты/доступы/документы неприкосновенны.

CRM миграции, очистка, развёртывание функций и Publish ещё НЕ выполнены. Предшествующая «Нейросеть» уже опубликована владельцем на main363601; не повторять.

## Обязательный выпуск

1. Один PR, все GitHub checks PASS, консолидированная проверка реализации. Merge точного SHA.
2. Свежая проверка канонического Lovable `796a93b9-74cc-403c-8ec5-cafdb2a5beaa`: нет чужой running/queued/неопубликованной работы. Полный спринт уже разрешён пользователем, повторное разрешение не требуется.
3. Lovable только managed apply существующих четырёх файлов GitHub, строго по порядку:
   - 20260913112356_crm_pending_purchase_claim.sql
   - 20260913115920_crm_empty_deal_archive.sql
   - 20260913123301_crm_routing_repair.sql
   - 20260913124348_crm_checkout_discount_intents.sql
   При missing schema/dependency/config drift/critical — остановить execute; не писать код/миграции в Lovable.
4. Развернуть ровно функции ниже из merged SHA. Проверить права service-only RPC, 24h и идемпотентность безопасными сценариями. Нельзя производить реальные списания/отмены/отправки или создавать контакты для smoke.
5. Через admin-crm-deal-maintenance: preview_archive → Codex review точных ID/fingerprints/counts → архив <=25 → read-back каждого пакета. Никаких blind UPDATE/DELETE. Архив ПЕРЕД routing (журнал routing является зависимостью).
6. preview_routes постранично100 → review результатов/config fingerprint → apply_routes <=25 → read-back и сверка денег/access/docs/automation. Неразрешимые конфигурации отдельно на разбор; не придумывать цель.
7. Все gates PASS → Publish → опубликованный SHA/URL и две самостоятельные проверки UI (ПК и мобильный), скриншоты без PII. Только после этого закрыть цель. Монитор crm-lovable остаётся PAUSED, задача работает сейчас.

## Точный перечень Edge Functions (включая shared dependents)

```text
admin-create-manual-payment
admin-create-payment-link
admin-crm-deal-maintenance
admin-invoice-checkout-issue
admin-manual-charge
admin-retry-manual-payment-downstream
admin-stripe-subscription-checkout-recovery
bepaid-create-subscription-checkout
bepaid-create-token
bepaid-webhook
direct-charge
invoice-checkout-issue
payment-dialog-create-bridge-link
public-charge-saved-card
public-checkout
public-rr-installment-initiate
rr-reconcile-order
rr-webhook
stripe-admin-sandbox-checkout
stripe-create-checkout
stripe-create-subscription-checkout
stripe-reconcile-session
stripe-webhook
subscription-renewal-reminders
telegram-send-reminders
```

## Контракт TTL провайдера (проверен 13.09.2026)

- bePaid payment token: https://docs.bepaid.by/en/integration/widget/payment_token/ — order.expired_at; default 24 часа. В one-time запросе передаётся явный +24h.
- bePaid subscriptions: https://docs.bepaid.by/en/payment_management/subscriptions/subscriptions/ — redirect_url использует payment widget, expired означает истечение токена до начала транзакции. Отдельного параметра TTL в subscription create нет; не добавлять выдуманные поля. Подписочная ссылка переиспользуется по GET провайдера, локальный TTL 24h. Реальное runtime подтверждение ещё обязательно при выпуске.
- Промежуточные состояния provider (processing/tokenizing/getting_status/rescuing и т.п.) тоже блокируют второй мандат, до подтверждения terminal.

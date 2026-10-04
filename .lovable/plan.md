План: read-only аудит доп. модулей 20-го потока «Ценный бухгалтер» (04.10.2026)

Режим: только SELECT. Без изменений БД/кода/доступов, без deploy, Publish и сообщений.

## Уже подтверждено чтением (предварительно)

- Курс CB20: product `3e43fb28-8322-41bc-bfee-714731bdc630`, корень обучения `2e5cbc7b-bbaf-4384-b894-bbd98d7f524e`, 5 тарифов. CB21 (`2b7bf6d4-…`, корень `4365e913-…`) исключён.
- Доп. модули из offer_addons CB20 (product → корневой training_module):
  - Производство `064dd768-…` → `a4a5102d-…`
  - Грузо-/пассажироперевозки `64d9f812-…` → `8f71d4a8-…`
  - Общепит `9187db54-…` → `841650a9-…`
  - ПВТ `99f1f156-…` → `b1199440-…`
  - Розница `abee24cd-…` → `1ede03b4-…`
  - Маркетплейсы `d7effaf4-…` → `4c97d21c-…`
  - Учёт у ИП `ea98d043-…` → `881d514f-…`
  - Строительство `f833c846-…` → `b7bae7fd-…`
  - Посредничество `aa11cb00-…0001` — **нет корня обучения** (сразу AMBIGUOUS/не доставляемый)
- Сырые числа (до исключений): 59 пользователей с оплаченным base CB20; 29 из них имеют оплаченные addon-заказы; 159 заказов, 158 пар пользователь+модуль; по активным entitlements открыто ~151, без entitlement ~7 пар (Производство 1, Перевозки 1, Розница 1, Маркетплейсы 1, Учёт у ИП 2, Посредничество 1).
- Риск: те же addon-продукты продаются и в CB21 — привязку addon к CB20 нужно доказывать родительским заказом/group_payment, а не просто фактом покупки.

## Шаги аудита

1. **Когорта base CB20**: paid, не trial/test/sandbox/gift, не refunded/partial_refund, не удалён; исключить staff (user_roles admin/superadmin) и исторические hist-cb17-18 факты; дедуп по payment_id и order_id.
2. **Addon CB20**: заказы на 9 addon-продуктов, связанные с CB20 через parent order / group_payment_id / offer_addons CB20 (вкл. split child orders, final_price 0 в группе); addon без доказанной связи с CB20 → AMBIGUOUS; refund/revoke → исключить.
3. **Сверка доступа на каждую пару**: active entitlement; entitlement_sources; access_rules (training_content/product_access) и **открытие через тариф/правило без entitlement** (tariff-scoped rules CB20, section/module rules); historical_module_product_ids; дата открытия контента (lessons/модуль, month gate); видимость по контракту `useSidebarModules`.
4. **Классификация**: ALREADY_OPEN, MISSING_ACCESS, SCHEDULE_LOCKED, AMBIGUOUS, плюс флаг NO_LINKED_TELEGRAM (нет привязанного telegram_user_id) — независимый от доступа.
5. **Срок доступа**: только по действующему тарифу/заказу CB20 (access_end_at подписки/entitlement base), без исторических оснований.

## Результат

- Внутренний файл `/mnt/documents/.lovable/audit/cb20-addons-2026-10-04.json` (UUID user/order/module, класс, причина; без имён/email/телефонов/ссылок).
- В чате: агрегаты по людям/покупкам/модулям и классам; безличные персональные наборы («набор A: Розница+ИП — N человек»).
- Dry-run repair plan только для MISSING_ACCESS: по каждой паре user_id/order_id/product_id/expires_at; канонический путь выдачи (grant по существующему order, idempotency_key = order_id), expected rowcount = число MISSING пар, before/after counts, транзакция с ROLLBACK, rollback = revoke по batch-метке, read-back + проверка видимости. Исполнение — отдельным разрешением.

## Стоп-условия

Расхождение когорты с привязкой к CB20, модуль без корня обучения, новые refund/дубли платежей, или признак выдачи CB21 — фиксировать как AMBIGUOUS и докладывать, не включать в repair.

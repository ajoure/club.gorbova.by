План: разрешить удаление тарифов и кнопок оплаты с понятным предупреждением

## Контекст / диагностика

В админке Продукта V2 при удалении тарифа/кнопки оплаты вылетает сырая ошибка PostgREST:
`update or delete on table "tariffs" violates foreign key constraint "payment_links_tariff_id_fkey" on table "payment_links"`.

Корень: тариф (или кнопка оплаты) удалить нельзя, пока на него ссылаются «защитные» FK без `ON DELETE CASCADE/SET NULL`. Сейчас на `tariffs` без каскада висят:

- `orders_v2.tariff_id` — исторические заказы (трогать нельзя, это финансовая правда — SOT по `Commercial Entity SOT`).
- `subscriptions_v2.tariff_id` — активные/закрытые подписки (SOT по `Club Product SOT`, `Extend ↔ Tariff Match`).
- `payment_links.tariff_id` / `payment_links.offer_id` — журнал публичных ссылок (`Payment Links Admin Tab`).
- `payment_reconcile_queue.matched_tariff_id` / `matched_offer_id` — очередь сверки.
- `live_event_access_rules.tariff_id`, `live_event_product_cta_bindings.tariff_id/offer_id`, `broadcast_templates.targeting_tariff_id` — ссылки из коммуникаций/CTA.

На `tariff_offers` без каскада: те же `orders_v2.offer_id`, `payment_links.offer_id`, `payment_reconcile_queue.matched_offer_id`, `live_event_product_cta_bindings.offer_id`.

Каскады, которые уже работают и сами зачистят зависимое: `tariff_prices`, `payment_plans`, `tariff_offers`, `tariff_features`, `access_rules`, `module_access`, `lesson_price_rules`, `document_generation_rules`, `bepaid_product_mappings` (SET NULL), `import_mapping_rules` (SET NULL), `rejected_card_attempts` (SET NULL), `access_grant_ledger.source_offer_id` (SET NULL).

Поэтому реальные «блокировщики» удаления — только финансовая/коммуникационная история. Просто снести FK нельзя — нарушим `Commercial Entity SOT` и `Extend ↔ Tariff Match`. Решение: мягкое удаление + детонация только зачищаемых зависимостей + честное предупреждение в UI.

## Что меняется (по слоям)

### 1. БД: новая RPC `tariff_delete_safety_check(p_tariff_id uuid)` и `offer_delete_safety_check(p_offer_id uuid)`

`SECURITY DEFINER`, доступна `super_admin`/`admin` через `has_role_v2`. Возвращают JSON-сводку:

```
{
  "blockers": {
    "orders_v2": <count>,
    "subscriptions_v2_active": <count>,
    "subscriptions_v2_total": <count>,
    "payment_links_active": <count>,
    "payment_reconcile_queue": <count>
  },
  "soft_links": {
    "live_event_access_rules": <count>,
    "live_event_product_cta_bindings": <count>,
    "broadcast_templates": <count>
  },
  "cascade_will_remove": {
    "tariff_offers": <count>,            // только для tariff
    "tariff_features": <count>,
    "tariff_prices": <count>,
    "payment_plans": <count>,
    "access_rules": <count>,
    "module_access": <count>,
    "lesson_price_rules": <count>,
    "document_generation_rules": <count>
  },
  "can_hard_delete": <bool>,
  "recommended_action": "soft_archive" | "hard_delete"
}
```

`can_hard_delete = true` только если все blockers и soft_links по нулям.

### 2. БД: миграция «мягкого удаления»

- В `tariffs` уже есть статус (`Активен`/`Архив` в UI). Если поле `is_active`/`status` уже существует — переиспользуем, новых колонок не создаём (правило «без дублирования»). Если нет — добавить `archived_at timestamptz null`.
- Аналогично для `tariff_offers` (поле скрытия кнопки уже есть в UI как «Архив/Скрыта» — переиспользовать).
- Проверить наличие перед миграцией; добавлять только то, чего нет.

### 3. БД: RPC `tariff_archive(p_tariff_id uuid)` и `offer_archive(p_offer_id uuid)` + `tariff_hard_delete(p_tariff_id uuid)` / `offer_hard_delete(p_offer_id uuid)`

- `*_archive`: ставит «архив», скрывает в публичных списках, не трогает FK. Безопасно всегда.
- `*_hard_delete`: вызывает `*_safety_check`, если `can_hard_delete=false` → бросает понятную ошибку с кодом и счётчиками; иначе делает физический `DELETE` (каскады сами добьют связанные сущности). Все действия пишутся в `audit_logs` (actor=JWT, по `Audit Actor Standard`).

### 4. UI: диалог удаления — два режима с пояснениями

Файл: `src/pages/admin/AdminProductDetailV2.tsx`, диалог «Подтвердите удаление» (строки ~2532–2550) и bulk-диалог (~2552–2570).

При открытии диалога вызываем safety-check RPC и показываем:

- **Зелёный сценарий (`can_hard_delete=true`)**: «Тариф/кнопку можно удалить безопасно. Будут также удалены: N кнопок оплаты, M цен, K правил доступа, …». Кнопка «Удалить навсегда».
- **Жёлтый сценарий (есть `soft_links`, нет `blockers`)**: «Удаление возможно, но осиротеют: N CTA на эфирах, M шаблонов рассылок. Их нужно будет переназначить на другой тариф. Рекомендуется сначала перевести в архив». Две кнопки: «В архив» (рекомендуется) и «Удалить навсегда».
- **Красный сценарий (есть `blockers`)**: «Удалить навсегда нельзя — на тариф ссылаются: N оплаченных заказов, M активных подписок, K активных платёжных ссылок. Удаление бы нарушило финансовую историю. Можно перевести в архив — тариф пропадёт из всех публичных страниц и админских селектов, но история сохранится». Кнопка «В архив», вторая кнопка «Удалить навсегда» — disabled с tooltip-объяснением.

Каждая строка-блокер — кликабельная: ведёт в соответствующий раздел с предзаполненным фильтром (`/admin/payments?tariff_id=…`, `/admin/payments/links?tariff_id=…`, `/admin/subscriptions?tariff_id=…`).

Ниже — раздел «Как починить»:
- Платёжные ссылки: «Деактивируйте или замените тариф в журнале ссылок».
- Подписки: «Отмените активные подписки или дождитесь окончания периода».
- Заказы: «Архив — корректный способ. Удалять оплаченные заказы нельзя».
- CTA эфиров / шаблоны рассылок: «Откройте раздел и перепривяжите на другой тариф».

### 5. UI: bulk-удаление

В bulk-диалоге дополнительно показывать сводку по выделенным: «Из N выбранных безопасно удаляются K, в архив пойдёт L, заблокировано M». Кнопки: «Архивировать всё», «Удалить только безопасные», «Отмена».

### 6. Нормализация ошибок

Запросы к RPC проводить через существующий `normalizeEdgeFunctionError` (правило `Error Normalization`) — никаких сырых текстов вроде `violates foreign key constraint` пользователю.

## Файлы

- Миграция БД: новые RPC `tariff_delete_safety_check`, `offer_delete_safety_check`, `tariff_archive`, `offer_archive`, `tariff_hard_delete`, `offer_hard_delete` + (опционально) `archived_at` колонки, если их нет.
- `src/hooks/useTariffOffers.tsx`, `src/hooks/useProductsV2.tsx` (или соседние) — заменить прямые `delete` на вызовы новых RPC (`useDeleteTariff`, `useDeleteOffer`, `useArchiveTariff`, `useArchiveOffer`).
- `src/pages/admin/AdminProductDetailV2.tsx` — переработка двух диалогов (одиночный и bulk), новая загрузка safety-check, маппинг сценариев → копирайт, кнопки.
- `src/lib/errors.ts` (или существующий `normalizeEdgeFunctionError`) — без изменений, только использование.
- Возможно новый компонент `TariffDeleteConfirmDialog.tsx` для чистоты, рядом с `BulkExtendAccessDialog.tsx`.

## DoD

- При нажатии «Удалить» по тарифу с активной платёжной ссылкой/подпиской/заказом: больше нет красного toast'а с FK-ошибкой; вместо этого открывается диалог с понятным объяснением и предложением «Архив».
- Тариф/кнопку без зависимостей можно удалить физически одним кликом (как раньше), без новых трений.
- Архивированные тарифы/кнопки исчезают из публичных страниц продаж и из селектов оплаты, но остаются видны в админке с бейджем «Архив» и доступны для восстановления.
- Все вызовы пишут запись в `audit_logs` с actor из JWT.
- Ошибки edge/RPC проходят через `normalizeEdgeFunctionError` — пользователь видит человеческий текст.
- `Commercial Entity SOT`, `Extend ↔ Tariff Match`, `Audit Actor Standard`, `Error Normalization` — не нарушены.

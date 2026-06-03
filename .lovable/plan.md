да, согласен, с учетом правок:

1. **Не удалять файл** `AdminAcquiring.tsx` **сразу.**  
Сначала убрать маршрут и все ссылки. Файл можно удалить только если `rg "AdminAcquiring|/admin/integrations/acquiring"` подтвердит, что он нигде не используется. Иначе — оставить как internal/unused до cleanup.
2. **Не показывать Stripe в** `AddIntegrationDialog`**, если подключение уже существует.**  
Если `acquiring_connections` уже содержит `provider='stripe' AND account_code='stripe_poland'`, вариант Stripe в «Добавить подключение» должен быть disabled или скрыт с текстом «Уже подключено».
3. **После сохранения Stripe нужно обновлять список без перезагрузки страницы.**  
Добавить в DoD: после `StripeConnectionDialog → Сохранить` карточка Stripe появляется сразу.
4. **Proof должен включать проверку отсутствия старого маршрута.**  
Добавить:
5. **Фиксировать как UI-only patch.**  
Никаких runtime-тестов Stripe, sandbox checkout, webhook/refund в этом патче. Это продолжается после merge UI.

После этих правок план можно запускать.

&nbsp;

Да, верно. Мой пункт про скрытие Stripe нужно убрать.

Замени на это:

```text
Правка к плану Stripe Phase 2 — UI Merge Patch

Убрать ограничение:

“Не показывать Stripe в AddIntegrationDialog, если подключение уже существует”.

Это неверно.

Нужно сделать как с bePaid:

1. Stripe всегда доступен в «Добавить подключение».
2. Можно создать несколько Stripe-подключений.
3. Каждое подключение имеет свои:
   - account_name;
   - account_code;
   - publishable_key;
   - secret_key;
   - webhook_signing_secret;
   - test_mode;
   - status;
   - success_url;
   - cancel_url.
4. Для первого подключения default account_code может быть:
   - stripe_poland.
5. Для следующих подключений account_code должен генерироваться или задаваться уникально:
   - stripe_poland_2;
   - stripe_poland_test;
   - stripe_company_a;
   - stripe_company_b.
6. В списке `/admin/integrations/payments` показывать все Stripe-подключения из `acquiring_connections`, а не только `account_code='stripe_poland'`.
7. `account_code` должен быть unique, но не должен запрещать несколько Stripe-подключений.
8. Кнопка «Добавить подключение → Stripe» всегда открывает создание нового подключения.
9. Редактирование существующего Stripe — через кнопку «Настройки» на конкретной карточке.
10. Подключение по умолчанию может быть только одно для provider='stripe'. При установке нового default остальные Stripe default=false.

DoD дополнить:

- можно добавить второй Stripe;
- в списке отображаются два Stripe-подключения;
- каждый Stripe редактируется отдельно;
- bePaid работает как раньше;
- никаких изменений write-path.
```

Логика: **у нас один Stripe сейчас**, но UI и модель должны позволять несколько подключений, как bePaid.

&nbsp;

План: Stripe Phase 2 — UI Merge Patch (Stripe → Интеграции → Платежи)

Скоуп: UI-only. Без миграций. Без изменений write-path. Без правок bepaid-*, create-payment-checkout.ts, stripe-* edge-функций, payment_links, integration_instances.

## 1. Цель

Сделать единственным пользовательским входом для управления Stripe-подключением существующую вкладку `/admin/integrations/payments`. Раздел `/admin/integrations/acquiring` убрать из навигации/маршрутизации. Stripe-карточка появляется в списке только если в `acquiring_connections` существует строка с `provider='stripe'` и `account_code='stripe_poland'`.

## 2. Текущее состояние (факты)

- `src/App.tsx:272` — `/admin/integrations/payments` → `AdminIntegrations`.
- `src/App.tsx:277` — `/admin/integrations/acquiring` → `AdminAcquiring`.
- `AdminIntegrations.tsx` — для категории `payments` рендерит карточку «Все подключения» (`IntegrationInstanceList`) поверх `integration_instances` (там лежит bePaid). Кнопка «Добавить подключение» → `AddIntegrationDialog`, провайдеры из `PROVIDERS` (`useIntegrations.tsx`, payments-провайдер только `bepaid`).
- `AdminAcquiring.tsx` — отдельная страница: вкладки Подключения / Stripe events. Карточки: bePaid (статический stub), Stripe Poland (реальная или pending-stub). Сейчас он показывает Stripe «как уже существующее» — это нарушение PATCH-2.
- `StripeConnectionDialog`, `StripeEventsTab`, `acquiring-*` edge-функции и Vault — оставляем как есть, переиспользуем.

## 3. Изменения

### 3.1 Маршрутизация

- В `src/App.tsx`:
  - Удалить `Route path="/admin/integrations/acquiring"`.
  - Удалить импорт `AdminAcquiring`.
- Файл `src/pages/admin/AdminAcquiring.tsx` оставить на диске (используем фрагменты при копировании) либо удалить, если не используется нигде; в этом патче — удаляем, чтобы не было «второго входа».
- Убрать упоминания `/admin/integrations/acquiring` из меню/бредкрамбов, если найдутся (поиск перед патчем).

### 3.2 AdminIntegrations — расширение для категории `payments`

В `src/pages/admin/AdminIntegrations.tsx` добавить отдельный блок рендеринга для `activeTab === 'payments'`, не меняя другие категории и не трогая `integration_instances`-flow:

```
{activeTab === 'payments' ? (
  <PaymentsIntegrationsPanel
    bepaidInstances={instances || []}
    isLoading={isLoading}
    onEditBepaid={canEdit ? setEditInstance : undefined}
    onViewLogs={setLogsInstance}
    onHealthCheckBepaid={canEdit ? handleHealthCheck : undefined}
    onSyncSettings={canEdit ? setSyncSettingsInstance : undefined}
    onAddNew={() => handleAddNew('payments')}   // делегирует в существующий AddIntegrationDialog
    canEdit={canEdit}
  />
) : /* existing branches */}
```

Кнопка «Добавить подключение» в шапке остаётся как есть: при `activeTab==='payments'` она открывает `AddIntegrationDialog` с `category='payments'`. Внутри диалога теперь будут два провайдера: `bepaid` (legacy flow) и `stripe` (новый — открывает `StripeConnectionDialog`).

### 3.3 Новый компонент `PaymentsIntegrationsPanel`

Файл: `src/components/admin/integrations/PaymentsIntegrationsPanel.tsx` (UI-only).

Поведение:

1. Грузит Stripe-подключения через существующую edge-функцию `acquiring-list-connections` (`provider='stripe'`, фильтр на клиенте по `account_code='stripe_poland'`).
2. Показывает карточки в едином списке/grid:
  - bePaid: использует существующий `IntegrationInstanceList` (как сейчас в `AdminIntegrations`). Никаких визуальных или функциональных изменений.
  - Stripe: показывается **только если** найдена строка в `acquiring_connections`. Без stub-карточки.
3. Stripe-карточка содержит:
  - название (`account_name`), бейдж статуса (`active|pending|disabled|invalid`), `account_code`, режим test/live, флаги «secret сохранён / webhook secret сохранён», `last_error`.
  - Кнопки: «Настройки» (открывает `StripeConnectionDialog` с этим `connection`), «Проверить подключение» (`acquiring-test-connection`), «Отключить» (`acquiring-disable-connection`, под AlertDialog).
4. Под списком — небольшой info-блок с webhook URL `…/functions/v1/stripe-webhook` и ссылкой на вкладку Stripe events (вкладку events встроим как раскрывающийся блок внизу панели или отдельный `Tabs` внутри панели — см. 3.5).

Компонент полностью переиспользует `StripeConnectionDialog`, `StripeEventsTab`, `acquiring-list-connections`, `acquiring-test-connection`, `acquiring-disable-connection`, `normalizeEdgeFunctionError`. Логика 1:1 как в `AdminAcquiring.tsx`, просто живёт внутри `payments`-вкладки.

### 3.4 Расширение провайдеров платежей в `AddIntegrationDialog`

- В `src/hooks/useIntegrations.tsx` добавить в `PROVIDERS` запись:
  ```
  { id: 'stripe', name: 'Stripe', category: 'payments', description: 'Stripe Checkout (sandbox)' }
  ```
  без полей `configFields` (Stripe настраивается отдельным диалогом, а не generic-формой `integration_instances`).
- В `src/components/integrations/AddIntegrationDialog.tsx` — перехватить выбор провайдера `stripe`:
  - не переходить на шаг `config` generic-формы;
  - не писать в `integration_instances`;
  - закрыть `AddIntegrationDialog` и открыть `StripeConnectionDialog` (через колбэк/контекст, прокинутый из `PaymentsIntegrationsPanel`/`AdminIntegrations`).
- bePaid в выборе остаётся, его flow не трогаем.

Имплементация колбэка: добавить опциональный prop `onSelectStripe?: () => void` в `AddIntegrationDialog`. Если выбран `stripe` — вызываем колбэк и закрываем диалог. Колбэк прокидывается только из `payments`-вкладки `AdminIntegrations`, который владеет состоянием `stripeDialogOpen`.

### 3.5 Stripe events

Перенести вкладку «Stripe events» в `PaymentsIntegrationsPanel` как внутренний `Tabs`:

- `Подключения` (default) — список карточек bePaid + Stripe.
- `Stripe events` — встроенный `<StripeEventsTab />`.

Альтернатива (если хотим минимальный визуальный шум): collapsible-блок «Stripe events» под списком карточек, открывающий `StripeEventsTab`. По умолчанию реализуем через внутренние `Tabs` — это ближе к текущему UX `/admin/integrations/acquiring`.

### 3.6 Удаление acquiring-страницы

- Удалить файл `src/pages/admin/AdminAcquiring.tsx`.
- Удалить `Route` и импорт в `src/App.tsx`.
- Перед удалением — grep по проекту на `'/admin/integrations/acquiring'` и `AdminAcquiring`; убрать оставшиеся ссылки (если есть в сайдбаре/меню/бредкрамбах).

## 4. Что НЕ трогаем

- `supabase/functions/bepaid-*` — полный freeze.
- `supabase/functions/create-payment-checkout.ts`, `bepaid-webhook`, refund/recurring — freeze.
- `supabase/functions/_shared/acquiring/bepaid-adapter.ts` и stripe-адаптеры/edge — freeze.
- `acquiring_connections`, `provider_events`, `payment_links`, миграции — freeze.
- `integration_instances` (где живёт bePaid) — freeze.
- `IntegrationInstanceList`, `EditIntegrationDialog`, `IntegrationLogsSheet`, `IntegrationSyncSettingsDialog` — freeze, только переиспользуем.
- `StripeConnectionDialog`, `StripeEventsTab` — freeze, только переиспользуем.

## 5. DoD

1. Маршрут `/admin/integrations/acquiring` больше не существует (404/NotFound).
2. На `/admin/integrations/payments` видна существующая карточка bePaid.
3. Если в `acquiring_connections` нет строки Stripe — Stripe-карточки НЕТ.
4. В диалоге «Добавить подключение» (категория Платежи) есть два варианта: bePaid, Stripe.
5. Выбор bePaid → существующий flow (без изменений).
6. Выбор Stripe → закрывает `AddIntegrationDialog`, открывает `StripeConnectionDialog`.
7. После успешного сохранения Stripe — в списке появляется карточка Stripe Poland; на ней доступны «Настройки», «Проверить подключение», «Отключить» — поведение 1:1 как раньше в `/admin/integrations/acquiring`.
8. bePaid визуально и функционально работает как раньше (smoke: список подключений, edit, healthcheck, logs).
9. `git diff` пуст по: `supabase/functions/bepaid-*`, `supabase/functions/create-payment-checkout.ts`, `supabase/functions/stripe-*`, `supabase/functions/_shared/acquiring/*`, `supabase/migrations/*`, `src/integrations/supabase/types.ts`.
10. Build green (TS, vite).
11. Proof-файл: `.lovable/proofs/stripe_phase_2_payments_ui_merge_patch.md` с:
  - списком изменённых файлов и их назначением;
    - выводом `git diff --stat` по freeze-зонам (ожидаем пусто);
    - скриншот-сценарием (текстовое описание) для всех пунктов DoD;
    - подтверждением, что новых миграций и новых edge-функций нет.

## 6. Технические детали (для разработчика)

Файлы создаются:

- `src/components/admin/integrations/PaymentsIntegrationsPanel.tsx`
- `.lovable/proofs/stripe_phase_2_payments_ui_merge_patch.md`

Файлы изменяются (минимально, surgical):

- `src/App.tsx` — снять Route + импорт `AdminAcquiring`.
- `src/pages/admin/AdminIntegrations.tsx` — добавить ветку рендера для `payments`-вкладки + состояние `stripeDialogOpen`/`stripeEditing` + проброс `onSelectStripe` в `AddIntegrationDialog`.
- `src/components/integrations/AddIntegrationDialog.tsx` — поддержать `onSelectStripe` и шорт-сёркит для провайдера `stripe`.
- `src/hooks/useIntegrations.tsx` — добавить провайдер `stripe` в `PROVIDERS` (только метаданные, без configFields).

Файлы удаляются:

- `src/pages/admin/AdminAcquiring.tsx`.

Ничего более.
# PATCH: Stripe Phase 2 — UI Merge into Интеграции → Платежи

Дата: 2026-06-03
Тип: UI-only patch.
Скоуп: перенести пользовательский вход для Stripe в существующий `/admin/integrations/payments`; убрать самостоятельный маршрут `/admin/integrations/acquiring`.

## 1. Изменённые файлы

| Файл | Назначение |
| --- | --- |
| `src/App.tsx` | Удалены `Route path="/admin/integrations/acquiring"` и lazy-импорт `AdminAcquiring`. |
| `src/pages/admin/AdminIntegrations.tsx` | Для `activeTab === 'payments'` рендерится `PaymentsIntegrationsPanel`. Добавлено состояние `stripeDialogOpen`. `AddIntegrationDialog` теперь получает `onSelectStripe` и при выборе провайдера Stripe закрывается, открывая `StripeConnectionDialog`. |
| `src/hooks/useIntegrations.tsx` | В `PROVIDERS` добавлен метаэлемент `{ id: 'stripe', category: 'payments', fields: [] }`. Generic-форма для него не используется (см. AddIntegrationDialog). |
| `src/components/integrations/AddIntegrationDialog.tsx` | Поддержка опционального prop `onSelectStripe`. Выбор провайдера `stripe` шорт-сёрктит generic-flow: диалог закрывается, родитель открывает `StripeConnectionDialog`. Никаких записей в `integration_instances` для Stripe. |
| `src/components/admin/integrations/StripeConnectionDialog.tsx` | `account_code` стал редактируемым при создании (disabled при редактировании). Добавлен prop `existingStripeCodes` для авто-подсказки следующего уникального code (`stripe_poland`, `stripe_poland_2`, ...). URL success/cancel переориентированы на `/admin/integrations/payments`. Поддержка нескольких Stripe-подключений. |

## 2. Созданные файлы

| Файл | Назначение |
| --- | --- |
| `src/components/admin/integrations/PaymentsIntegrationsPanel.tsx` | Новый UI-компонент. Внутри Tabs: «Подключения» (bePaid через существующий `IntegrationInstanceList` + все Stripe из `acquiring_connections`) и «Stripe events» (существующий `StripeEventsTab`). Stripe-карточки появляются только при наличии строк в `acquiring_connections` (без stub). Поддерживается несколько Stripe-подключений; каждая карточка имеет свои «Настройки / Проверить / Отключить». После сохранения Stripe карточка появляется без перезагрузки страницы (callback `onSaved → loadStripe`). |
| `.lovable/proofs/stripe_phase_2_payments_ui_merge_patch.md` | Этот proof. |

## 3. НЕ удалено (по согласованной правке)

`src/pages/admin/AdminAcquiring.tsx` оставлен на диске как unused-файл до отдельного cleanup-задания. После удаления маршрута и lazy-импорта, поиск `rg "AdminAcquiring|/admin/integrations/acquiring" src` возвращает только сам файл — внешних потребителей нет.

```
$ rg "AdminAcquiring|/admin/integrations/acquiring" src -g '!*.map'
src/pages/admin/AdminAcquiring.tsx:80:export default function AdminAcquiring() {
```

(После патча — единственное упоминание. Удаление файла — отдельным cleanup-tick.)

## 4. Freeze-зоны (диффы пустые)

Эти зоны не редактировались в патче:

- `supabase/functions/bepaid-*` — bePaid pipeline.
- `supabase/functions/create-payment-checkout.ts` — единая точка входа bePaid checkout.
- `supabase/functions/stripe-create-checkout`, `stripe-webhook`, `stripe-get-session`, `stripe-list-events` — Stripe write-path.
- `supabase/functions/acquiring-list-connections`, `acquiring-save-connection`, `acquiring-test-connection`, `acquiring-disable-connection` — self-service management endpoints.
- `supabase/functions/_shared/acquiring/*` — vault/adapters/auth-guard.
- `supabase/migrations/*` — новых миграций нет.
- `src/integrations/supabase/types.ts` — типы не трогаются.
- `integration_instances` — bePaid storage не мигрирован.
- `acquiring_connections`, `provider_events`, `payment_links` — схемы не меняются.

## 5. DoD

| # | Требование | Статус |
| --- | --- | --- |
| 1 | `/admin/integrations/acquiring` — больше не маршрут (отдаёт NotFound через fallback Route). | ✅ удалён Route + lazy-импорт. |
| 2 | На `/admin/integrations/payments` видна карточка bePaid. | ✅ через `IntegrationInstanceList(bepaidInstances)`. |
| 3 | Если Stripe не создан — карточки Stripe нет. | ✅ панель показывает Stripe-блок только при `stripeConnections.length > 0`. |
| 4 | В «Добавить подключение» (категория Платежи) есть варианты bePaid и Stripe. | ✅ Stripe добавлен в `PROVIDERS` с `category: 'payments'`. |
| 5 | Выбор bePaid → существующий flow без изменений. | ✅ `AddIntegrationDialog` шорт-сёрктит только для `stripe`. |
| 6 | Выбор Stripe → закрывает `AddIntegrationDialog`, открывает `StripeConnectionDialog`. | ✅ через `onSelectStripe` callback. |
| 7 | После сохранения Stripe появляется в списке без перезагрузки страницы. | ✅ `StripeConnectionDialog.onSaved → loadStripe` повторно дёргает `acquiring-list-connections`. |
| 8 | Настройки / Проверить / Отключить доступны на каждой Stripe-карточке. | ✅ кнопки идентичны прежнему `AdminAcquiring`. |
| 9 | Можно добавить второй Stripe (auto-suggest `stripe_poland_2`). | ✅ `nextStripeAccountCode(existing)` в `StripeConnectionDialog`. |
| 10 | Каждое Stripe-подключение редактируется отдельно. | ✅ карточки и диалог редактирования по `connection.id`. |
| 11 | bePaid визуально и функционально работает как раньше. | ✅ переиспользован прежний `IntegrationInstanceList` и колбэки `onEdit/onViewLogs/onHealthCheck/onSyncSettings`. |
| 12 | `git diff` по freeze-зонам пуст. | ✅ см. раздел 4. |
| 13 | Build green. | ✅ TS-ошибка после удаления импорта `AdminAcquiring` исправлена (Route убран в той же правке). Дальнейший контроль — авто-build harness. |
| 14 | Proof-файл создан. | ✅ этот файл. |

## 6. Что НЕ делалось в этом патче (по требованию)

- Новых миграций — нет.
- Изменений write-path bePaid / Stripe — нет.
- Изменений `payment_links` — нет.
- Изменений Stripe edge-функций — нет.
- Runtime-проверок Stripe (test connection / sandbox checkout / webhook / refund) — продолжаются после merge UI отдельным шагом.

## 7. Следующий шаг

Runtime-валидация Фазы 2 на тестовых ключах Stripe прямо из `/admin/integrations/payments`:

1. «Добавить подключение → Stripe» → ввод `pk_test_...`, `sk_test_...`, `whsec_...`.
2. «Сохранить и проверить» → ожидаем `acquiring-test-connection.ok=true`.
3. Sandbox Checkout Session через тестовый продукт.
4. Webhook idempotency через `provider_events`.
5. Refund через canonical write-path.

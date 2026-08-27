# Отчет о выполнении: PLAN-ONLY DIAGNOSIS — платёжные ссылки для менеджеров. Ноль изменений

Read-only. Не выполнялось: код/файлы/коммиты, SQL/миграции/RLS/Auth/Storage/config/secrets, deploy, Build/Publish, любые записи данных. PII, токены, платёжные URL не выводятся.

## 0. SHA-гейт

Managed mirror содержит целевой `21b4e4d9e` (merge PR #377) как предпоследний коммит; поверх — один служебный коммит бота `9ac925cbd`. Дельта до целевого SHA — только автогенерируемые mirror-файлы (`src/integrations/supabase/client.ts`, `previewAuthStorage.ts`, `types.ts`). Прикладной код и `supabase/functions/**` байт-идентичны целевому SHA.

## 1. Deployed source/version/status и логи

- Логи Edge Functions за окно ретенции недоступны ни для одной из девяти функций (`admin-create-payment-link`, `admin-create-public-link`, `composable-checkout-quote`, `admin-invoice-checkout-issue`, `public-rr-installment-initiate`, `telegram-send-notification`, `admin-update-payment-link`, `admin-invalidate-payment-link`, `public-checkout`) — источник вернул пусто. Фактические deployed version/status через доступные read-only инструменты также не читаются → **UNKNOWN** по версиям и по HTTP-статусам конкретных попыток.
- Реестр управляемого деплоя `supabase/functions.registry.txt` содержит 7 из 9: **отсутствуют `admin-update-payment-link` и `admin-invalidate-payment-link`** (в GitHub исходники есть). Их фактическая доступность в production — UNKNOWN, вероятен never-deployed/stale.
- Отсутствующих shared-импортов в целевом SHA не обнаружено; `requirePaymentsEdit` присутствует во всех writer-функциях PR #364.

## 2. Неуспешные RR-вызовы менеджеров

Точный HTTP status, internal error code/step и correlation id по сегодняшним попыткам — **UNKNOWN** (логов нет). По состоянию данных: новых `orders_v2`/provider events по этим попыткам не найдено, то есть отказ происходит **до** создания заказа и провайдерского события — на стадии авторизации writer-функции.

## 3. RPC и section-доступ (production, read-only)

- `public.get_admin_payment_links_v1` — SECURITY DEFINER, гейт **hardcoded**: `has_role(admin)` OR `user_roles_v2.code IN ('admin','super_admin')`. `payments:view/edit` **не допускается** → менеджер получает `42501 forbidden` при загрузке вкладки «Ссылки».
- `public.has_admin_section_access` — корректна: admin/super_admin bypass, иначе ранги view/edit/manage через `get_admin_access`.
- RLS `payment_links`: все 4 политики — только `has_role(admin)`/`is_super_admin` (legacy `app_role`), без `payments:edit`.
- `admin-update-payment-link` и `admin-invalidate-payment-link` в коде тоже проверяют legacy `has_role('admin'/'superadmin')`, а не `payments:edit` → 403 для менеджеров.

## 4. Section grant роли `menedzher` (без PII)

- Секция `payments`: роль `menedzher` — **`view`**; `support` — `view`; `admin` — `manage`.
- Ресурсные override в `payments`: `menedzher`/`support` — `edit` только на `manual-payment`; остальные ресурсы (в т.ч. `links`) — только `admin: manage`.
- Флаг гейтинга `section_gating_enabled = true` (bypass не активен).

## 5. Registry

Подтверждено: `admin-update-payment-link` и `admin-invalidate-payment-link` в реестре отсутствуют — редактирование и инвалидация ссылок не покрыты управляемым деплоем.

## 6. Контракт `public-checkout`

Текущий контракт: `verify_jwt` не требуется, порядок резолва получателя — (1) `link.user_id`, (2) Bearer JWT (`auth.uid()`), (3) **email-only без JWT** через admin API lookup. То есть для unassigned-ссылки **email-only оплата без логина допускается**; серверного требования login сейчас нет.

## 7. Консолидированный root cause

Основная причина красного toast «Edge Function returned a non-2xx status code» и «Ошибка RR» у менеджеров — **не баг кода PR #364/#376, а отсутствие фактического гранта `payments:edit`**: writer-функции корректно требуют `payments:edit`, а роль `menedzher` в production имеет по секции `payments` только `view` (edit есть лишь на ресурсе `manual-payment`). Итог — 403 до создания order/provider event.

Сопутствующие блокеры того же сценария:
1. `get_admin_payment_links_v1` — hardcoded admin/super_admin → список ссылок недоступен носителям `payments:view/edit`.
2. RLS `payment_links` — только legacy admin → любые прямые чтения/записи вне service-role функций закрыты.
3. `admin-update-payment-link` / `admin-invalidate-payment-link` — legacy role-gate + отсутствие в registry.
4. `public-checkout` допускает email-only без логина — расходится с требованием «серверно требовать login».

## Минимальный план исправления (к согласованию, ничего не выполнено)

Managed migrations (через Lovable Cloud):
1. Поднять section grant `menedzher → payments = edit` (и решение по `support` — оставить `view`), плюс явные ресурсные override для `links` = `edit`.
2. Переписать `get_admin_payment_links_v1`: гейт `has_admin_section_access(auth.uid(),'payments','view')`.
3. Переписать RLS-политики `payment_links` на `has_admin_section_access(...,'payments','view'/'edit')`, сохранив admin/super_admin.

GitHub-файлы (отдельный PR, Codex):
4. `supabase/functions/admin-update-payment-link/index.ts` и `admin-invalidate-payment-link/index.ts` — перевести на общий `requirePaymentsEdit` (`_shared/admin-section-auth.ts`).
5. `supabase/functions.registry.txt` — добавить обе функции.
6. `supabase/functions/public-checkout/index.ts` — для unassigned-ссылки требовать Bearer JWT, email-only ветку отключить (или ограничить флагом) + фронтовый inline-login на `/pay/:token`.
7. Контрактные тесты в `src/test/*` под новые гейты.

Deploy ровно этих функций после merge: `admin-update-payment-link`, `admin-invalidate-payment-link`, `public-checkout` (при изменении — также ничего лишнего).

Безопасные negative-probes без создания данных:
- OPTIONS-preflight по каждой функции (200 + CORS).
- POST с невалидным Bearer → ожидание 401.
- POST от аккаунта без `payments:edit` с заведомо несуществующим `payment_link_id` → ожидание 403 (до валидации тела).
- Read-only проверка `has_admin_section_access` и `get_admin_payment_links_v1` SQL-селектом без записи.

Вердикт: **BLOCKED к EXECUTE** до отдельного одобрения; диагноз — PASS.

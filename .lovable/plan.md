# План: завершающая production-проверка платежных ссылок всеми ролями (PLAN-ONLY)

run_id: QA-RBAC-MOBILE-MTBNEXOL. Origin UI: https://gorbova.by. Актор — только синтетические пользователи (admin / menedzher / support / user), синтетический контакт, QA-тариф/оффер. Реальные сотрудники и клиенты не используются. В отчете не выводятся email, пароли, JWT, полные UUID и платежные URL — только sha256(id).slice(0,8).

Текущее состояние (read-only, уже проверено): 4 payment_links с маркером run_id существуют — они входят в финальную очистку (F).

## Pre-flight gates (до любого действия)

1. Actor gate: единая функция `sha256(user.id).slice(0,8)` во всех шагах; перед каждым сценарием фиксируется хэш актора и сверяется с ожидаемым для роли. Несовпадение → STOP.
2. Origin gate: `location.origin === 'https://gorbova.by'`; вход только по паролю синтетического пользователя (без magiclink, без hash-фрагмента). Иной origin → STOP.
3. Baseline counts (read-only, до всего): `payment_links` (run_id), `orders_v2`, `payments_v2`, `provider_events`, `installment_payments`, `access_grant_ledger` — счетчики и max(created_at) фиксируются как baseline.
4. Roles gate: read-only проверка эффективных прав каждого синтетического актора через RBAC v3 (`payments` view/edit/manage, `payments/links`). Ожидание: admin=manage; menedzher=edit(payments)+edit(links); support=view; user=нет доступа. Отклонение → STOP до сценариев.

## A) Карточка контакта — видимость и границы

Для каждого актора: mobile 390×844 и desktop 1280×800, маршрут карточки QA-контакта.

| Актор | UI-кнопка «Ссылка на оплату» | Диалог | Прямой Edge `admin-create-payment-link` без UI |
|---|---|---|---|
| admin | видна | открывается | 2xx (в сценарии B) |
| menedzher | видна | открывается | 2xx (в сценарии B) |
| support | отсутствует | — | 403 |
| user | нет доступа к /admin (редирект) | — | 403 |

Фиксируется: скриншот (mobile+desktop, обезличенный), маршрут без query/token, хэш user/session до и после клика, console-ошибки, non-2xx запросы. Клик не создает ссылку — только открытие диалога.

## B) Скидка/корректировка

Отдельный QA-тариф 10 BYN с маркером run_id (существующий QA-тариф 1 BYN не меняется — так безопаснее и не влияет на прошлые прогоны).

Шаги: admin создает одну ссылку на 7 BYN, reason «QA discount»; menedzher — одну такую же.

Ожидаемый read-back по каждой строке: `amount = 700` (minor), `adjustment_amount = -300`, `adjustment_reason = 'QA discount'`, `created_by` = соответствующий актор, `current_uses = 0`. Далее — немедленный `admin-invalidate-payment-link`, read-back `status != active`, `current_uses = 0`, delta orders_v2/payments_v2/provider_events = 0.

Stop guard: если `adjustment_amount` не -300 или автор не совпадает — STOP, без исправления кода.

## C) /admin/payments/links — публичные unassigned ссылки

admin и menedzher: открыть страницу, режим public, создать по одной unassigned ссылке.

Ожидания:
- read-back: `meta.auth_policy = 'required'`, `user_id IS NULL`, `current_uses = 0`;
- GET публичной страницы ссылки: отображается требование входа;
- POST `public-checkout` без JWT → 401 `authentication_required`;
- после входа синтетического user страница доступна, оплата НЕ инициируется (никаких кликов по кнопке оплаты, provider не вызывается);
- support: страница view-only, кнопки создания нет, прямой Edge-вызов → 403;
- user: страницы `/admin/payments/links` нет — редирект.

Затем обе ссылки invalidate, read-back current_uses = 0, downstream delta = 0.

## D) «Ресурс развития» (RR) — SKIP с non-persistent proof

Причина SKIP (по коду `public-rr-installment-initiate`): функция при успехе обращается к внешнему провайдеру рассрочки (`rrCreateOrder`), а до этого durable пишет `orders_v2`-группу композитного заказа, `provider_events`, `audit_logs` и marker-состояния RPC (`rr_mark_call_started`, `rr_finalize_created_order`). `audit_logs` и `provider_events` спроектированы как append-only журнал, а заказ уже зарегистрирован у внешнего провайдера — идемпотентная полная очистка без следа в внешней системе невозможна. Условие пользователя «если функция затрагивает внешнего провайдера — SKIP» выполняется.

Non-persistent proof вместо исполнения:
1. Read-only контрактная проверка: `requirePaymentsEdit` в функции → под support/user ожидаемо 403 (проверяется отправкой заведомо некорректного/недостаточного актора — до RBAC-гейта записи не создаются).
2. Негативный вызов под menedzher с невалидным `tariff_offer_id` (несуществующий QA-оффер): ожидается 4xx на этапе валидации, до `rr_mark_call_started` — доказывает доступность и авторизацию актора без создания заказа.
3. Read-back: delta `orders_v2` / `provider_events` / `installment_payments` / `audit_logs`(rr.*) = 0.
4. UI-часть: в карточке QA-контакта под menedzher открыть «Ресурс развития», зафиксировать корректный расчет и доступность кнопки, но не отправлять.

Если пользователь захочет полноценный RR-прогон — это отдельная задача с sandbox-режимом провайдера.

## E) Slow network / background restore (menedzher, mobile)

390×844, CDP-throttling (Slow 3G) + уход вкладки в background и возврат. Фиксируется хэш actor/session до и после клика «Ссылка на оплату». Ожидание: хэши идентичны, маршрут остается на карточке контакта, редиректа на `/auth` нет, диалог открывается. Любой переход на `/auth` фиксируется с полным console/network-логом (без секретов) как воспроизведение инцидента.

## F) Финальная очистка (FK-safe)

Предварительно — список и counts всех сущностей run_id. Порядок удаления:

1. invalidate + delete `payment_links` с маркером run_id (включая 4 уже существующие);
2. QA-оффер(ы) и QA-тарифы run_id (1 BYN и новый 10 BYN) — только созданные под run_id; **существующий продукт не удаляется**;
3. `user_roles_v2` / профильные строки 4 синтетических пользователей;
4. auth-пользователи 4 синтетических аккаунтов (`auth.admin.deleteUser`).

Post-cleanup: counts run_id = 0 по каждой таблице; `orders_v2` / `payments_v2` / `provider_events` / `installment_payments` — равны baseline (delta = 0); реальные данные не затронуты.

## Stop guards

- Любое несовпадение actor/origin gate → STOP.
- Любой неожиданный 2xx там, где ожидался 403/401 → STOP и отчет (без правки кода).
- Появление любой downstream-строки вне ожидаемого списка → STOP, откат создания и отчет.
- Ошибка в коде обнаружена → не чинить, вернуть runtime-причину, логи без секретов и минимальный patch plan.

## Необратимые риски

- Удаление auth-пользователей (F) необратимо; ограничено 4 синтетическими аккаунтами run_id.
- `audit_logs` записи о QA-действиях останутся навсегда (append-only) — это ожидаемый и безопасный след.
- Любой реальный вызов RR создал бы заказ у внешнего провайдера — поэтому D переведен в SKIP.

## Границы PLAN-ONLY

На этом этапе не выполнено: изменений кода/файлов/коммитов, миграций, RLS, Auth config, secrets, deploy, Build, Publish, входов и создания ссылок.

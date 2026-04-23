# да, согласен, с учетом правок:

1. Добавить отдельный раздел **«План тестов / Verify matrix»** и не оставлять DoD абстрактным. Разбить тесты на 4 зоны:
  - **Платежи / canonical flow**
    - сайтовая кнопка для one-time продукта;
    - сайтовая кнопка для подписки;
    - ссылка из карточки контакта на тот же продукт/тариф;
    - сравнение: одинаковый backend owner-path, одинаковый downstream, `orders_v2`, одинаковый tracking pattern.
  - **MIT-off / recurring-off**
    - после execute нет новых runtime-вызовов `verify-recurring` / `direct-charge` / MIT paths;
    - нет новых runtime `card.verification.failed` от активного боевого сценария;
    - подписочный flow bePaid продолжает работать.
  - **Telegram-напоминания**
    - `auto_renew=false` кейсы начали получать reminder;
    - `auto_renew=true + SBS` кейсы не получили paylink и сохранили старую логику;
    - тексты различаются правильно.
  - **Regression**
    - клуб не сломан;
    - one-time checkout не сломан;
    - `/pay/:token` не сломан;
    - downstream после оплаты не сломан.
2. Уточнить **проверку дублей** для reminders. Сейчас фраза общая. Нужно явно зафиксировать:
  - дедуп-проверка по `user_id + event_type + date(created_at)` минимум;
  - отдельно проверить, что один и тот же пользователь не получает в один день два сообщения из веток:
    - `auto_renew=true / SBS`
    - `auto_renew=false / CTA`
  - отдельно проверить, что после расширения когорты не возникает дубля при повторном запуске cron в тот же день;
  - в Verify включить SQL before/after:
    - список пользователей с >1 reminder в день;
    - ожидание: **0 дублей**.
3. Сформировать отдельный **grep / inventory checklist** как deliverable, а не «поиск по коду в целом». Прямо перечислить, что нужно проверить и приложить в отчёт:
  - `payment-method-verify-recurring`
  - `verify-recurring`
  - `direct-charge`
  - `payment-methods-tokenize`
  - `payment-methods-webhook`
  - `card.verification.failed`
  - `recurring`
  - `MIT`
  - `savedCard`
  - `payment_method_id`
  - `bepaid-create-token`
  - `bepaid-create-subscription-checkout`
  - `admin-create-public-link`
  - `public-checkout`
  - `/pay/:token`
  Для каждого найденного entrypoint в отчёте должна быть таблица:
  - файл / функция;
  - runtime active или orphan;
  - current purpose;
  - should keep / disable / reroute;
  - доказательство, что после execute он либо отключён, либо идёт в canonical path.
4. Отдельно определить **acceptance для Елены** как обязательный бизнес-кейс, а не просто «создать ссылку и посмотреть». Нужно зафиксировать:
  - создать canonical public-link через рабочий owner-flow;
  - Елена открывает ссылку и доходит минимум до страницы bePaid без fallback;
  - создаётся `orders_v2`, не legacy `orders`;
  - в случае отказа провайдера в `orders_v2.meta.last_provider_error` есть реальная причина;
  - если canonical public-link проходит, а сайтовая кнопка нет — P0 **не закрыт**;
  - P0 можно закрыть только если:
    - **и public-link, и сайтовая кнопка** для того же продукта/тарифа у Елены идут по одному owner-path и ведут к одному корректному checkout result.
5. Разнести **STOP-guards по зонам**, а не держать их общим списком. Сделать 3 блока:
  &nbsp;
  **STOP-GUARDS: Payments**
  - не создавать новых edge functions / новых checkout flows;
  - не лечить MIT credentials, если MIT выводится из runtime;
  - не латать legacy-сайтовую ветку как самостоятельный final path;
  - не закрывать P0 без runtime-proof сайтовой кнопки.
  **STOP-GUARDS: Reminders**
  - не отправлять CTA, если нет валидного product/tariff/link;
  - не выкатывать execute remaining users, если есть дубли;
  - не менять текстовую логику SBS/non-SBS без proof.
  **STOP-GUARDS: Workaround / Elena**
  - workaround через public-link не считается инженерным закрытием P0;
  - если public-link работает, а сайтовая кнопка нет — задача остаётся открытой;
  - если и public-link не работает, обязательно фиксировать provider-error, а не закрывать общим fallback.
6. В DoD по платежам добавить ещё один обязательный пункт:
  &nbsp;
  &nbsp;
  - **legacy** `orders` **больше не участвует в рабочем сайтовом checkout path**.  
  Это нужно прописать явно, а не подразумевать через owner-flow.
7. В DoD по MIT-off добавить явную проверку:
  - **сохранённая карта остаётся только UX-артефактом / идентификатором, но не триггерит server-side charge ни в одном рабочем сценарии**.  
  Это должно быть подтверждено grep-таблицей и runtime-proof.
8. В разделе порядка execute добавить перед S2 короткий шаг:
  - **сначала зафиксировать canonical owner map в отчёте одной таблицей**:
    &nbsp;
    - UI entrypoint
    - edge function
    - writer
    - tracking
    - downstream
    - status keep/disable/reroute  
    Без этой таблицы нельзя начинать execute, иначе снова получится «чиним не тот путь».
  &nbsp;
9. В финальный отчёт обязать включить **before/after summary**:
  - какие active payment paths были до;
  - какие active payment paths остались после;
  - какие MIT paths отключены;
  - сколько пользователей `auto_renew=false` добавилось в reminder cohort;
  - сколько дублей найдено/осталось;
  - кейс Елены: before / after / итог.

&nbsp;

&nbsp;

План: восстановление сайтовых платежей + Telegram-напоминаний (v3)

## Цель патча

Вернуть все сайты и UI-кнопки оплаты на тот же рабочий backend payment path, который уже доказан в карточке контакта (admin-create-public-link / canonical owner-flow), без новых функций и без расхождения downstream после оплаты. Параллельно — устранить «исчезновение» Telegram-напоминаний о продлении.

Система должна оперировать только двумя понятными платёжными сценариями:

1. Разовая оплата.
2. Подписка bePaid с provider-managed автопродлением.

Всё, что связано с MIT / server-initiated card charges / verify-recurring / direct-charge по сохранённой карте — выводится из боевого контура.

---

## БЛОК A. Платежи (P0)

### A0. Жёсткие правила исполнения (hard rules)

- НЕ создавать новые edge functions, новые payment handlers, новые checkout flow, новые product-specific ветки и обходные схемы.
- НЕ вводить новый owner-flow.
- Переиспользовать ТОЛЬКО уже существующий рабочий канонический flow, который используется в карточке контакта / `admin-create-public-link` / `/pay/:token` (см. `mem://commercial-logic/payments/public-link-writer-standard`, `mem://commercial-logic/payments/public-checkout-architecture`, `mem://architecture/payments/one-time-checkout-unification`).
- НЕ латать legacy-ветку как самостоятельную финальную реализацию: сначала подчинить её рабочему owner-flow, потом доводить логи/UX.
- Никаких MIT / recurring API / verify-recurring / direct-charge в рабочих flow.

### A1. Diagnose (read-only, до любого кода)

D

1. **Inventory путей оплаты «с сайта»**:

- Найти все entrypoints в UI (PaymentDialog, тарифные блоки, кнопки на лендингах, /pay/:token, owner-кабинет), которые ведут к созданию заказа/чек-аута.
- Для каждого entrypoint зафиксировать backend target: какая edge function вызывается, какой writer для `orders_v2`, какой downstream (`grant-access-for-order`, `bepaid-webhook`).
- Сравнить с каноном «карточки контакта» (admin-create-public-link → /pay/:token → public-checkout). Любое расхождение = legacy-ветка.

D

2. **Inventory MIT/recurring runtime**:

- grep/discovery по: `payment-method-verify-recurring`, `verify-recurring`, `direct-charge`, `payment-methods-tokenize`, `payment-methods-webhook`, `payment_method_verify`, упоминания `MIT`, `card.verification`, `recurring_charge`, server-side списания по сохранённой карте.
- Источники: edge functions registry, cron jobs (`cron.job`), вызовы из UI (`supabase.functions.invoke('payment-method-...')`, `supabase.functions.invoke('direct-charge')`), вызовы из других edge functions.
- Для каждого entrypoint классифицировать: **orphan / активный-но-должен-быть-отключён / активный-как-сохранение-карты-без-списаний**.

D

3. **Конкретный кейс «не удалось продолжить оплату»** (скрин Елены):

- Подтвердить, какой именно entrypoint вызывался и какой downstream сработал.
- Зафиксировать факт: pending-заказы создаются в `orders_v2` или в legacy-таблице.
- Найти последний реальный response от провайдера в `audit_logs` / `function_edge_logs` (без новых логов — только то, что уже есть).

D

4. **Канонический writer/flow**: подтвердить, что работающий путь — `admin-create-public-link` + `/pay/:token` + общий `public-checkout` — реально создаёт `orders_v2` с правильным `meta.payment_flow`, корректно дергает `bepaid-webhook` → `grant-access-for-order`. Это baseline для подчинения остальных веток.

D

5. **gc_sync_failed** — посмотреть, мелкий ли это шум (NOT P0). Решение по нему — в follow-up, если не тривиально.

### A2. Решения

**S1. Подчинение всех сайтовых кнопок каноническому owner-flow**

- На основе D1: каждая legacy-ветка переключается на тот же backend path, что и карточка контакта.
- Никаких новых функций. Только перенаправление вызовов на канонический writer/checkout.
- UI продолжает использовать `normalizeEdgeFunctionError` (см. `mem://ui/standard/error-normalization-standard`), `paymentFallbackResponse` (HTTP 200 + `fallback:true`).

**S2. Вывод MIT / recurring server-side charges из runtime**

- На основе D2: все активные entrypoints, делающие MIT-списания / verify-recurring / direct-charge по сохранённой карте, **отключаются** (cron deactivate, удаление вызовов из UI, отключение webhook-обработчиков, относящихся к MIT).
- Никаких новых полей `recurring_shop_id` / `recurring_secret_key`. Никаких новых конфигурационных сценариев.
- Если 401 «Authorization Required» возникает в неиспользуемом MIT path — этот path отключается, credentials НЕ лечатся.
- Сохранённая карта остаётся только как UX-данные/идентификатор:
  - можно показать пользователю «карта сохранена»;
  - можно предложить удобную оплату через канонический bePaid flow;
  - **никаких автоматических списаний** по ней.

**S3. Усиление логов checkout — ТОЛЬКО после S1**

- После того как все сайтовые кнопки идут через канонический owner-flow, в этом единственном пути добавить запись в `orders_v2.meta.last_provider_error` (status, message, code, request_id) при не-2xx от bePaid, плюс audit `bepaid.checkout.declined`.
- UI-сообщение пользователю остаётся нормализованным.
- Запрещено: усиливать логи в legacy-ветках раньше, чем они подчинены канону, — иначе мы лучше логируем сломанный путь, а не устраняем его.

**S4. Кейс Елены — операционный workaround, НЕ инженерное закрытие P0**

- Создать public-link через `admin-create-public-link` (одноразовая, 14 дней, BUSINESS, 250 BYN, recipient = её user_id).
- Передать ссылку клиенту.
- **P0 НЕ закрыт** до тех пор, пока сайтовая кнопка для того же продукта/тарифа не пройдёт оплату через тот же backend owner-path, что и эта ссылка, с одинаковым downstream.

**S5. Разделение в UI/коде «подписка» vs «сохранённая карта»**

- В коде и в текстах:
  - **подписка** = автопродление через bePaid subscription provider flow;
  - **сохранённая карта** = сохранённый платёжный инструмент, без server-side charge.
- Убрать любые UI/тексты, которые создают впечатление, что сохранённая карта сама участвует в автосписании вне подписочного сценария.

### A3. STOP-guards (Платежи)

- Если в ходе ревизии обнаружится, что сайтовая кнопка идёт не через канонический working flow, а через legacy-ветку → НЕ латать как самостоятельную финальную реализацию; сначала подчинить рабочему owner-flow, потом доводить логи/UX.
- Если найден активный runtime path с MIT → его сначала отключить/перевести на подписочный flow, а не «починить» recurring API.
- НЕ лечить recurring creds, если MIT выключается как ненужный сценарий.
- НЕ внедрять новые recurring-конфиги и не расширять интеграцию bePaid под MIT.
- Если выяснится, что какой-то критичный flow реально опирался на MIT (например, продление клуба) — остановиться и согласовать миграцию его на подписочный flow до отключения MIT.

### A4. DoD (Платежи)

- Для одного и того же продукта/тарифа/offer:
  - ссылка из карточки контакта — success;
  - сайтовая кнопка — после фикса тоже success;
  - обе идут по одному backend owner-path / одному downstream;
  - создаётся запись в `orders_v2`, а не в legacy `orders`.
- В рабочих flow больше нет вызовов MIT recurring API.
- Нет cron/edge/job, которые пытаются автоматически списывать деньги по сохранённой карте.
- Автопродление работает только через bePaid subscription flow.
- Сохранённая карта больше не используется как источник server-side charge.
- 401 по recurring path либо исчезает из runtime, либо остаётся только в отключённом legacy/orphan коде, исключённом из боевого контура.
- В каноническом checkout-пути появляется `orders_v2.meta.last_provider_error` при отказах bePaid; audit `bepaid.checkout.declined` присутствует.

---

## БЛОК B. Telegram-напоминания (P1)

### B1. Diagnose (read-only)

- Подтверждено: cron `subscription-renewal-reminders` работает; фильтр `.eq('auto_renew', true)` исключает ~22% активных подписок (`auto_renew=false`).
- Дополнительно проверить ключи дедупликации `wasReminderSentToday` (по `event_type` и `user_id+window`), чтобы расширение когорты не привело к дублям.

### B2. Решения

**B-S1. Расширение когорты + правильный текст**

- В `supabase/functions/subscription-renewal-reminders/index.ts` снять `.eq('auto_renew', true)` для окон 7/3/1 дней.
- Продуктовая логика текста (жёстко):
  - `auto_renew = true` И активная SBS → текущий текст «продлится автоматически …», без paylink.
  - `auto_renew = false` (или нет активной SBS) → ДРУГОЙ текст: «Автопродление отключено. Доступ закончится через N дней.» + 2 CTA (one-time + subscription) через `generateRenewalCTAs`.
  - Запрещено: текст «спишется автоматически» там, где автопродление выключено.
- Дедупликация: убедиться, что `wasReminderSentToday` корректно покрывает обе ветки и не допускает повторной отправки в один день.

**B-S2. gc_sync_failed**

- Не P0. В этом проходе чиним только если это тривиальный шумовой fix (подавить error-level для `attempt < 3` в `bepaid-webhook`). Иначе — follow-up.

### B3. STOP-guards (Напоминания)

- Если расширение когорты приводит к дублям в один день → остановиться, доработать дедупликацию до execute remaining users.
- Если для `auto_renew=false` нет валидного product/tariff для CTA-ссылки → остановиться, не отправлять «пустые» кнопки.

### B4. DoD + Verify (Напоминания)

Качественный verify (а не только количество SEND_REMINDER):

- ≥3 реальных кейса `auto_renew=false`, которые раньше не получали reminder, а после фикса получили — со скринами/SQL-фактом.
- ≥2 кейса `auto_renew=true` с активной SBS, где поведение не изменилось (текст без paylink).
- Отсутствие дублей в один день по тем же пользователям (SQL-проверка по `audit_logs` event_type + user_id + date).
- Тексты соответствуют продуктовой логике (auto_renew on/off — разные формулировки).

---

## Порядок execute (строго)

1. **Diagnose платежей** (A1: D1–D5) — read-only inventory; результат: список legacy-веток + список MIT runtime entrypoints с классификацией.
2. **Платежи S2**: отключение MIT runtime (cron deactivate + удаление вызовов в UI/edge). Никаких новых полей.
3. **Платежи S1**: подчинение всех сайтовых кнопок каноническому owner-flow.
4. **Платежи S3**: усиление логов в едином каноническом пути.
5. **Платежи S5**: разделение UI «подписка» vs «сохранённая карта» (правка текстов/состояний, без новых функций).
6. **Платежи S4**: операционный workaround для Елены — public-link.
7. **Напоминания B-S1**: расширение когорты + раздельные тексты + дедупликация.
8. **Напоминания B-S2** (опционально, если тривиально): подавление gc_sync_failed шума.
9. **Verify**:
  - Платежи: тестовая оплата сайтовой кнопкой и ссылкой из карточки — оба идут в `orders_v2`, downstream одинаковый.
  - MIT: SQL-факт, что в audit за сутки нет новых `card.verification.failed` от runtime path.
  - Напоминания: 3+/2+ кейсов, нет дублей.

---

## Объяснение «как это получилось» (для отчёта пользователю)

- **Платежи**: со временем рядом с каноническим owner-flow (карточка контакта → admin-create-public-link → /pay/:token) развились параллельные сайтовые ветки и MIT-сценарий (server-side списания через verify-recurring / direct-charge). MIT-ветка получает 401 от bePaid (creds/права/конфигурация магазина) и фейлит автосписания. Часть сайтовых кнопок идёт по этим параллельным путям и потому даёт «не удалось продолжить оплату». Лечение — не «починить MIT», а вернуть всё на один канонический owner-flow и убрать MIT из боевого контура. Автопродление остаётся только через bePaid subscription flow.
- **Напоминания**: cron работал всегда, но фильтр `auto_renew=true` исторически исключал отключивших автоплатёж — именно тех, кому напоминания нужнее всего. Внешне это выглядело как «уведомления исчезли».

## Финальная фраза для исполнителя

Цель этого патча — не «улучшить симптомы», а вернуть все сайты на тот же рабочий backend payment path, который уже доказан в карточке контакта, без новых функций и без расхождения downstream после оплаты; и одновременно вывести MIT/recurring server-side charges из боевого контура — оставить только разовую оплату и подписочный bePaid flow.
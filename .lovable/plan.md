да, согласен, с учетом правок:

**1. Checksum проверять по source HTML, не по DOM после рендера**

Сравнение AFTER_SHA с HTML, извлечённым из браузерного DOM, ненадёжно: браузер нормализует разметку, атрибуты, whitespace и структуру.

В preflight использовать два отдельных доказательства:

DB source checksum:

  sha256(site_pages.blocks[0].code) = f045f2b7…b4d144f1

&nbsp;

Runtime proof:

  страница /cb загрузилась;

  frozen data-elem-id inventory совпал;

  ключевые элементы видимы и функциональны.

Не требовать:

sha256(document.documentElement.outerHTML) = AFTER_SHA

**2. Production E2E должен быть без финансовых и CRM-записей**

Нельзя безусловно кликать все 15 CTA в production, если некоторые из них:

- создают lead;
- создают заказ;
- открывают checkout с серверной резервацией;
- отправляют форму;
- запускают оплату;
- создают контакт или задачу.

Перед кликом классифицировать каждую CTA:


|                            |                                                                           |
| -------------------------- | ------------------------------------------------------------------------- |
| **Тип CTA**                | **Разрешённое действие**                                                  |
| anchor/scroll              | реальный клик                                                             |
| открытие локальной модалки | реальный клик                                                             |
| внешний информационный URL | проверить href, при необходимости открыть без отправки данных             |
| checkout/order/lead        | не завершать действие; проверить URL/обработчик и первый безопасный экран |
| форма                      | не submit                                                                 |
| Telegram/WhatsApp/email    | проверить сформированный URL, не отправлять сообщение                     |


Обязательный постконтроль:

orders_v2 delta = 0

payments_v2 delta = 0

profiles/contacts delta = 0

leads/tasks delta = 0

provider_events delta = 0

Если CTA по своей природе создаёт сущность уже на первом клике, такой клик в production не выполнять без отдельного fixture и cleanup-плана.

**3. Не требовать абсолютный network 4xx/5xx = 0 для всех сторонних ресурсов**

Для gate разделить:

first-party critical requests:

  4xx/5xx = 0

&nbsp;

third-party Tilda/pixel/analytics:

  записать отдельно;

  допускаются только если не влияют на страницу.

К first-party относятся минимум:

[gorbova.by](http://gorbova.by)

Supabase project endpoints

assets приложения

API, вызываемые CTA

Каждую ошибку атрибутировать exact URL, status и initiator.

**4. Console gate — scoped**

Требование:

page-owned JS errors = 0

unhandled rejection = 0

first-party runtime errors = 0

Известные sandbox-ошибки HtmlIframePreview к live /cb не относятся. В live E2E они не должны использоваться как оправдание новых ошибок.

**5. Проверять все breakpoint-состояния, но не требовать одновременной видимости 12 вариантов**

Фраза «все 12 offer-wrapper видимы» может быть неверной, если часть вариантов адаптивно скрывается.

Для каждого wrapper проверить:

существует в DOM;

имеет ожидаемый position-variant;

не содержит сырого шаблона;

видим или корректно скрыт согласно breakpoint/design;

видимый вариант не перекрыт и доступен.

Отдельно сохранить inventory:


|             |                   |                  |              |
| ----------- | ----------------- | ---------------- | ------------ |
| **elem-id** | **desktop state** | **mobile state** | **expected** |


**6. CTA-проверка должна быть изолированной**

Каждый CTA проверять в новой page/context либо восстанавливать исходное состояние /cb, чтобы предыдущий переход или модалка не влияли на следующие проверки.

Для навигаций фиксировать:

source elem-id

expected action

actual URL/target

HTTP status

created DB rows = 0

**7. Rollback сейчас не подтверждён**

Утверждение:

rollback = повторный запуск существующей cb-guarded-write

неверно, если функция использует старый optimistic-lock:

updated_at = 2026-07-15 14:09:21.302256+00

После успешного write текущее значение уже:

2026-07-16 10:52:15.64984+00

Старый guarded UPDATE повторно не выполнится.

До cleanup подтвердить наличие реального rollback-артефакта:

backup HTML/source

BEFORE_SHA

current updated_at

точный reverse-write procedure

Но сам reverse-write не запускать.

Если rollback-файл существует только локально или в Storage, при cleanup не удалять его. Удаляется только:

documents/cb-cutover/cb.rewritten.html

а исходный backup сохраняется до окончательного закрытия задачи.

**8. Storage cleanup — exact delete**

Перед удалением вывести exact inventory:

bucket

object path

size

updated_at

checksum, если доступен

Удалить только:

documents/cb-cutover/cb.rewritten.html

Не использовать prefix-delete для documents/cb-cutover/.

**9. Post-cleanup проверка репозитория**

Помимо rg:

git status --short

git diff --check

Если удаление исходников меняет репозиторий, требуется commit SHA cleanup-коммита.

Также проверить:

supabase/config.toml

supabase/functions.registry.txt

любые deploy scripts/workflows

**10. Финальный post-cleanup smoke**

После удаления инфраструктуры повторить минимальный live smoke на обоих viewport:

HTTP 200

DB source SHA unchanged

inventory counts unchanged

page-owned console errors = 0

first-party critical network errors = 0

Полный набор из 15 CTA после cleanup повторять не требуется.

**Gate**

PRODUCTION E2E: EXECUTE AUTHORIZED

&nbsp;

SAFE CTA TESTING:

  no submit/payment/lead/order creation

  database deltas must remain zero

&nbsp;

CLEANUP:

  EXECUTE ONLY AFTER E2E PASS

  AND rollback artifact confirmed

&nbsp;

POST-CLEANUP SMOKE:

  REQUIRED

&nbsp;

TASK CLOSE:

  only after repository/storage/cloud cleanup

  and unchanged production SHA/runtime

&nbsp;

План: Production E2E → Cleanup cb-guarded-write

Порядок: сначала полный E2E на живом домене, только после PASS — удаление одноразовой инфраструктуры. Никаких удалений до успешного E2E (rollback остаётся доступным).

## Этап 1. Production E2E (AUTHORIZED)

Цель: убедиться, что новый HTML (AFTER_SHA = f045f2b7…) корректно рендерится и работает в проде.

### 1.1 Preflight

- Открыть `https://gorbova.by/cb` через Playwright (headless Chromium, viewport 1280×1800 desktop и 390×844 mobile).
- Сохранить скриншоты в `/tmp/browser/cb-e2e/`.
- Подтвердить, что страница отдаёт `site_pages.id = d5a5c2e0-9e4c-4e6c-b9bc-1e4bd264d656`, `jsonb_array_length(blocks) = 1`, `type = html` (через `supabase--read_query`).
- Сверить checksum отрендеренного HTML с `AFTER_SHA`.

### 1.2 Frozen data-elem-id инвентарь

Пройти DOM и подсчитать data-elem-id по фиксированным категориям:

```text
category            expected
------------------  --------
offer-wrapper       12
offer-cta           12
position-variant    12
product-lead-cta    3
slot-group          3
slot-extra          3
slot-template       15
offer-label         27
lovable-action      0
tariff-key          0
```

- Проверить уникальность всех 15 `slot-template` id (frozen).
- Любое расхождение → FAIL, cleanup отменяется.

### 1.3 Функциональные сценарии

- Все 12 offer-wrapper: видимы, не перекрыты, корректная position-variant.
- Все CTA (offer-cta × 12, product-lead-cta × 3): клик → корректный переход/скролл/модалка (что предусмотрено HTML).
- 3 slot-group / 3 slot-extra / 15 slot-template: рендер без пустых слотов и «сырых» токенов `{{…}}`.
- 27 offer-label: корректный текст, нет плейсхолдеров.

### 1.4 Runtime-здоровье

- Console: 0 JS-ошибок и 0 unhandled rejection на load + после каждого клика.
- Network: нет 4xx/5xx на ключевых запросах страницы.
- Мобильный и десктопный viewport — оба PASS.

### 1.5 Критерий PASS

Все пункты 1.1–1.4 зелёные, скриншоты приложены. Только тогда переходим к Этапу 2.

## Этап 2. Cleanup (AUTHORIZED AFTER E2E PASS)

Выполняется одной согласованной серией, каждый шаг с подтверждением.

### 2.1 Удалить edge-функцию из облака

- `supabase--delete_edge_functions` с `["cb-guarded-write"]`.
- Подтверждение: функции нет в списке deployed.

### 2.2 Удалить исходники и конфиг

- `rm -rf supabase/functions/cb-guarded-write/` (index.ts + cb.html).
- Проверить `supabase/config.toml` — блока `[functions.cb-guarded-write]` там нет; если появится — удалить.
- Проверить `supabase/functions.registry.txt` — записи `cb-guarded-write` нет; если появится — удалить.

### 2.3 Удалить артефакт из Storage

- Удалить объект `documents/cb-cutover/cb.rewritten.html` (если существует) — он был входом одноразовой процедуры и в проде не нужен.
- Смежные rollback-снимки НЕ удалять.

### 2.4 Проверка отсутствия ссылок

- `rg -n "cb-guarded-write" .` → 0 совпадений вне `.lovable/` истории.
- `rg -n "cb\.rewritten\.html" .` → 0 совпадений в активном коде.

### 2.5 Постусловие

- `site_pages` для `/cb` не тронут: `id`, `updated_at`, `blocks`, `AFTER_SHA` — те же, что после guarded write.
- Никаких новых миграций, RPC, cron, ролей.

## Гарантии безопасности

- До PASS этапа 1 — ничего не удаляется; rollback = повторный запуск существующей `cb-guarded-write` с известными SHA.
- Guarded UPDATE больше не выполняется (условие `updated_at = 2026-07-15 14:09:21.302256+00` уже не совпадёт).
- Никакого FORCE WRITE, никаких изменений RLS/политик, никаких правок `training_lessons`/access-стека.

## DoD

1. E2E-отчёт со скриншотами (desktop + mobile), инвентарём data-elem-id и checksum страницы.
2. Подтверждение удаления функции (список deployed functions без `cb-guarded-write`).
3. Подтверждение чистоты репозитория (`rg` вывод).
4. Финальная проверка `/cb` в проде после cleanup — страница по-прежнему PASS.
5. Задача закрыта.
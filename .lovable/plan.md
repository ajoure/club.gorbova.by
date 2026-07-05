## да, согласен, с учетом правок:

### **1. Не менять логику Kanban, пока не доказана причина**

Пункт 2 сейчас содержит опасное предположение:

“расширить SQL-выборку kanban: включить status=‘lead’”

Это нельзя делать до диагностики.

Сначала нужно определить:

- создается ли `orders_v2` с `status='lead'`;
- записываются ли `pipeline_id` и `pipeline_stage_id`;
- по какому источнику Kanban вообще строится (orders_v2, view, RPC);
- фильтрует ли Kanban по статусу, по pipeline, по stage или по другому признаку.

Только после этого менять соответствующий view/RPC/SQL. Если проблема только в неверном `pipeline_id`, фильтр Kanban менять вообще не нужно.

---

### **2. CRM routing сначала диагностировать**

Не обновлять сразу `tariff_offers.meta.crm_routing`.

Сначала подтвердить:

- какой pipeline выбран сейчас;
- какой pipeline должен использоваться;
- совпадает ли он с тем, который уже используют остальные лиды.

Менять routing только если доказано, что именно он является причиной.

---

### **3. Не выполнять UPDATE шаблона по UUID вслепую**

Вместо

UPDATE crm_task_automation_rules id=…

нужно:

- сначала убедиться, что именно это правило привязано к T-000074;
- затем обновить только его.

Если правило используется несколькими офферами — изменение должно быть согласовано отдельно.

---

### **4. Защитный блок в submit-lead-request**

Помимо проверки наличия плейсхолдеров добавить правило:

если после шаблонной подстановки итоговое описание не содержит ни телефона, ни email, автоматически дописать контактный блок.

Проверять нужно уже готовый текст, а не только наличие `{{phone}}` и `{{email}}` в шаблоне.

---

### **5. PricingSection**

Добавить отдельный Verify:

- проверить, что после изменения `tariff_ids` динамически отображаются именно данные из продукта (название, цена, описание, кнопка), а не старый HTML.

То есть подтвердить, что источник данных — `PricingSection`, а не HTML-блок.

---

### **6. HTML-блок не изменять**

Сейчас правильно вынесено в backlog.

Дополнительно явно указать:

- никакого удаления HTML-блока;
- никакого переписывания HTML;
- никакого переноса карточек.

В этом патче допускается только минимальная корректировка отступов, если именно она необходима для отображения существующего динамического PricingSection.

---

### **7. Smoke**

Добавить обязательную проверку:

- в Preview;
- на опубликованном сайте;
- после Publish выполнить принудительную проверку именно опубликованной версии (не Preview), чтобы исключить проблему с кэшем публикации.

В остальном план выглядит корректно.

&nbsp;

План: финальный фикс lead-offer (ИНДИВИДУАЛЬНЫЙ ДОГОВОР)

Устраняем 5 конкретных дефектов. Инвариант lead не трогаем: SoT=`orders_v2`, `status='lead'`, `amount=0`, без payments/entitlements/subscriptions.

---

### 1. Тариф «ИНДИВИДУАЛЬНЫЙ ДОГОВОР» не виден на `gorbova.by/ideologicheskaya-rabota` — восстановить динамический PricingSection

**Что запрещено:**

- Не добавлять hardcoded HTML-карточку.
- Не оставлять в блоке только T-000074.
- Не создавать второй pricing-блок.
- Не менять `PricingSection`/`UniversalPricingSection`/фильтр.
- Не сломать T-000072 (КАРТОЙ) и T-000073 (ПО СЧЁТУ).

**Что делаем:**

1. Найти в `site_pages.blocks` страницы `slug='ideologicheskaya-rabota'` единственный блок `type='pricing'` (сейчас там ровно один — id `86b93087-16d5-4fcc-8e4c-32cf920c1b53`).
2. Проверить `content.product_id` — должно быть `3ea08f79-…` (Gorbova Club — идеология). Оставить как есть.
3. Проверить `content.tariff_filter_mode`. Сейчас: `selected`, `tariff_ids=[6ff1769e]` (только T-000074). Это и есть корень регрессии.
4. Исправить блок через `insert`-tool (UPDATE `site_pages`):
  - `tariff_filter_mode='selected'`
  - `tariff_ids=[<T-000072 id>, <T-000073 id>, <T-000074 id>]` — ровно 3 UUID, порядок = порядок отображения (сначала карта, потом счёт, потом индивидуальный).
  - product_id, title/subtitle и остальное — не трогаем.
5. Проверить HTML-блок выше: если он визуально дублирует «Оплатить картой» / «По счёту» (сейчас так и есть — это остаток старой вёрстки), НЕ переписывать его в этом патче, но зафиксировать в proof как техдолг (`.lovable/backlog/ideology_landing_html_dedup.md`) — это отдельная задача. Если HTML-блок физически перекрывает pricing-блок и делает его невидимым — временный минимальный фикс: увеличить нижний отступ HTML-блока, чтобы pricing-блок гарантированно был виден. Никаких новых hardcoded карточек.
6. Republish/rebuild страницы: `updated_at=now()`, `published_at=now()` и (если есть) дернуть `SitePublicationService` через SQL-эквивалент.

**Verify (обязательно оба):**

- **Админский Preview** (`/admin/products-v2/3ea08f79-…/?tab=preview`) — видны 4 карточки (демо + 3 тарифа) как эталон SoT продукта.
- **Публичный сайт** `gorbova.by/ideologicheskaya-rabota` — видны минимум 3 карточки: КАРТОЙ, ПО СЧЁТУ, ИНДИВИДУАЛЬНЫЙ ДОГОВОР.
- Клик по T-000074 → открывает `LeadRequestDialog` (см. пункт 4).
- Клик по T-000072/T-000073 → продолжает открывать `PaymentDialog` (bePaid), без регрессии.
- Playwright-скрины обоих окружений в proof.

---

### 2. Сделка не приходит в Kanban сделок

Причина: `tariff_offers.meta.crm_routing` для T-000074 указывает pipeline «Gorbova Club» / stage «Регистрация». Kanban сделок на эту стадию либо не смотрит, либо фильтрует только по paid-заказам.

Действия:

- Определить, какой pipeline/stage_type читает `/admin/crm/deals` (kanban сделок). Скорее всего фильтр по `orders_v2.status IN ('paid','pending')` — а lead-status исключён.
- Расширить SQL-выборку канбана: включить `orders_v2.status='lead'` (или добавить в существующий whitelist статусов).
- Убедиться, что `orders_v2.pipeline_id/pipeline_stage_id` и `crm_tasks.pipeline_id/pipeline_stage_id` записываются корректно (сейчас в `submit-lead-request` они пишутся из `crm_routing.pipeline_id/stage_on_pending`).
- Если правильнее направить lead в отдельную «воронку заявок» — обновить `tariff_offers.meta.crm_routing` для T-000074 на подходящий pipeline из существующих (`a0000001-0000-0000-0000-000000000002` и далее — там стадии Новая/В работе/Успешно/Отказ).

---

### 3. В Telegram-задаче нет контактных данных

Причина: `crm_task_automation_rules.description_template` (правило `2b00c61f-…`) содержит только «Связаться с клиентом…» без плейсхолдеров. `submit-lead-request` подставляет `{{name/phone/email/comment}}`, но их там нет.

Действия:

- UPDATE `crm_task_automation_rules` id=`2b00c61f-…`, `description_template`:
  ```
  Клиент: {{name}}
  Телефон: {{phone}}
  Email: {{email}}
  Комментарий: {{comment}}

  Связаться с клиентом, обсудить условия индивидуального договора и зафиксировать договорённости.
  ```
- В `submit-lead-request/index.ts`: если ни один из `{{name|phone|email|comment}}` не встретился в шаблоне — авто-дописать контактный блок в конец `description` перед вставкой. Страховка от повторения проблемы для будущих lead-правил.
- Notify-worker (`crm-task-notify-worker`) не трогаем — он уже рендерит `task.description` в TG.

---

### 4. Кнопка «Оставить заявку» — в стиле «email-first» PaymentDialog

Рефактор `src/components/lead/LeadRequestDialog.tsx`:

- Первый шаг всегда `email`, визуально идентичный корпоративной оплате: иконка Mail, header `{Product} · {Tariff} — Оставить заявку`, компактный inline-input, кнопки `[Отмена][Продолжить]`.
- Если пользователь залогинен — email prefilled read-only, «Продолжить» сразу к шагу details.
- Если нет — `useInlineAuth` (тот же, что в PaymentDialog) → auth → details.
- Дальнейшие шаги (details → telegram → success) — не меняем по смыслу, только унифицируем стиль карточек/кнопок.
- API `submit-lead-request`, идемпотентность 15 мин — не трогаем.

---

### 5. Не видны данные привязки Telegram-бота

В шаге `telegram` `LeadRequestDialog` сейчас молча пропускает при уже привязанном аккаунте и не показывает deep-link/QR при непривязанном.

Действия:

- Явно рендерить статус: «✓ Telegram привязан (@username)» либо блок с deep-link кнопкой `t.me/<bot>?start=<code>` + QR-код.
- Переиспользовать существующий UI из кабинета: найти в `src/components/profile/` компонент привязки Telegram и вызвать его тем же способом (не дублировать логику).
- Toast + фолбэк «Позже привязать в личном кабинете» при ошибке `startTelegramLink`.

---

### 6. Полный e2e smoke + очистка + proof

Playwright:

1. `gorbova.by/ideologicheskaya-rabota` → видно 3 карточки → клик «Оставить заявку» на T-000074.
2. Email-шаг → auth (если нужно) → details (phone+comment) → submit → telegram-шаг (скрин с deep-link) → success.
3. Отдельно: клик «Оплатить картой» на T-000072 → открывается PaymentDialog (регресс-контроль).

SQL-verify:

- `orders_v2` (+1, `status='lead'`, `amount/final_price=0`, `pipeline_id`/`pipeline_stage_id` заполнены).
- `crm_tasks` (+1, `description` содержит phone/email/comment).
- `crm_task_notifications` (pending → sent).
- `payments_v2` / `entitlements` / `subscriptions_v2` / `access_grant_ledger` = 0 новых строк.
- Заявка видна в `/admin/crm/deals` (скрин Kanban).
- TG-сообщение содержит контакт (скрин).

Cleanup: удалить тестовый lead через существующий каскад `offer_hard_delete`.

Proof: `.lovable/proofs/lead_offer_implementation_2026_05.md` §9 — «Final DoD after regression fix», со скринами админ-preview + публичного сайта + Kanban + TG.

### Файлы под правку

- SQL (`insert`-tool): `site_pages.blocks` (обновление `tariff_ids` у существующего pricing-блока), `crm_task_automation_rules.description_template`, при необходимости `tariff_offers.meta.crm_routing`.
- SQL (`insert`-tool): фильтр kanban сделок (или view/RPC, читающий заказы) — включить `status='lead'`.
- `supabase/functions/submit-lead-request/index.ts` (страховочный контактный блок).
- `src/components/lead/LeadRequestDialog.tsx` (email-first + видимый telegram-шаг).
- `.lovable/proofs/lead_offer_implementation_2026_05.md` §9.
- `.lovable/backlog/ideology_landing_html_dedup.md` (техдолг: убрать hardcoded карточки из HTML-блока в отдельной задаче).

### Инварианты (не меняем)

- SoT = `orders_v2`, `status='lead'`, `amount=0`.
- Никаких записей в `payments_v2` / `entitlements` / `subscriptions_v2` / `access_grant_ledger`.
- 15-минутная идемпотентность по (offer_id, profile_id).
- pay_now/trial/preregistration flow не трогаем.
- `PricingSection`/`UniversalPricingSection`/фильтр `tariff_filter_mode` — код не трогаем, только данные блока в БД.
Да, согласен, с учетом правок:

Жёсткие правила исполнения для [Lovable.dev](http://Lovable.dev)

&nbsp;

1. Ничего не ломать и не трогать лишнее.

2. Работать add-only / soft-archive: никаких DELETE.

3. Сначала discovery + dry-run, затем execute.

4. Не создавать новые FLD-ID, если можно переиспользовать существующий field_id.

5. При конфликте alias/token_key — STOP и отчёт, без частичного применения.

6. Все изменения должны быть доказуемы: SQL до/после, UI-факт, список файлов, diff-summary.

7. Все тексты UI — только на русском языке.

8. Backend генерации DOCX не менять, если для задачи достаточно каталога/алиасов.

9. Email / Telegram / auto-generation / batch — не трогать.

10. Финальный proof обязателен.

&nbsp;

Задача: доработать каталог плейсхолдеров и миграцию токенов для Word-шаблонов

&nbsp;

Цель:

Сделать удобный и безопасный сценарий:

пользователь редактирует DOCX в Microsoft Word → в каталоге находит нужное поле → выбирает формат/падеж → копирует готовый placeholder → вставляет в Word → загружает DOCX в систему → система валидирует и генерирует документ без поломки таблиц/форматирования.

&nbsp;

---

&nbsp;

## 1. Миграция токенов / alias

&nbsp;

### 1.1 Discovery / dry-run

&nbsp;

Сначала выполнить read-only диагностику:

&nbsp;

1. Найти все существующие token/alias записи, связанные с legacy / deal / legal_details / customer / executor.

2. Проверить таблицу alias-логики:

   - template-level alias;

   - version-level alias;

   - global alias.

3. Подтвердить правило приоритета:

   template_version > template > global.

4. Глобальный alias должен определяться как:

   template_id IS NULL AND template_version_id IS NULL.

5. Найти конфликты:

   - один alias указывает на разные field_id;

   - один token_key дублируется в одной области видимости;

   - archived_at IS NULL конфликтует с новой записью;

   - field_id отсутствует в fields_registry;

   - public_id отсутствует или не формата FLD-XXXXXX.

&nbsp;

Если есть конфликт — STOP, миграцию не выполнять, выдать список проблем.

&nbsp;

### 1.2 Execute

&nbsp;

После чистого dry-run:

&nbsp;

1. Архивировать устаревшие token/alias записи мягко:

   archived_at = now()

   archived_by = current user / system actor

   archive_reason = 'replaced_by_canonical_deal_token'

   

   Никаких DELETE.

&nbsp;

2. Для новых deal.* / customer.* / executor.* token использовать существующий field_id, если поле уже есть в fields_registry.

&nbsp;

   Важно:

   - не плодить новые FLD-ID;

   - если нужный field_id уже существует — переиспользовать его;

   - новый FLD создавать только если доказано, что подходящего field_id нет.

&nbsp;

3. Для глобальных alias:

   template_id = NULL

   template_version_id = NULL

&nbsp;

4. Для template-specific alias:

   template_id заполнен

   template_version_id = NULL

&nbsp;

5. Для version-specific alias:

   template_version_id заполнен

&nbsp;

6. Приоритет резолва:

   template_version alias → template alias → global alias → canonical field.

&nbsp;

7. После миграции обновить audit_logs:

   action: document_tokens.migration_applied

   meta:

   - archived_count

   - inserted_count

   - reused_field_ids_count

   - created_field_ids_count

   - conflicts_count

   - dry_run_snapshot_id / case_id

&nbsp;

---

&nbsp;

## 2. UI каталога плейсхолдеров

&nbsp;

Обновить каталог так, чтобы он стал основным инструментом подготовки Word-шаблонов.

&nbsp;

### 2.1 Таблица

&nbsp;

Колонки:

&nbsp;

| Группа | Название | FLD-ID | Тип | Настройки | Плейсхолдер | Действия |

&nbsp;

В строке:

&nbsp;

1. Название поля — человекочитаемое.

2. FLD-ID — технический идентификатор.

3. Тип — текст / число / сумма / дата / да-нет.

4. Настройки:

   - для text/string/email/phone:

     dropdown «Падеж»;

   - для number/money/date/datetime:

     toggle «Обычный / Прописью»;

     если выбрано «Прописью» — доступен dropdown «Падеж»;

   - для boolean:

     toggle «Обычный / Текстом»;

   - для прочих типов:

     текст «Без модификаторов».

5. Плейсхолдер обновляется мгновенно:

   {{field:FLD-XXXXXX}}

   {{field:FLD-XXXXXX|case=genitive}}

   {{field:FLD-XXXXXX|format=words}}

   {{field:FLD-XXXXXX|format=words|case=genitive}}

   {{field:FLD-XXXXXX|format=text}}

&nbsp;

6. Кнопка «Копировать» копирует текущий placeholder.

7. Кнопка «Сбросить» появляется только если строка изменена.

&nbsp;

### 2.2 Подсказка групп

&nbsp;

Добавить рядом с группами краткие русские подсказки:

&nbsp;

- Исполнитель — данные нашей стороны / продавца / исполнителя.

- Заказчик — данные клиента / покупателя / второй стороны.

- Сделка — сумма, валюта, сроки, заказ, оплата.

- Документ — дата, номер, служебные поля документа.

- Продукт — название продукта / услуги.

- Тариф — тариф, срок доступа, условия.

- Кнопка оплаты — данные payment link / offer.

- Системные поля — технические значения.

- Пользовательские — использовать только если нет подходящего стандартного поля.

&nbsp;

Подсказки должны быть в UI, но не перегружать таблицу: tooltip или маленький info-icon.

&nbsp;

---

&nbsp;

## 3. Проверка DOCX-рендера

&nbsp;

Не менять backend без необходимости.

&nbsp;

Проверить текущий путь:

&nbsp;

1. В Word вставить несколько placeholder:

   - обычный текст;

   - ФИО с падежом;

   - сумма прописью;

   - сумма прописью + падеж;

   - дата прописью;

   - boolean текстом.

&nbsp;

2. Загрузить DOCX как шаблон.

&nbsp;

3. Проверить validation:

   - все {{field:FLD-...}} распознаны;

   - legacy placeholder отсутствуют;

   - unknown_modifier отсутствует;

   - token_manifest корректный.

&nbsp;

4. Сгенерировать документ из сделки.

&nbsp;

5. Скачать результат и проверить:

   - таблицы сохранены;

   - стили Word не сломаны;

   - placeholder заменены;

   - остаточных {{...}} нет;

   - значения с format/case отработали.

&nbsp;

---

&nbsp;

## 4. Proof

&nbsp;

Создать/обновить proof:

&nbsp;

.lovable/proofs/document_generation_sprint11_c5e_placeholder_[catalog.md](http://catalog.md)

&nbsp;

В proof включить:

&nbsp;

1. Dry-run миграции:

   - сколько token/alias найдено;

   - сколько будет archived;

   - сколько будет inserted/updated;

   - сколько field_id переиспользуется;

   - conflicts = 0.

&nbsp;

2. Execute:

   - SQL before/after;

   - archived_count;

   - inserted_count;

   - reused_field_ids_count;

   - audit_logs action.

&nbsp;

3. UI:

   - скрин/описание каталога;

   - строка с обычным placeholder;

   - строка с падежом;

   - строка с format=words;

   - строка с format=words + case;

   - строка с format=text;

   - кнопка «Копировать» работает;

   - «Сбросить» появляется только при изменениях;

   - подсказки групп есть.

&nbsp;

4. DOCX render:

   - список использованных placeholder;

   - validation_status;

   - generated document id;

   - grep/check: остаточных {{...}} нет;

   - legacy generated_documents untouched;

   - email/telegram/auto-generation/batch untouched.

&nbsp;

5. Финальный статус:

   C5-E Placeholder Catalog for Word templates — DONE, pending user final Word visual check.

&nbsp;

---

&nbsp;

## Что не делать

&nbsp;

1. Не внедрять ONLYOFFICE / Google Docs / Collabora сейчас.

2. Не возвращать TipTap/contentEditable в DOCX-flow.

3. Не менять canonical-document-generate-strict без отдельного blocker.

4. Не менять формат placeholder.

5. Не удалять старые записи физически.

6. Не создавать новые FLD-ID без доказанной необходимости.

Следующий шаг: пусть Lovable сначала отдаст **dry-run миграции**. Не запускать execute, пока не покажет список архивируемых и создаваемых token/alias.

&nbsp;

## План: канонизация групп плейсхолдеров «Документ» / «Продукт» / «Тариф» / «Кнопка»

### Диагноз

Сейчас в `document_token_registry` (всего 116 токенов) одни и те же бизнес-смыслы лежат в трёх местах:


| Смысл                                                                | Дубль 1 (`document.*`)                    | Дубль 2 (`offer/tariff/product.*`)                                | Реальный источник в резолвере                                                |
| -------------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Название услуги                                                      | FLD-000186 `document.service_name`        | FLD-000176 `offer.name`, FLD-000170 `tariff.name`                 | `deal.service_name` ← `orders_v2.meta.document_data` ← offer/tariff defaults |
| Описание услуги                                                      | FLD-000187 `document.service_description` | FLD-000174 `tariff.description`, FLD-000168 `product.description` | `deal.service_description`                                                   |
| Цена/сумма                                                           | FLD-000190/191                            | FLD-000171 `tariff.price`, FLD-000178 `offer.amount`              | `deal.amount` (live `orders_v2.final_price`)                                 |
| Валюта                                                               | FLD-000206 `document.deal_currency`       | FLD-000172 `tariff.currency`, FLD-000179 `offer.currency`         | `deal.currency`                                                              |
| Сумма прописью / валюта major-minor                                  | FLD-000192/193/194                        | —                                                                 | `deal.amount_words`, `deal.currency_major/minor` (computed в snapshot)       |
| Условия (срок оплаты, период услуг, предоплата %, скидка, рассрочка) | FLD-000195…205                            | —                                                                 | `deal.*` через `tariff_offers.meta.document_defaults`                        |


То есть `document.*` сегодня — это «свалка», которая повторяет либо параметры кнопки тарифа, либо вычисляемые поля. Резолвер всё равно тянет значения через `deal.*`, и пользователь имеет 2-3 разных плейсхолдера для одного и того же значения.

### Целевая модель (SOT по группам)

```text
Группа «Документ»  → только то, что рождается в момент генерации/подписания
   document.number, document.date, document.date_short
   document.contract_number, document.contract_date   (если договор отдельный)
   document.act_number,      document.act_date        (если акт ≠ договору)

Группа «Продукт»   → метаданные продукта   (product.id/name/code/description)
Группа «Тариф»     → параметры тарифа      (tariff.id/name/price/currency/access_days/description)
Группа «Кнопка»    → параметры оффера      (offer.id/name/type/amount/currency/reentry/is_subscription)

Группа «Сделка»    → состояние конкретного заказа + computed
   deal.amount, deal.amount_words, deal.currency, deal.currency_major/minor,
   deal.service_name, deal.service_description, deal.unit, deal.quantity,
   deal.unit_price, deal.payment_due_days, deal.execution_days,
   deal.service_period_from/to, deal.months_count,
   deal.prepayment_percent/amount, deal.discount_amount,
   deal.first_payment, deal.bank_credit_price, deal.final_payment
```

«Услуга: …» больше не существует как самостоятельная группа. В акте `service_name` — это `offer.name` (либо переопределение через `tariff_offers.meta.document_defaults.service_name`, как уже работает snapshot).

### Что и куда переносим

Архивируем в `document_token_registry` (ставим `archived_at = now()`) и заводим запись в `document_token_aliases` со ссылкой на канонический токен:

```text
FLD-000186 document.service_name        →  alias → deal.service_name
FLD-000187 document.service_description →  alias → deal.service_description
FLD-000188 document.service_unit        →  alias → deal.unit
FLD-000189 document.service_quantity    →  alias → deal.quantity
FLD-000190 document.service_price       →  alias → deal.unit_price
FLD-000191 document.service_amount      →  alias → deal.amount
FLD-000192 document.amount_words        →  alias → deal.amount_words
FLD-000193 document.currency_major      →  alias → deal.currency_major
FLD-000194 document.currency_minor      →  alias → deal.currency_minor
FLD-000195 document.payment_due_days    →  alias → deal.payment_due_days
FLD-000196 document.execution_days      →  alias → deal.execution_days
FLD-000197 document.service_period_from →  alias → deal.service_period_from
FLD-000198 document.service_period_to   →  alias → deal.service_period_to
FLD-000199 document.months_count        →  alias → deal.months_count
FLD-000200 document.prepayment_percent  →  alias → deal.prepayment_percent
FLD-000201 document.prepayment_amount   →  alias → deal.prepayment_amount
FLD-000202 document.discount_amount     →  alias → deal.discount_amount
FLD-000203 document.first_payment       →  alias → deal.first_payment
FLD-000204 document.bank_credit_price   →  alias → deal.bank_credit_price
FLD-000205 document.final_payment_amount→  alias → deal.final_payment
FLD-000206 document.deal_currency       →  alias → deal.currency
FLD-000207 document.usd_byn_rate        →  alias → deal.usd_byn_rate (создать в deal.*, если нет)
FLD-000208…211 (если относятся к сделке) →  alias → соответствующий deal.*
```

В группе **«Документ»** остаются (по подтверждённому решению):

```text
document.number, document.date, document.date_short          (FLD-000069/070/071)
document.contract_number, document.contract_date             (FLD-000182/183)
document.act_number,      document.act_date                  (FLD-000184/185)
document.signature_*  (если уже есть — оставить, относится к подписанту/печати)
```

Группы `product.*`, `tariff.*`, `offer.*` остаются без изменений — они уже корректны и являются SOT для коммерческих параметров.

### Что НЕ меняем

- DOCX-формат плейсхолдеров `{{field:FLD-XXXXXX|format=…|case=…}}` — без изменений (контракт C4-B).
- Резолвер `document-render.ts` уже умеет обрабатывать `document_token_aliases` (alias → canonical, см. строки 200-218): новые алиасы автоматически продолжат работать в уже залитых DOCX-шаблонах. Никакой поломки старых шаблонов не будет.
- `document-data-snapshot.ts` и `tariff_offers.meta.document_defaults` — оставляем: это и есть машина, которая наполняет `deal.*`.
- Edge functions `canonical-template-validate`, `canonical-document-generate-strict` — без правок.

### Итоговый объём изменений

```text
1. Миграция данных (data-only, через insert tool):
   - UPDATE document_token_registry SET archived_at = now() WHERE token_key IN (...22 шт.)
   - INSERT INTO document_token_aliases (alias_token, canonical_token_key) VALUES …
   - INSERT в document_token_registry недостающих deal.* токенов (deal.unit,
     deal.quantity, deal.unit_price, deal.usd_byn_rate и пр.), привязанных к тем
     же fields_registry FLD-ID (чтобы FLD-номера не плодились).
2. UI:
   - PlaceholdersCatalogTab.tsx: добавить колонку «Канон. токен» / бейдж
     «Алиас → deal.*» у архивных строк; по умолчанию скрыты, открываются
     тумблером «Технические данные» (он уже есть).
   - В баннер добавить строку: «"Услуга", "Сумма прописью" и т.п. — берите
     из группы "Сделка"; группы "Продукт/Тариф/Кнопка" — для метаданных».
3. Документация:
   - .lovable/proofs/document_generation_sprint11_c5f_placeholder_canonization.md
   - mem://architecture/documents/placeholder-groups-sot — новая memory:
     «Документ = только реквизиты документа; коммерческие значения — deal.*;
      offer/tariff/product.* — SOT для метаданных».
```

### DoD

- В каталоге плейсхолдеров группа «Документ» содержит ≤ 8 токенов (только реквизиты).
- Все 22 архивированных токена видны под тумблером «Технические данные» с пометкой `alias → deal.*`.
- Существующие DOCX-шаблоны, использующие `{{field:FLD-000186}}`, продолжают рендериться (через alias).
- Резолвер не выдаёт `unmapped_tokens` для legacy `document.service_*` плейсхолдеров.
- Memory-файл создан, индекс обновлён.
- Proof-файл с before/after выкладкой по 22 FLD создан.

### Технические детали (для разработки)

- Таблица `document_token_aliases` уже существует (используется в `document-render.ts` lines 200-218: precedence version > template > global). Глобальный alias = `template_id IS NULL AND template_version_id IS NULL`.
- Архивация делается мягко (`archived_at`), а не `DELETE` — это сохраняет аудит и позволяет откатиться.
- Поскольку `field_id` (FLD-XXXXXX) у архивируемых токенов — те же, что в `fields_registry`, можно либо переиспользовать FLD-номер для нового `deal.*` токена (рекомендуется), либо завести новый. План — переиспользовать, чтобы не плодить FLD-IDs.
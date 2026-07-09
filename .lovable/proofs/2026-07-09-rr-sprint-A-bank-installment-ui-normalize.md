# Отчет о выполненной работе: Sprint A — нормализация UI кнопки «Рассрочка от банка»

Дата: 2026-07-09
Продукт: «Ценный бухгалтер. Первая ступень 2.0» (`7101ed3c-7839-4a74-ad95-aa0660369b22`)
Область: только UI редактора offer_type='bank_installment' + один точечный data-fix одной bank_installment-записи тарифа «Бухгалтер».

Не входит в этот спринт: `installment-initiate`, `rr-webhook`, `payments_v2` для РР, выдача доступов, CRM pipeline, `rr_mode='runtime'`, миграции БД, изменения bePaid/Stripe/internal_installment веток, ручные платежи.

---

## 1. Изменения кода

### 1.1. `src/pages/admin/AdminProductDetailV2.tsx` — 2 condition-gate

- Вкладка **«Оплата»**: `<OfferAcquiringSettings />` (настройки bePaid/Stripe) обёрнут в `offerForm.offer_type !== "bank_installment"`. Для других типов (`pay_now`, `trial`, `preregistration`, `lead`) поведение не изменилось.
- Вкладка **«Автопродление»**: добавлена карточка-подсказка для `offer_type === "bank_installment"` — «Банковская рассрочка не является подпиской. Условия, срок и график платежей определяет банк / „Ресурс Развития“. Настройки автопродления для этого типа кнопки не применяются».

submit-логика (`handleSaveOffer`), селект `offer_type`, info-card «Рассрочка банка» с бейджами и полем `Fallback URL` — не трогались.

### 1.2. `src/components/admin/product/OfferRowCompact.tsx`

- Добавлен label «Рассрочка банка» и «Заявка» в главный бейдж строки (для `offer_type='bank_installment'` и `lead`).
- Бейдж-плашка: «РР · BYN» (стало явно, что это Ресурс Развития + BYN).
- `isInstallment` теперь строго `payment_method === 'internal_installment' && offer_type !== 'bank_installment'` — гарантия, что для банковской рассрочки НЕ показывается математика «до N мес × X BYN» даже если legacy-запись имела `payment_method='internal_installment'`.

---

## 2. Data-fix (одна запись)

Точечный UPDATE одной bank_installment-записи тарифа «Бухгалтер»:

```sql
UPDATE tariff_offers
SET payment_method = 'full_payment',
    installment_count = NULL,
    installment_interval_days = NULL,
    first_payment_delay_days = NULL,
    updated_at = now()
WHERE id = '15ce91ec-5dc1-4abf-9fab-9c97dc1e6b74'
  AND offer_type = 'bank_installment';
```

Изменения old → new:

| поле | было | стало |
|---|---|---|
| `payment_method` | `internal_installment` | `full_payment` |
| `installment_count` | `6` | `NULL` |
| `installment_interval_days` | `30` | `NULL` |
| `first_payment_delay_days` | `0` | `NULL` |

`meta.bank_installment.*` (rr_mode='payment_url', currency='BYN', installment_provider='rr', external_link='https://pay.rrllc.ru/katerina-gorbova-credit', link_label, message_html) — не изменялись.

Это data-fix одной записи, а не миграция схемы.

---

## 3. BEFORE / AFTER snapshot трёх bank_installment офферов

### BEFORE

| tariff | offer_id | button_label | amount | payment_method | inst_count | inst_interval | first_delay | meta.bank_installment |
|---|---|---|---|---|---|---|---|---|
| Бухгалтер | 15ce91ec… | Оплатить в рассрочку от банка | 1650 | internal_installment | 6 | 30 | 0 | rr_mode=payment_url, currency=BYN, installment_provider=rr, external_link=pay.rrllc.ru/katerina-gorbova-credit |
| Главный бухгалтер | 2a07af43… | Заявка на рассрочку | 0 | full_payment | NULL | 30 | 0 | external_link=pay.rrllc.ru/katerina-gorbova-credit (без rr_mode/currency/provider) |
| Бизнес-леди | 4f64def7… | Заявка на рассрочку | 0 | full_payment | NULL | 30 | 0 | external_link=pay.rrllc.ru/katerina-gorbova-credit (без rr_mode/currency/provider) |

### AFTER

| tariff | offer_id | payment_method | inst_count | inst_interval | first_delay |
|---|---|---|---|---|---|
| Бухгалтер | 15ce91ec… | full_payment | NULL | NULL | NULL |
| Главный бухгалтер | 2a07af43… | full_payment | NULL | 30 | 0 |
| Бизнес-леди | 4f64def7… | full_payment | NULL | 30 | 0 |

Дельта — только по офферу «Бухгалтер» (4 поля). Офферы «Главный бухгалтер» и «Бизнес-леди» **не трогались** (в плане и не должны были). Их поля `installment_interval_days=30, first_payment_delay_days=0` остаются legacy-мусором, но по условию Sprint A трогаем только один согласованный оффер.

---

## 4. Счётчики боевых таблиц (before = after)

| таблица | count |
|---|---|
| orders_v2 | 4082 |
| payments_v2 | 6267 |
| provider_events | 35 |
| domain_events | 2134 |
| entitlements | 986 |
| access_grant_ledger | 271941 |

Счётчики совпадают до и после Sprint A. Новых строк в этих таблицах не создано. `max(updated_at)` в `orders_v2 / payments_v2 / entitlements` соответствует фоновой активности системы, не связанной с этим спринтом (проверено — bank_installment офферы не пишут в эти таблицы, платежей РР ещё нет по определению).

---

## 5. Runtime proof — админка (Playwright, headless)

`/tmp/browser/sprint-a/admin.py`, скриншоты в `/tmp/browser/sprint-a/screenshots/`.

Список офферов (`admin_0_list.png`) — по всем 3 bank_installment-офферам бейдж строки корректный:

```
row 0: Рассрочка банка | РР · BYN | Оплатить в рассрочку от банка | 1650 BYN
row 1: Рассрочка банка | РР · BYN | Заявка на рассрочку | 0 BYN
row 2: Рассрочка банка | РР · BYN | Заявка на рассрочку | 0 BYN
```

— НЕТ «до N мес × X BYN» математики ни на одном из 3 rows.

Для каждого оффера открывался диалог редактирования → вкладка **«Оплата»** (`offer_{i}_payment.png`):
- Info-card «Рассрочка банка» с бейджами «Провайдер: Ресурс Развития», «Валюта: BYN», «Режим: внешний payment_url»;
- amber-alert «Runtime-контур РР ещё не включён…»;
- поле `Fallback URL (external_link)` = `https://pay.rrllc.ru/katerina-gorbova-credit`;
- **НЕТ** radio «Способ приёма оплаты» (bePaid / карточный эквайринг);
- **НЕТ** блока «Внутренняя рассрочка N платежей»;
- **НЕТ** `OfferAcquiringSettings` (bePaid/Stripe).

Вкладка **«Автопродление»** (`offer_{i}_renewal.png`):
- Карточка «Автопродление» + текст: «Банковская рассрочка не является подпиской. Условия, срок и график платежей определяет банк / „Ресурс Развития“. Настройки автопродления для этого типа кнопки не применяются».
- Больше на вкладке ничего нет.

Форма не сохранялась (Escape после проверки).

---

## 6. Runtime proof — публичная страница

`/tmp/browser/sprint-a/public.py` открыл `https://gorbova.by/cb` и слушал все network-запросы с фильтром `installment-initiate | rr-* | rr-webhook | rr-test`.

Результат:
```
rr/installment-initiate calls: []
```

Нет ни одного вызова `installment-initiate` или `rr-*` эндпоинтов. Публичный flow остаётся полностью legacy-external_link (что и требуется в Sprint A). Полная проверка «клик → редирект на pay.rrllc.ru» уже задокументирована в `.lovable/proofs/2026-07-09-rr-sprint-2.1-runtime-proof.md` — Sprint A не менял ни public flow, ни `bankInstallment.ts`, ни `LeadRequestDialog`, поэтому его поведение по определению неизменно.

---

## 7. DoD Sprint A — сверка

- [x] UI редактора оффера для `offer_type='bank_installment'` не показывает: radio способ оплаты bePaid/Stripe, внутреннюю рассрочку N платежей, `OfferAcquiringSettings`, virtual-card блокировку.
- [x] Вкладка «Автопродление» для `bank_installment` содержит явную подсказку (не подписка).
- [x] `OfferRowCompact` для `bank_installment` не показывает «до N мес × X BYN».
- [x] Оффер «Бухгалтер» нормализован SQL-UPDATE'ом (4 поля).
- [x] BEFORE/AFTER снапшот трёх тарифов приложен.
- [x] Playwright скриншоты админки (3 оффера × 2 вкладки) приложены; публичный run фиксирует 0 rr-* вызовов.
- [x] Публичный legacy external_link работает без вызовов `installment-initiate`/`rr-*` (0 запросов).
- [x] Никаких изменений в `orders_v2 / payments_v2 / provider_events / domain_events / entitlements / access_grant_ledger` (счётчики совпадают до/после).

---

## 8. Не сделано в Sprint A (по плану — отложено)

- `installment-initiate`, `rr-webhook`, prod-webhook — Sprint B/C
- `payments_v2` для РР, `grant-access-for-order` — Sprint C
- `rr_mode='runtime'` — все офферы остаются `payment_url` — Sprint E
- Очистка `installment_interval_days=30 / first_payment_delay_days=0` у офферов «Главный бухгалтер» и «Бизнес-леди» — по DoD Sprint A запрещено «заодно» править не согласованные записи. Заносится в discovery-примечания для Sprint E/F.
- Переименование `bank_installment` в БД — не требуется.
- Удаление `DEFAULT_BANK_INSTALLMENT_LINK` из `src/lib/bankInstallment.ts` — Sprint G.

---

## 9. Артефакты

- `/tmp/browser/sprint-a/admin.py` — Playwright админ-proof
- `/tmp/browser/sprint-a/public.py` — Playwright публичный proof (network filter)
- `/tmp/browser/sprint-a/screenshots/` — 10 скринов
- Этот отчёт: `.lovable/proofs/2026-07-09-rr-sprint-A-bank-installment-ui-normalize.md`

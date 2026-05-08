# Sprint 10 part 2 PATCH — UI каталога и кнопки оплаты

## PATCH UI-1 — Каталог плейсхолдеров: канонический Table
- `src/components/ai-documents/PlaceholdersCatalogTab.tsx` переписан с грид-карточек на системную `Table` из `@/components/ui/table` (та же, что используется в админке: участники клуба, payments, broadcasts).
- Колонки: Группа · Название · Плейсхолдер · Тип · Источник · Обяз. · Пример · Действия.
- Фильтры: поиск (label/token/description/category), Select по группе, Select по типу данных, Switch «только обязательные».
- Действия в строке: copy `{{token_key}}`.
- Технические данные (`field_id`, `resolver_key`, `source_type`, `category`) — раскрытие строки через chevron + глобальный toggle «Технические данные».
- 157 токенов из `document_token_registry` отображаются в плотной таблице.

## PATCH UI-2 — Окно кнопки оплаты: шире + Tabs
- `src/pages/admin/AdminProductDetailV2.tsx`:
  - `DialogContent` расширен до `max-w-4xl`.
  - Содержимое разделено на `Tabs` с 5 вкладками:
    1. **Основное** — тариф, тип кнопки, текст, сумма, цена повторного вступления.
    2. **Оплата** — Способ оплаты (full/bank), Настройка рассрочки.
    3. **Автопродление** — Подписка card (billing_period, grace, attempts, timezone, charge_times, reminders), Trial, Preregistration.
    4. **Документы** — `OfferDocumentDefaultsCard` (вынесен из Collapsible).
    5. **Дополнительно** — Расширенные настройки (virtual cards, getCourse, welcome msg, CRM routing) + Активна / Основная цена.
- Бизнес-логика сохранения не тронута: `handleSaveOffer` пишет всё тот же `offerForm` в `tariff_offers` (включая `meta.document_defaults`).

## PATCH UI-3 — Понятные подписи и группировка «Документов»
- `OfferDocumentDefaultsCard` пересобран по группам с заголовками:
  - **Шаблон и исполнитель**
  - **Услуга**
  - **Стоимость**
  - **Сроки**
  - **Расчёты**
  - **Комментарий**
- Все технические ярлыки заменены на человеческие («Срок оказания услуги, дней», «Цена для банковской рассрочки», «Окончательный расчёт» и т.д.).
- Хранение по-прежнему: `tariff_offers.meta.document_defaults` (тот же `OfferDocumentDefaults` тип из `useTariffOffers`).

## PATCH UI-4 — Канонический календарь
- `service_period_from` и `service_period_to` теперь используют системный `DatePicker` из `@/components/ui/date-picker` (тот же компонент, что в Tariff Dialog → Flow и в Preregistration).
- Формат отображения — `дд.мм.гггг` (русская локаль), хранение — `yyyy-MM-dd`.

## PATCH UI-5 — Шаблон акта и Исполнитель — Select из БД
- `template_id` → `<Select>` из `document_templates` (фильтр `is_active=true`, отображается `name (code)`).
- `executor_id` → `<Select>` из `executors` (фильтр `is_active=true`, дефолтный сверху, отображается `short_name|full_name`).
- UUID не вводится руками. Опциональный toggle «Показывать технические ID» открывает реальные id под селектами (для отладки).

## PATCH UI-6 — Что НЕ менялось
- Schema БД, миграции — не трогались.
- Email / Telegram / auto-send / production auto-generation — выключены, флаги остались `false`.
- Legacy `generated_documents`, `documents:annual_meeting` контекст — не трогались.
- `handleSaveOffer`, `useTariffOffers`, `OfferDocumentDefaults` тип — без изменений в логике, только UI-обёртка.

## Файлы
- changed: `src/components/ai-documents/PlaceholdersCatalogTab.tsx`
- changed: `src/components/admin/product/OfferDocumentDefaultsCard.tsx`
- changed: `src/pages/admin/AdminProductDetailV2.tsx`

---

## PATCH DOC-OFFER-1..6 — Автозаполнение суммы / валюты во вкладке «Документы»

### Что изменилось
- `OfferDocumentDefaults` (в `src/hooks/useTariffOffers.tsx`) расширен флагами `amount_manual_override`, `currency_manual_override`.
- `OfferDocumentDefaultsCard` принимает новые пропсы `offerAmount` (= `offer.amount`) и `offerCurrency` (по умолчанию BYN).
- `AdminProductDetailV2.tsx` пробрасывает `offerForm.amount` и `"BYN"` в карточку.

### Логика автозаполнения
1. **Первичный init вкладки**: если `unit_price` пусто → берём `offerAmount`; если `quantity` пусто → `1`; если `amount` пусто → `unit_price * quantity`; если `currency` пусто → `BYN` (или `offerCurrency`).
2. **Смена суммы кнопки** (`offerAmount` prop): если нет `amount_manual_override` → перезаписываем `unit_price` и пересчитываем `amount`.
3. **Смена количества** → пересчёт `amount = unit_price × quantity` (если нет ручного override).
4. **Смена `unit_price`** → пересчёт `amount` (если нет ручного override).
5. **Ручное изменение `amount`** → ставим `amount_manual_override = true`, показываем «(вручную)» и подсказку с расчётной суммой.
6. **Кнопка «Пересчитать из цены кнопки»** сбрасывает override и подставляет `unit_price = offerAmount`, `quantity = quantity ?? 1`, `amount = unit_price × quantity`.

### Валюта
- Поле «Валюта» — `Select` со списком `BYN | USD | EUR | RUB`. Новой таблицы валют не создавали.
- Default = `BYN` (= `offerCurrency`).
- При смене валюты кнопки → автообновление, если нет `currency_manual_override`.
- Ручной выбор отличный от валюты кнопки → `currency_manual_override = true`.

### Подсказки UX
- В шапке вкладки info-блок: «По умолчанию сумма акта берётся из суммы кнопки оплаты. Количество = 1. Если изменить количество или цену за единицу, сумма акта пересчитается автоматически.»
- Под полем «Сумма акта»: «Рассчитывается автоматически: цена × количество. Можно изменить вручную.»

### Сохранение в meta
- `handleSaveOffer` пишет всё `offerForm.meta` в `tariff_offers.meta` без затирания `recurring`, `installment`, `preregistration`, `welcome_message`, `crm_routing`, `document_defaults`. Override-флаги хранятся внутри `meta.document_defaults`.

### Копирование кнопки
- `handleCopyOffer` копирует `meta` целиком (включая `document_defaults` со всеми полями и override-флагами). Новая кнопка `is_active=false`, `is_primary=false`, без provider/getcourse id. Поведение не менялось — просто подтверждаем, что новые поля попадают в копию автоматически.

### Тест-чеклист (PATCH DOC-OFFER-7)
1. Кнопка с `amount=100`, открыть вкладку «Документы» → `unit_price=100`, `quantity=1`, `amount=100`, `currency=BYN`. ✅
2. Изменить `quantity=3` → `amount=300`. ✅
3. Изменить `unit_price=150` → `amount=450`. ✅
4. Нажать «Пересчитать из цены кнопки» → `unit_price=100`, `amount=100*quantity`, override снят. ✅
5. Сохранить → перезагрузить → `meta.document_defaults` сохранён. ✅
6. Скопировать → копия inactive, `meta.document_defaults` присутствует целиком. ✅

### Файлы
- changed: `src/hooks/useTariffOffers.tsx` (+ override flags в типе)
- changed: `src/components/admin/product/OfferDocumentDefaultsCard.tsx` (логика + Select валюты + кнопка пересчёта + подсказки)
- changed: `src/pages/admin/AdminProductDetailV2.tsx` (проброс `offerAmount`/`offerCurrency`)

### Что НЕ делалось
- Email / Telegram / auto-send / batch / production auto-generation — выключены, флаги `false`.
- Legacy `generated_documents` — не трогали.
- Новой таблицы валют, нового календаря, нового UI-паттерна таблицы не создавали.
- Snapshot `orders_v2.meta.document_data`, вкладка «Документы» в сделке и приоритет резолвера — следующий шаг Sprint 10.

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

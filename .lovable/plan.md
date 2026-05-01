## да, согласен, с учетом правок:

1. «Добавь редактирование месяца» — только через уже существующий `EditDealDialog`, без нового write-path.
2. В `DealDetailSheet` добавить кнопку **«Изменить месяц»**, которая открывает `EditDealDialog`.
3. В группировке по продуктам добавить сортировку:
  - группы: по названию продукта;
  - сделки внутри группы: сначала свежие, затем по `deal_month DESC`.
4. Активный месяц подсвечивать только если `meta.deal_month` совпадает с текущим месяцем.
5. В строке сделки показывать:
  - продукт/тариф;
  - статус;
  - месяц сделки;
  - сумму;
  - дату оплаты;
  - кнопки: просмотр, редактировать, возврат.

Можно выполнять.

&nbsp;

План: вкладка «Сделки» в стиле «Анкет»

### Цель

Переписать `<TabsContent value="deals">` в `src/components/admin/ContactDetailSheet.tsx` так, чтобы визуально и структурно она повторяла вкладку «Анкеты» (`ContactArtifactsTab.tsx` + `ProductGroupSection`): сделки группируются по продукту в раскрывающиеся карточки, внутри — компактные строки сделок. Добавить отображение «месяца сделки» (`meta.deal_month`) и в строке, и в просмотре сделки. Редактирование месяца уже реализовано в `EditDealDialog` — оставляем как единственный путь записи.

### Шаг 1. Новый компонент `ContactDealsTab.tsx`

Создать `src/components/admin/contact/ContactDealsTab.tsx`. Внутри:

- `groupDealsByProduct(deals)` — по тому же принципу, что `groupByProduct` в `ContactArtifactsTab`. Ключ — `product_id` (fallback — название из `getDealDisplayName`). Считать `paidCount` / `totalCount` для бейджа справа.
- `<ProductGroupSection>` — копия дизайна анкет: `Collapsible` + `border-l-4 border-l-indigo-300`, иконка `Layers` в `bg-indigo-50`, бейджи количества справа, `ChevronDown` с поворотом. Сворачивание отдельной группы запоминается в `Set<string>` (как в анкетах).
- `<DealRow>` — компактная строка сделки: иконка категории продукта, название тарифа (или продукта), мини-бейджи: статус (`getStatusColor` / `getStatusLabel`), **месяц** (`meta.deal_month`, формат `MMM yy` через `date-fns`/`ru` — например, «апр 26»), сумма, дата, `ChevronRight`. Иконки `Pencil` (открыть `EditDealDialog`) и `Undo2` (возврат) — справа, как сейчас. Сохранить badges «📦 Разделена на модули», «📄 Модуль (split)», «Модульная покупка», `ProductCategoryBadge`.
- Если в группе одна сделка — открывается по умолчанию (`isOpen=true`).

### Шаг 2. Бейдж месяца в строке

Маленький `Badge` приглушённого цвета (`bg-violet-50 text-violet-600 border-violet-200`) с иконкой `CalendarDays`. Текст: локализованное «апр 26» из `meta.deal_month` (`YYYY-MM`). Если `deal_month` не задан — бейдж не показываем (используется реальная дата сделки рядом). На hover — tooltip «Месяц контента, к которому относится сделка».

### Шаг 3. Просмотр сделки (DealDetailSheet)

В `src/components/admin/DealDetailSheet.tsx` в блоке шапки сделки добавить read-only строку «Месяц сделки» с тем же бейджем и подписью «определяет доступ к месячному контенту». Без редактирования — кнопка «Изменить» ведёт в `EditDealDialog` (он уже подключён через `dealToEditId`). Подсветить выбранный месяц визуально (бейдж тот же, но крупнее) и подпись «можно изменить через редактор сделки».

### Шаг 4. Подключение в ContactDetailSheet

Заменить блок строк ~3235–3372 на:

```
<TabsContent value="deals" className="m-0 space-y-3">
  <ContactDealsTab
    deals={deals}
    isLoading={dealsLoading}
    moduleMetaMap={moduleMetaMap}
    onOpenDeal={(id) => setSelectedDealId(id)}
    onEditDeal={(id) => setDealToEditId(id)}
    onRefund={(id) => setRefundDealId(id)}
  />
</TabsContent>
```

Все существующие диалоги (`DealDetailSheet`, `EditDealDialog`, `RefundDialog`) остаются без изменений — переиспользуются.

### Шаг 5. Редактирование месяца — без новых путей

- `EditDealDialog` уже умеет редактировать `meta.deal_month` через `MonthYearPicker` и пишет audit `deal.deal_month.updated`. Не дублируем.
- В новой строке/в `DealDetailSheet` — только просмотр + кнопка «Изменить», открывающая существующий `EditDealDialog`.

### Шаг 6. DoD

- Группы сделок раскрываются/сворачиваются, состояние локальное.
- Группа с одной сделкой раскрыта по умолчанию.
- Бейдж месяца виден в строке и в шапке `DealDetailSheet`, если `meta.deal_month` задан.
- Редактирование месяца работает через существующий `EditDealDialog` и пишет audit (поведение не меняется).
- Никакие RPC, edge functions, миграции не создаются.
- Никакие существующие компоненты (DealDetailSheet, EditDealDialog, RefundDialog, hooks) не дублируются.

### Технические детали

- Файлы:
  - **новый**: `src/components/admin/contact/ContactDealsTab.tsx` (≈ 250 строк, шаблон взят из `ContactArtifactsTab.tsx`).
  - **edit**: `src/components/admin/ContactDetailSheet.tsx` — заменить тело `TabsContent value="deals"`.
  - **edit**: `src/components/admin/DealDetailSheet.tsx` — добавить отображение `meta.deal_month` в шапке.
- Типы сделки берём из существующего `deals` (см. `useContactDeals` / запрос в `ContactDetailSheet`), без изменений схемы.
- Локализация месяца: `format(parse(deal_month + '-01', 'yyyy-MM-dd', new Date()), 'LLL yy', { locale: ru })`.
- Кнопки `Pencil`/`Undo2`/`Eye` сохраняем в строке (как в анкетах сохранён `ChevronRight`).

### Что не делаем

- Не трогаем логику `has_month_purchase_bulk`, `grant-access-for-order`, `meta.deal_month` записи (это уже SOT, исправлено materialization-миграцией).
- Не меняем дизайн вкладки «Анкеты» — только переиспользуем визуальный язык.
- Не добавляем массовую правку месяцев — только per-deal через `EditDealDialog`.
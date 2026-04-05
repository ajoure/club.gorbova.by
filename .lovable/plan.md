## да, согласен, с учетом правок:

&nbsp;

1. **Скролл reset нужно сделать явно**
  &nbsp;
  - Недостаточно надеяться на remount.
  - Для контейнера списка preview добавить ref и при:
    &nbsp;
    - handleClose
    - переходе setup -> preview
    - смене selection / snapshot
    - открытии диалога
      выполнять scrollTop = 0.
    &nbsp;
  - Это нужно прямо зафиксировать в плане, иначе DoD про reset останется недоказуемым.
  &nbsp;
2. **Лучше не просто заменить ScrollArea на div, а полностью удалить зависимость preview от Radix ScrollArea в этом месте**
  &nbsp;
  - То есть не смешивать два подхода.
  - Для preview использовать один нативный scroll-container:
    &nbsp;
    - flex-1 min-h-0 overflow-y-auto
    - при необходимости pr-1 / overscroll-contain
    &nbsp;
  - Header и footer оставить вне scroll-контейнера.
  &nbsp;
3. **Нужен единый renderer карточки preview**
  &nbsp;
  - Сейчас в плане написано “вынести в inline-функцию PreviewCard или оставить inline JSX”.
  - Оставлять inline не надо, иначе снова разъедется логика между apply/skipped/blocked.
  - Зафиксировать:
    &nbsp;
    - сделать один PreviewCard
    - три секции используют один и тот же renderer
    - все цвета, badge и reason text берутся из одного места.
    &nbsp;
  &nbsp;
4. **Нужен маппинг не только для текста, но и для визуального типа**
  &nbsp;
  - Добавить REASON_META вместо одного REASON_LABELS, чтобы хранить:
    &nbsp;
    - label
    - tone (success / warning / danger / muted)
    &nbsp;
  - Тогда не будет повторной ручной логики по цветам для админ, пропустить, заблокировано.
  &nbsp;
5. **Текст для admin override лучше сделать мягче и точнее**
  &nbsp;
  - Текущий вариант:
    &nbsp;
    - «Админ-продление: прежний срок истёк, доступ будет выдан заново»
    &nbsp;
  - Лучше:
    &nbsp;
    - «Админ-продление: предыдущий срок истёк, доступ будет продлён вне обычных ограничений»
    &nbsp;
  - Потому что фактически в некоторых кейсах это не “заново”, а продление/переоткрытие через существующий flow.
  &nbsp;
6. **Для нет_user_id добавить точную подсказку действия**
  &nbsp;
  - Не просто “сначала свяжите сделку с контактом”.
  - Лучше:
    &nbsp;
    - «Нет привязки к пользователю. Сначала свяжите сделку с пользователем или восстановите user_id»
    &nbsp;
  - Иначе смешиваются контакт и пользователь, а это не одно и то же.
  &nbsp;
7. **Добавить пустые состояния секций**
  &nbsp;
  - Если один из блоков пуст, его не рендерить.
  - Но если все три пусты из-за сбоя preview, показывать отдельный fallback:
    &nbsp;
    - «Нет данных для предварительного просмотра».
    &nbsp;
  - Это защитит от визуально пустой модалки.
  &nbsp;
8. **Нужен PATCH по вертикальному скроллу как отдельный незакрытый баг**
  &nbsp;
  - Добавить в план явный пункт:
    &nbsp;
    - PATCH-BULK-EXTEND-PREVIEW-SCROLL-BUG
    &nbsp;
  - И не считать его закрытым до browser-proof:
    &nbsp;
    - список 20+ строк реально прокручивается;
    - колесо мыши работает;
    - трекпад работает;
    - scrollbar draggable;
    - footer всегда виден.
    &nbsp;
  &nbsp;
9. **DoD дополнить**
  &nbsp;
  - Добавить:
    &nbsp;
    - при 30+ строках preview список прокручивается до последней строки;
    - после Отмена и повторного открытия scroll сверху;
    - после выбора другого набора сделок preview не показывает старые строки;
    - reasonCode badge остаётся вторичным, основной текст всегда человекочитаемый;
    - секции рендерятся в порядке: К продлению → Пропущено → Заблокировано.
    &nbsp;
  &nbsp;
10. **Ничего не менять в predicate и execute-flow**

&nbsp;

&nbsp;

&nbsp;

- Это правильно у тебя уже зафиксировано.
- Оставить add-only: только UX preview и scroll, без вмешательства в checkExtendEligibility и grant-access-for-order.

&nbsp;

&nbsp;

План: PATCH-BULK-EXTEND-PREVIEW-UX-CLEANUP

### Диагностика скролла

Проблема: `ScrollArea` на строке 390 имеет `className="flex-1 min-h-0"`, но Radix ScrollArea требует **явного ограничения высоты** на `Root` элементе. Без `max-h-*` или фиксированной высоты Radix Viewport растягивается на весь контент и скролл не появляется. `flex-1 min-h-0` работает только если родитель — flex-контейнер с ограниченной высотой, что в данном случае обеспечено `DialogContent` с `max-h-[85vh] flex flex-col overflow-hidden` (строка 292) — но Radix `Viewport` внутри `ScrollArea` не получает `overflow: auto` без явной высоты на Root.

**Решение:** Заменить `ScrollArea` на нативный `div` с `overflow-y-auto flex-1 min-h-0` — это надёжнее и не зависит от Radix internals. Либо добавить явную `max-h` на ScrollArea.

---

### Файл: `src/components/admin/BulkExtendAccessDialog.tsx`

#### 1. Скролл (строки 389-444)

Заменить `<ScrollArea className="flex-1 min-h-0">` на:

```tsx
<div className="flex-1 min-h-0 overflow-y-auto pr-2">
```

Это гарантирует работу скролла колесом/трекпадом, т.к. `overflow-y-auto` на обычном div работает безусловно при `flex-1 min-h-0` внутри flex-col родителя с `max-h-[85vh]`.

#### 2. Человекочитаемые тексты

Добавить маппинг reasonCode → человеческий текст (вне компонента, ~строка 36):

```ts
const REASON_LABELS: Record<string, string> = {
  "не_оплачено": "Сделка не оплачена — продление не выполняется",
  "нет_user_id": "Нет привязки к пользователю. Сначала свяжите сделку с контактом",
  "нет_product_id": "У сделки не указан продукт",
  "продукт_деактивирован": "Продукт деактивирован — доступ не выдаётся",
  "тариф_деактивирован": "Тариф деактивирован",
  "нет_правила_доступа_в_системе": "Нет активного правила доступа для этого продукта",
  "subscription_expired": "Срок подписки истёк",
  "subscription_canceled": "Подписка отменена",
  "admin_override_historical_allowed": "Админ-продление: прежний срок истёк, доступ будет выдан заново",
  "order_subscription_product_mismatch": "Продукт сделки не совпадает с продуктом подписки",
  "историческая_покупка_без_текущего_основания": "Историческая покупка без текущего активного доступа",
  "неполные_данные_для_проверки": "Неполные данные подписки для проверки",
  "новый_срок_короче_текущего": "Новый срок короче текущего — сокращение заблокировано",
};
```

В карточке строки (строка 439) заменить `{row.reason}` на:

```tsx
{REASON_LABELS[row.reasonCode || ""] || row.reason}
```

`reasonCode` остаётся как маленький mono badge (строки 411-414) — без изменений.

#### 3. Группировка preview по секциям (строки 391-443)

Вместо одного плоского списка `previewRows.map(...)` — три секции:

```tsx
{applicable.length > 0 && (
  <div>
    <h4 className="text-sm font-medium text-green-700 mb-2 flex items-center gap-1">
      <CheckCircle className="w-4 h-4" /> К продлению ({applicable.length})
    </h4>
    {applicable.map(row => <PreviewCard key={row.orderId} row={row} />)}
  </div>
)}
{skipped.length > 0 && (
  <div>
    <h4 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-1">
      <AlertTriangle className="w-4 h-4" /> Пропущено ({skipped.length})
    </h4>
    {skipped.map(row => <PreviewCard key={row.orderId} row={row} />)}
  </div>
)}
{blocked.length > 0 && (
  <div>
    <h4 className="text-sm font-medium text-destructive mb-2 flex items-center gap-1">
      <XCircle className="w-4 h-4" /> Заблокировано ({blocked.length})
    </h4>
    {blocked.map(row => <PreviewCard key={row.orderId} row={row} />)}
  </div>
)}
```

Карточку вынести в inline-функцию `PreviewCard` или оставить inline JSX — тот же блок что сейчас (строки 394-441), но с использованием `REASON_LABELS`.

#### 4. Что НЕ меняется

- `useAccessValidation.ts` — без изменений
- `checkExtendEligibility` — без изменений
- `grant-access-for-order` — без изменений
- Логика preview snapshot, resetState, admin override — без изменений

### DoD


| Пункт          | Критерий                                                     |
| -------------- | ------------------------------------------------------------ |
| Скролл         | 20+ строк реально скроллятся мышью/трекпадом, footer виден   |
| Scroll reset   | После reopen scroll position = top                           |
| Тексты         | Нет системных формулировок как основной текст                |
| pending        | Читается как «Сделка не оплачена — продление не выполняется» |
| нет_user_id    | Читается как «Нет привязки к пользователю»                   |
| admin_override | Читается как «Админ-продление: прежний срок истёк»           |
| Группировка    | 3 визуальных блока: К продлению / Пропущено / Заблокировано  |
| reasonCode     | Остаётся только как маленький mono badge                     |

# да, согласен, с учетом правок:

&nbsp;

1. **openCreateTrainingContentRule должен принимать не только targetRef, но и targetTitle.**
  Нельзя открывать create-dialog с пустым target_label.
  Должно быть:

&nbsp;

```
openCreateTrainingContentRule(trainingId: string, trainingTitle: string)
```

&nbsp;

1. и сразу заполнять:
  &nbsp;
  - grant_target_type: "training_content"
  - target_ref: trainingId
  - target_label: trainingTitle
  - tariff_id: ""
  &nbsp;
2. **Не дублировать логику через initialAction и отдельный ручной setForm.**
  Нужен один канонический helper открытия training_content create-dialog, который используется:
  &nbsp;
  - и для initialAction,
  - и для onUseViaRule.
    Иначе потом снова разъедутся default values и валидация.
  &nbsp;
3. **tariff_id: "" — правильно, но это нужно довести до UX конца.**
  В плане добавь явно:
  &nbsp;
  - сохранить правило без тарифа нельзя;
  - если пользователь открыл flow “Использовать через правило”, но тариф не выбрал, должна быть явная ошибка валидации у поля тарифа;
  - никакой автоподстановки первого тарифа.
  &nbsp;
4. **setTimeout(() => onOpenChange(false), 0) не использовать.**
  Это хрупкий костыль.
  Нужно сделать предсказуемо:
  &nbsp;
  - сначала вызвать родительский callback открытия rule-dialog,
  - затем сразу закрыть bind modal обычным синхронным вызовом,
  - без таймаутов.
    Если это не работает, значит надо чинить структуру состояния, а не маскировать таймером.
  &nbsp;
5. **Карточка isOtherProduct должна быть полностью некликабельной как контейнер.**
  Это нужно закрепить явно в DoD и в плане реализации:
  &nbsp;
  - убрать onClick с контейнера,
  - оставить только 2 кнопки действий,
  - курсор/hover для всей карточки не должен создавать впечатление, что клик возможен в любом месте.
  &nbsp;
6. **Для already-bound training показать владельца и последствия прямо рядом с кнопками.**
  Сейчас в плане есть helper text, но нужно уточнить:
  &nbsp;
  - Владелец: <полное название продукта>
  - ниже маленький текст:
    &nbsp;
    - «Через правило — владелец не меняется»
    - «Перепривязать — сменит владельца и может затронуть старые правила/доступы»
    &nbsp;
  &nbsp;
7. **RebindPreviewDialog должен показывать полные названия обоих продуктов и тренинга.**
  Не только current/new product, но и сам training title в явном виде, без критичного clipping.
  Добавь:
  &nbsp;
  - training title: line-clamp-2/3 + title
  - current owner product: line-clamp-2 + title
  - new owner product: line-clamp-2 + title
  &nbsp;
8. **Impact preview нужно сделать не просто “блоками”, а с явной числовой сводкой.**
  Обязательно показать отдельными строками:
  &nbsp;
  - дочерних модулей затронуто: N
  - уроков затронуто: N
  - training_content rules деактивируется: N
  - product_access rules деактивируется: N
  - активные entitlements на старом продукте: да/нет
    И только после этого — warning/destructive блоки.
  &nbsp;
9. **В плане сейчас не зафиксировано, что use via rule не должен открывать move-preview modal.**
  Это нужно явно добавить в DoD:
  &nbsp;
  - при Использовать через правило открывается только create rule dialog,
  - RebindPreviewDialog не появляется,
  - training_modules.product_id и дочерние product_id не меняются.
  &nbsp;
10. **Proof C нужно расширить до фактического proof flow, а не только скрина кнопок.**
  Недостаточно показать, что две кнопки видны.
  Нужно доказать:
  &nbsp;
  - нажали «Использовать через правило»
  - открылся create-dialog
  - grant_target_type = training_content
  - target_ref предзаполнен нужным training id
  - target_label предзаполнен
  - tariff_id пустой
  &nbsp;
11. **Proof D должен включать кейс с длинными названиями, как на твоём скрине.**
  Иначе modal readability формально не доказана.
  Нужен именно длинный training/product pair, где сейчас всё режется.
12. **В DoD добавить явный пункт про отсутствие изменения owner в БД при use via rule.**
  Проверяемо:
  &nbsp;
  - до и после training_modules.product_id одинаковый,
  - количество связанных дочерних модулей не меняется,
  - никаких deactivate/rebind side effects не происходит.
  &nbsp;
13. **Scope boundary уточнить:**
  этот патч закрывает только:
  &nbsp;
  - dual-action bind flow,
  - rebind modal readability,
  - proof C/D.
    Не смешивать его с:
  - TreePicker save/reopen proof,
  - real conflict controlled proof,
  - runtime UI proof safe cohort,
  - standalone-only follow-up.
  &nbsp;
14. **Итоговый формат отчёта попросить отдельно по двум блокам:**
  &nbsp;
  - Flow proof: Use via rule
  - Flow proof: Rebind owner
    Чтобы было видно, что оба сценария реально разведены и не пересекаются.
  &nbsp;

&nbsp;

&nbsp;

План: PHASE C2 — Multi-product training usage + Rebind modal readability

## Текущая ситуация

- `ProductLinkedTrainingsBlock` рендерится **внутри** `ProductAccessRulesTab` (строка 686)
- Для already-bound тренингов сейчас: клик на карточку → `handleClick` → `onRebindRequest` (строка 278). Рядом muted hint "в разработке"
- `ProductAccessRulesTab` владеет `dialogOpen`, `form`, `setForm` — диалог создания правила
- Уже есть `initialAction` path для `create_training_content` через `location.state`, но он идёт снаружи (из страницы)
- `tariffs[0]?.id || ""` подставляется молча при `initialAction` (строка 302) — это опасное место

## Что делаем

### 1. Callback `onUseViaRule` из ProductAccessRulesTab → ProductLinkedTrainingsBlock

**Файл:** `src/components/admin/product/ProductAccessRulesTab.tsx`

Добавить функцию `openCreateTrainingContentRule(targetRef: string)`:

```typescript
const openCreateTrainingContentRule = (targetRef: string) => {
  setEditing(null);
  setForm({
    scope: "product",
    tariff_id: "",          // <-- пустой, пользователь выберет сам
    grant_target_type: "training_content",
    target_ref: targetRef,
    target_label: "",
    is_active: true,
    priority: "",
    duration_mode: "tariff",
    duration_days: "",
    rule_purpose: "primary",
    notes: "",
    target_product_ids: [],
    has_condition: false,
    condition_use_same_list: true,
    condition_required_product_ids: [],
    tc_access_mode: "full",
    tc_allowed_module_ids: [],
    tc_allowed_lesson_ids: [],
  });
  setAdvancedOpen(false);
  setDialogOpen(true);
};
```

Передать в `ProductLinkedTrainingsBlock`:

```tsx
<ProductLinkedTrainingsBlock 
  productId={productId} 
  onUseViaRule={openCreateTrainingContentRule} 
/>
```

Также исправить `initialAction` handler (строка 302): `tariff_id: ""` вместо `tariffs[0]?.id || ""`.

### 2. Dual-action UI в BindTrainingDialog

**Файл:** `src/components/admin/product/ProductLinkedTrainingsBlock.tsx`

Для `isOtherProduct` карточек (строки 380-392):

- Убрать onClick с текстового блока карточки (строка 358) для isOtherProduct
- Убрать muted hint "в разработке"
- Две явные кнопки вместо текущего badge:

```tsx
{isOtherProduct && (
  <div className="flex flex-col gap-1 items-end">
    <Button
      size="sm"
      variant="outline"
      className="h-6 text-[10px] gap-1"
      onClick={(e) => {
        e.stopPropagation();
        onUseViaRule(m.id);
        // НЕ закрываем bind dialog до успешного запуска rule-flow
      }}
    >
      <BookOpen className="h-2.5 w-2.5" />
      Использовать через правило
    </Button>
    <Button
      size="sm"
      variant="ghost"
      className="h-6 text-[10px] gap-1 text-destructive hover:text-destructive"
      onClick={(e) => {
        e.stopPropagation();
        onRebindRequest(m.id, m.title);
        onOpenChange(false);
      }}
    >
      <ArrowRight className="h-2.5 w-2.5" />
      Перепривязать владельца
    </Button>
    <span className="text-[9px] text-muted-foreground max-w-[200px] text-right">
      «Через правило» — владелец не меняется.
      «Перепривязать» — сменит product_id.
    </span>
  </div>
)}
```

Порядок закрытия: `onUseViaRule` вызывается первым, затем `onOpenChange(false)` через callback в родителе, после того как диалог правила уже открыт.

### 3. Props update для ProductLinkedTrainingsBlock

**Файл:** `src/components/admin/product/ProductLinkedTrainingsBlock.tsx`

```typescript
interface Props {
  productId: string;
  onUseViaRule?: (trainingId: string) => void;
}
```

Прокинуть `onUseViaRule` в `BindTrainingDialog`.

### 4. RebindPreviewDialog — readability fix

**Файл:** `src/components/admin/product/ProductLinkedTrainingsBlock.tsx`

Изменения в `RebindPreviewDialog` (строки 111-182):

- `sm:max-w-md` → `sm:max-w-lg`
- `max-h-[85vh] overflow-y-auto` на DialogContent
- Названия продуктов: `truncate` → `line-clamp-2 break-words` + `title` атрибут
- Кнопка "Перепривязать": `variant="destructive"` вместо default
- Impact preview разделить на 3 зоны:
  - **Нейтральные факты**: дочерних модулей, уроков
  - **Предупреждения** (amber bg): правила деактивируются, старые настройки
  - **Критический риск** (destructive bg): активные entitlements — отдельный блок с иконкой AlertTriangle
- Все текстовые строки: `whitespace-normal break-words`
- Длинные предупреждения: полная видимость без hover

### 5. Атомарность закрытия bind → открытия rule dialog

В `ProductAccessRulesTab`, callback `openCreateTrainingContentRule` сначала вызывает `setDialogOpen(true)`, затем вызывает закрытие bind dialog. Реализация:

```typescript
const openCreateTrainingContentRule = useCallback((targetRef: string) => {
  setEditing(null);
  setForm(prev => ({...defaultForm, grant_target_type: "training_content", target_ref: targetRef, tariff_id: ""}));
  setAdvancedOpen(false);
  setDialogOpen(true);
}, []);
```

В `ProductLinkedTrainingsBlock` при вызове `onUseViaRule`:

```typescript
onUseViaRule(m.id);
// Закрытие bind dialog ПОСЛЕ запуска rule-flow
setTimeout(() => onOpenChange(false), 0);
```

## Файлы для изменения


| Файл                                                           | Изменение                                                                                                                  |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `src/components/admin/product/ProductAccessRulesTab.tsx`       | `openCreateTrainingContentRule` callback, fix `tariff_id: ""` в initialAction, передача prop в ProductLinkedTrainingsBlock |
| `src/components/admin/product/ProductLinkedTrainingsBlock.tsx` | Props + dual-action UI в BindDialog + RebindPreviewDialog readability + impact preview zones                               |


## DoD

1. Карточка already-bound тренинга НЕ кликабельна целиком — только 2 явные кнопки
2. «Использовать через правило» открывает create-dialog с `grant_target_type=training_content`, `target_ref` предзаполнен, `tariff_id` пустой
3. `training_modules.product_id` не меняется при use via rule
4. Move-confirmation modal не открывается при use via rule
5. «Перепривязать владельца» — кнопка destructive, открывает RebindPreviewDialog
6. RebindPreviewDialog: текст не обрезается, impact по зонам severity, названия с line-clamp-2
7. Один канонический path открытия create-dialog (без дублирования логики)

## Scope boundary (не входит в этот патч)

- Standalone-only — HOLD
- TreePicker save/reopen proof — отдельный interactive proof
- Real conflict tooltip proof — отдельный controlled test + cleanup
- Runtime UI proof для 2 safe users — отдельный proof step
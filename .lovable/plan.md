# да, согласен, с учетом правок:

&nbsp;

1. В useAvailableTrainingsForBind лучше сразу делать alias в select, а не сырое products_v2(name), чтобы не плодить неоднозначный shape:

&nbsp;

```
.select("id, title, slug, public_id, is_active, product_id, parent_module_id, sort_order, owner_product:products_v2(name)")
```

И дальше нормализовать в плоское поле:

```
owner_product_name: m.owner_product?.name || null
```

Так будет стабильнее для типов и UI.

&nbsp;

2. В ProductAccessRulesTab.tsx для hasRealConflict / isParallelRule нужно приводить к boolean:

&nbsp;

```
const hasRealConflict = !!conflictEntry && conflictEntry.type !== "valid_parallel_rule";
const isParallelRule = !!conflictEntry && conflictEntry.type === "valid_parallel_rule";
```

Чтобы не тащить union object | false в условные className и JSX.

&nbsp;

3. Tooltip для реальных конфликтов должен показывать не только tariff names, но и priority, иначе рекомендация “уточнить приоритет” выглядит голословно.
  Минимум внутри tooltip:

&nbsp;

&nbsp;

&nbsp;

- тип конфликта,
- список тарифов,
- priorities участников,
- рекомендация.

&nbsp;

&nbsp;

&nbsp;

4. Warning-block сверху уточнить текстом:

&nbsp;

&nbsp;

&nbsp;

- для real conflicts: Требует действия администратора
- для parallel rules: Это допустимая конфигурация, если правила разведены по тарифам
  Чтобы пользователь без tooltip сразу понимал разницу.

&nbsp;

&nbsp;

&nbsp;

5. В bind modal строку владельца делать с title тоже на полном тексте:

&nbsp;

```
<span title={ownerName || "не привязан"} className="line-clamp-1 ...">
  Владелец: {ownerName || "не привязан"}
</span>
```

&nbsp;

6. Для названия тренинга оставить line-clamp-3, но карточке добавить вертикальное выравнивание так, чтобы правый блок не “ломал” высоту текста:

&nbsp;

&nbsp;

&nbsp;

- левый блок: min-w-0 flex-1
- правый блок: shrink-0 self-start ml-3
  Иначе на длинных названиях снова будет визуальная каша.

&nbsp;

&nbsp;

&nbsp;

7. Helper text Использование через правило доступа — в разработке показывать только для isOtherProduct, и отдельной muted строкой под action area, а не рядом с кнопкой в одну линию. Иначе на узком модальном окне текст опять начнёт ломать layout.
8. DoD дополни ещё одним пунктом:

&nbsp;

&nbsp;

&nbsp;

- tooltip для real conflicts не показывается у valid_parallel_rule, даже если rule участвует в общем conflicts массиве.

&nbsp;

&nbsp;

&nbsp;

9. В scope явно зафиксируй, что в этом патче:

&nbsp;

&nbsp;

&nbsp;

- не меняется classifier,
- не добавляется функциональная кнопка “использовать через правило доступа”,
- не меняется логика bind/rebind,
  а только UI/читаемость/объяснение конфликтов.

&nbsp;

&nbsp;

&nbsp;

10. После выполнения нужен proof на двух скриншотах:

&nbsp;

&nbsp;

&nbsp;

- один экран с valid_parallel_rule, где нет amber badge на карточках и есть только верхний info-block;
- один экран bind modal с длинным названием тренинга и видимой строкой Владелец: ... без деструктивного обрезания.

&nbsp;

&nbsp;

План: Phase B — Conflict UI cleanup + Phase C — Bind modal readability

## Phase B — Conflict UI cleanup

### Файл: `src/components/admin/product/ProductAccessRulesTab.tsx`

**1. Заменить `hasConflict` на `hasRealConflict` / `isParallelRule` (строки 798, 816, 850-855)**

Строка 798 сейчас:

```typescript
const hasConflict = conflicts.some((c) => c.items.some((i) => i.id === rule.id));
```

Заменить на:

```typescript
const conflictEntry = conflicts.find((c) => c.items.some((i) => i.id === rule.id));
const hasRealConflict = conflictEntry && conflictEntry.type !== 'valid_parallel_rule';
const isParallelRule = conflictEntry && conflictEntry.type === 'valid_parallel_rule';
```

**2. Убрать amber border для valid_parallel_rule (строка 816)**

Сейчас: `hasConflict && "border-amber-300/50"` → заменить на `hasRealConflict && "border-amber-300/50"`.

**3. Убрать бейдж «Конфликт» для valid_parallel_rule, добавить tooltip для real conflicts (строки 850-855)**

Для `hasRealConflict` — обернуть бейдж в `<Tooltip>` с подробным описанием:

- тип конфликта (`duplicate_rule` / `ambiguous_overlap`)
- какие правила участвуют (tariff names)
- что рекомендуется (удалить дубликат / уточнить приоритет)

Для `isParallelRule` — ничего не рендерить (карточка выглядит как обычная).

**4. Верхние блоки (строки 731-771) — уже корректно разделены**

Warning-block (amber) показывается только для real conflicts. Info-block (blue) — для parallel rules. Текст warning уточнить: добавить «Требует действия администратора».

**5. shadowed_rule**

Текущий classifier не генерирует `shadowed_rule` — он не выходит из `conflicts` useMemo. Tooltip делается только для `duplicate_rule` и `ambiguous_overlap`. `shadowed_rule` остаётся follow-up.

---

## Phase C — Bind modal readability

### Файл: `src/components/admin/product/ProductLinkedTrainingsBlock.tsx` (строки 338-410)

**1. Layout карточки в bind dialog**

Текущая структура: `flex items-start gap-2` с `line-clamp-2` на title и badges справа.

Изменить:

- Текстовый блок: `min-w-0 flex-1` (уже есть, но добавить `line-clamp-3` вместо `line-clamp-2`)
- Добавить `title={m.title}` на span для hover tooltip
- Под названием тренинга — вторая строка: `Владелец: {ownerProductName || "не привязан"}` — muted text
- Правый блок badges/кнопок: `shrink-0 ml-2` (уже есть)

**2. Fetch owner product name**

### Файл: `src/hooks/useProductTrainings.ts` (строки 646-666)

В `useAvailableTrainingsForBind` изменить select:

```typescript
.select("id, title, slug, public_id, is_active, product_id, parent_module_id, sort_order, products_v2(name)")
```

В output нормализовать:

```typescript
const normalize = (m) => ({
  ...m,
  owner_product_name: m.products_v2?.name || null,
});
```

Возвращать `free`, `currentProduct`, `otherProduct`, `all` с нормализованными записями.

**3. Owner label в bind dialog**

Под title тренинга добавить:

```tsx
<span className="text-[11px] text-muted-foreground block" title={ownerName || "не привязан"}>
  Владелец: {ownerName || "не привязан"}
</span>
```

**4. Hint про access rule — muted helper text**

Для `isOtherProduct` после бейджа «Перепривязать» добавить:

```tsx
<span className="text-[10px] text-muted-foreground italic">
  Использование через правило доступа — в разработке
</span>
```

Без кнопочного вида, без cursor-pointer.

---

## DoD (дополнения)

Итого 4 новых критерия:

1. `valid_parallel_rule` карточка визуально неотличима от обычной (нет amber border, нет amber badge, нет warning icon)
2. Real conflict (`duplicate_rule` / `ambiguous_overlap`) имеет tooltip с причиной и рекомендацией
3. В bind dialog owner product читается целиком или доступен через hover `title`
4. В bind dialog title тренинга не обрезается деструктивно (line-clamp-3 + title attr)

## Файлы для изменения


| Файл                                                           | Изменение                                                                                                  |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `src/components/admin/product/ProductAccessRulesTab.tsx`       | hasConflict → hasRealConflict/isParallelRule; tooltip для real conflicts; убрать amber styles для parallel |
| `src/components/admin/product/ProductLinkedTrainingsBlock.tsx` | line-clamp-3, title attrs, owner product label, muted hint                                                 |
| `src/hooks/useProductTrainings.ts`                             | join products_v2(name), normalize owner_product_name                                                       |

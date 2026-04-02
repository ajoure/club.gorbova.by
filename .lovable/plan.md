# да, согласен, с учетом правок:

&nbsp;

1. **Нужно явно разделить два бейджа:**
  &nbsp;
  - scope = где действует правило: весь продукт / тариф
  - training access mode = что внутри тренинга: весь тренинг / частичный
    Сейчас это визуально смешивается, из-за этого пользователь логично воспринимает Весь продукт как full-access. Это надо развести не только текстом, но и порядком бейджей.
  &nbsp;
2. **В карточке правила training_content бейдж partial/full ставь раньше scope-бейджа.**
  Порядок:
  &nbsp;
  - Доступ к контенту тренинга
  - Частичный: N мод. N ур. или Весь тренинг
  - Весь продукт / Тариф: ...
    Так пользователь сначала видит тип доступа, потом уровень применения.
  &nbsp;
3. **В summary Что получит покупатель нужен тот же порядок и те же формулировки.**
  Нельзя, чтобы в карточке правила был один смысл, а в summary другой. Формат должен быть 1:1 одинаковым.
4. **Для partial badge добавь защиту от нулевых значений.**
  Если access_mode='partial', но counts почему-то 0/0, не показывать просто Частичный: 0 мод. 0 ур. как норму.
  Показывать:
  &nbsp;
  - Частичный доступ
  - и рядом muted warning выбор пуст
    Это сразу подсветит кривые кейсы.
  &nbsp;
5. **В useAccessRules.ts counts нужно брать безопасно и типизированно.**
  Не только Array.isArray, но и единообразно через helper, чтобы потом не дублировать логику в двух местах:

&nbsp;

```
getTrainingContentMeta(conditions) => { mode, moduleCount, lessonCount }
```

&nbsp;

5. И этот helper использовать:
  &nbsp;
  - при построении EffectiveGrant
  - при рендере карточки rules list, если нужно
  &nbsp;
6. **Если grant_target_type !== 'training_content', никаких partial/full бейджей не показывать.**
  Это важно, чтобы не размазать логику на product_access и self-rules.
7. **Нужен proof после патча на одном реальном partial-правиле:**
  &nbsp;
  - raw conditions из БД
  - карточка правила
  - summary Что получит покупатель
  - reopen edit-dialog
    Чтобы было видно, что одно и то же правило везде отображается согласованно.
  &nbsp;
8. **Это действительно PATCH на display only.**
  В плане отдельно зафиксировать:
  &nbsp;
  - save-path не меняем
  - hydration не меняем
  - backend/migration не трогаем
    Только extraction + rendering.
  &nbsp;
9. **DoD дополни ещё одним пунктом:**
  &nbsp;
  - пользователь больше не может перепутать Весь продукт как scope с Весь тренинг как mode доступа внутри training_content rule.
  &nbsp;

&nbsp;

&nbsp;

План: PATCH — отображение partial/full mode в правилах training_content

## Диагноз

**Save-path работает корректно.** Проверка БД подтверждает: `access_mode: "partial"`, `allowed_module_ids` и `allowed_lesson_ids` сохраняются правильно. Нормализация через `normalizeTrainingContentPayload` работает.

**Дефект — в отображении, а не в сохранении.** Три места не показывают access_mode:

1. **Карточка правила в списке** (строки 894-896) — показывает `target_label` + badge "Доступ к контенту тренинга" + "Весь продукт" (scope badge = tariff vs product). Нет badge partial/full. Визуально partial выглядит как full.
2. **EffectiveGrantCard** (summary "Что получит покупатель") — `EffectiveGrant` interface не содержит `conditions`. При построении грантов (useAccessRules.ts строки 338-414) `conditions` не извлекается → access_mode теряется.
3. **Reopen/edit hydration** — работает корректно (строки 536-570). `tc_access_mode`, `tc_allowed_module_ids`, `tc_allowed_lesson_ids` восстанавливаются из `conditions`.

**Вывод:** PATCH A (save-path) уже исправен. Нужны PATCH C (summary/display) и дополнение к карточке правила.

## Что делаем

### PATCH C1 — Badge access_mode в карточке правила

**Файл: `src/components/admin/product/ProductAccessRulesTab.tsx**`

В блоке рендера карточки правила (после строки 896, рядом с badge `TARGET_TYPE_LABELS`), добавить для `training_content`:

```tsx
{rule.grant_target_type === "training_content" && (() => {
  const cond = (rule.conditions || {}) as Record<string, unknown>;
  const mode = cond.access_mode as string || "full";
  const mCount = Array.isArray(cond.allowed_module_ids) ? cond.allowed_module_ids.length : 0;
  const lCount = Array.isArray(cond.allowed_lesson_ids) ? cond.allowed_lesson_ids.length : 0;
  return (
    <Badge variant="outline" className={cn("text-[10px]", mode === "partial" ? "text-amber-600 border-amber-300" : "")}>
      {mode === "full" ? "Весь тренинг" : `Частичный: ${mCount} мод. ${lCount} ур.`}
    </Badge>
  );
})()}
```

### PATCH C2 — access_mode в EffectiveGrant (summary)

**Файл: `src/hooks/useAccessRules.ts**`

1. Добавить в `EffectiveGrant` interface:

```typescript
tc_access_mode?: "full" | "partial";
tc_module_count?: number;
tc_lesson_count?: number;
```

2. В обоих местах построения грантов (tariff-level строка 341 и product-level строка 396), для `training_content` извлекать из `r.conditions`:

```typescript
tc_access_mode: r.conditions?.access_mode || "full",
tc_module_count: Array.isArray(r.conditions?.allowed_module_ids) ? r.conditions.allowed_module_ids.length : 0,
tc_lesson_count: Array.isArray(r.conditions?.allowed_lesson_ids) ? r.conditions.allowed_lesson_ids.length : 0,
```

### PATCH C3 — EffectiveGrantCard показывает mode

**Файл: `src/components/admin/product/ProductAccessRulesTab.tsx**`

В `EffectiveGrantCard` (строка 1698-1710), добавить badge после `source_label`:

```tsx
{g.grant_target_type === "training_content" && g.tc_access_mode && (
  <Badge variant="outline" className={cn("text-[10px]", g.tc_access_mode === "partial" ? "text-amber-600 border-amber-300" : "")}>
    {g.tc_access_mode === "full" ? "Весь тренинг" : `Частичный: ${g.tc_module_count} мод. ${g.tc_lesson_count} ур.`}
  </Badge>
)}
```

## Файлы для изменения


| Файл                                                     | Что                                                       |
| -------------------------------------------------------- | --------------------------------------------------------- |
| `src/components/admin/product/ProductAccessRulesTab.tsx` | Badge access_mode в карточке правила + EffectiveGrantCard |
| `src/hooks/useAccessRules.ts`                            | `EffectiveGrant` interface + extraction из conditions     |


## DoD

1. Карточка правила training_content показывает "Весь тренинг" или "Частичный: N мод. N ур."
2. Summary "Что получит покупатель" показывает access_mode badge
3. Partial не маскируется под full визуально
4. Save-path не меняется (уже корректен)
5. Reopen/edit hydration не меняется (уже корректен)
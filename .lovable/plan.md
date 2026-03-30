# да, согласен, с учетом правок:

&nbsp;

1. Добавь в scope явную формулировку:
  &nbsp;
  - **этот патч закрывает только UI-баг numeric inputs и баг отображения срока**;
  - **runtime-проверка реальной выдачи доступа не входит в этот патч** и идёт отдельным follow-up proof/verification patch.
  - Иначе будет повторное смешение UI-фикса и runtime-валидации.
  &nbsp;
2. Для numeric fix зафиксируй единое правило:
  &nbsp;
  - priority и duration_days в UI хранятся как string;
  - парсинг в число только:
    &nbsp;
    - на blur,
    - на save;
    &nbsp;
  - пустое значение допустимо в форме;
  - не использовать || 0, потому что это снова ломает удаление и возвращает ноль насильно.
  &nbsp;
3. Для priority зафиксируй нормализацию отдельно:
  &nbsp;
  - если поле пустое при сохранении → использовать 0;
  - если введено некорректное значение → fallback к 0;
  - но **не во время печати**.
  &nbsp;
4. Для duration_days зафиксируй нормализацию отдельно:
  &nbsp;
  - если режим manual и поле пустое → null, а не 0;
  - если режим tariff → duration_days = null;
  - пресеты должны писать строку, но сохраняться как число только в payload.
  &nbsp;
5. Исправь duration semantics не только в EffectiveGrantCard, но и везде, где показывается duration label на экране:
  &nbsp;
  - карточка правила;
  - preview / explain;
  - legacy/effective строки, если там участвует общий helper.
  - Нельзя оставить старый formatDuration(null) => "Бессрочно" где-то ещё на этом экране.
  &nbsp;
6. Лучше не перегружать formatDuration бизнес-смыслом.
  &nbsp;
  - Сделай отдельный helper уровня экрана, например:
    &nbsp;
    - getDurationDisplay(...)
    &nbsp;
  - Чтобы:
    &nbsp;
    - formatDuration занимался только форматированием числа,
    - а business resolution (из тарифа, зависит от тарифа, бессрочно) был отдельно и прозрачно.
    &nbsp;
  &nbsp;
7. В duration matrix уточни distinction:
  &nbsp;
  - unknown / unresolved in current preview context
  - truly unlimited
  - это не одно и то же.
  - Сейчас главный баг именно от смешения этих двух состояний.
  &nbsp;
8. В DoD добавь proof по numeric bug:
  &nbsp;
  - можно стереть 0 обычным backspace;
  - можно ввести 12 посимвольно;
  - можно оставить поле пустым и форма не ломается;
  - пресет после ручного ввода не ломает состояние.
  &nbsp;
9. В DoD добавь proof по duration semantics:
  &nbsp;
  - product-level rule без выбранного тарифа показывает:
    &nbsp;
    - По сроку тарифа покупки
    - или Срок зависит от тарифа;
    &nbsp;
  - tariff-level rule показывает конкретное значение;
  - Бессрочно не появляется как fallback для null.
  &nbsp;
10. Добавь post-patch note:

&nbsp;

&nbsp;

&nbsp;

- следующий отдельный патч после этого — **runtime verification новой rule и overlap new rule + legacy**, без расширения текущего UI-фикса.

&nbsp;

&nbsp;

План: PATCH v23.1.2 — Numeric input fix + duration semantics

## Scope и ограничения

- Backend, access_rules schema, runtime grant logic, legacy fallback logic — **не трогаем**
- Только UI-фиксы в 2 файлах

---

## Проблема 1: Numeric input bug

**Где:** `ProductAccessRulesTab.tsx`

- Строка 828: `duration_days` — `type="number"` + `parseInt` на каждый onChange → залипание
- Строка 851-853: `priority` — `type="number"` + `parseInt(e.target.value) || 0` → нельзя стереть 0

**Исправление:**

- Добавить string-state поля `priorityStr` и `durationDaysStr` в form (или отдельный state)
- Убрать `type="number"`, использовать `inputMode="numeric"` + `pattern="[0-9]*"`
- На onChange — просто сохранять string
- На blur — парсить в число (пустое → null/0)
- На save (handleSave) — парсить из string в number для payload

Конкретные строки:

- Строка 126-138: добавить `priority: "0"` и `duration_days: ""` как string
- Строка 178-192 (openCreateDialog): `priority: "0"`, `duration_days: ""`
- Строка 195-212 (openEditDialog): `priority: String(rule.priority)`, `duration_days: rule.duration_days != null ? String(rule.duration_days) : ""`
- Строка 226-237 (handleSave): парсить `form.priority` и `form.duration_days` из string
- Строка 811: preset onClick → `setForm({ ...form, duration_days: String(p.days) })`
- Строка 814: сравнение preset → `Number(form.duration_days) === p.days`
- Строка 824-831: Input → убрать type="number", `value={form.duration_days}`, onChange → сохранять string, onBlur → нормализовать
- Строка 850-855: priority Input → аналогично

---

## Проблема 2: Duration semantics — ложное «Бессрочно»

**Где:** `formatDuration` (строка 262-267)

```tsx
const formatDuration = (days: number | null) => {
  if (days == null) return "Бессрочно";  // ← ПРОБЛЕМА
```

Когда product-level rule имеет `duration_mode=tariff` и `duration_days=null`, а preview запрашивается без конкретного тарифа (`previewTariffId=""`), в `useEffectiveGrants` tariffAccessDays=null → duration_days=null → formatDuration возвращает «Бессрочно».

**Исправление в `EffectiveGrantCard` (строка 961-968):**
Заменить прямой вызов `formatDuration(g.duration_days)` на контекстно-зависимую логику:

```
если duration_source === "unknown" и duration_days === null:
  → "По сроку тарифа покупки"
если duration_days === null и source_type === "rule":
  → "По сроку тарифа покупки"  
иначе:
  → formatDuration(g.duration_days)
```

**Аналогично в списке правил (строка 411-415):**

```
если rule.duration_days == null и effectiveDuration == null:
  → показать "По сроку тарифа покупки" вместо formatDuration(null) = "Бессрочно"
```

**Duration resolution matrix (для кода и отчёта):**


| Приоритет | Источник    | Условие                      | Лейбл                        |
| --------- | ----------- | ---------------------------- | ---------------------------- |
| 1         | rule manual | rule.duration_days != null   | `{N} дн. (из правила)`       |
| 2         | tariff      | tariffAccessDays != null     | `{N} дн. (из тарифа)`        |
| 3         | legacy      | legacy.duration_days != null | `{N} дн. (старая настройка)` |
| 4         | не задано   | все null, product-level      | `По сроку тарифа покупки`    |
| 5         | бессрочно   | явный режим (future)         | `Бессрочно`                  |


`Бессрочно` больше не используется как fallback для null.

---

## Файлы


| Файл                                                     | Изменения                                                                                            |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `src/components/admin/product/ProductAccessRulesTab.tsx` | Numeric string-state для priority/duration_days; duration label fix в EffectiveGrantCard и rule list |
| `src/hooks/useAccessRules.ts`                            | Без изменений                                                                                        |


## DoD

1. priority и duration_days можно стереть backspace и ввести число посимвольно
2. Product-level rule с mode «из тарифа» показывает «По сроку тарифа покупки», а не «Бессрочно»
3. Tariff-level rule показывает конкретный срок с пометкой источника
4. «Бессрочно» показывается только когда нет ни одного источника срока и это не product-level rule с наследованием
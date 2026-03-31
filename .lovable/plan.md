# Не меняй сейчас архитектуру селектора и не уходи в замену одного компонента на другой как “оптимизацию”.

Текущий scope остаётся прежним:

1. сначала доведи до рабочего состояния текущий selector в тренингах;

2. почини scroll;

3. покажи визуальный proof, что список реально прокручивается, ничего не обрезается и все продукты доступны для выбора.

Важно:

вопрос переиспользования одного и того же компонента/одной и той же функции между Access Rules и тренингами я не снимаю, но это следующий патч после закрытия текущего UI-бага.

То есть сейчас:

- не делать рефакторинг ради рефакторинга;

- не подменять задачу;

- сначала закрыть баг со scroll и dropdown в текущем месте использования;

- после этого отдельно вернуться к сквозному переиспользованию одного механизма/компонента для продукта и тренинга.

&nbsp;

План: Заменить CompactAccessSelector на ProductTariffAccessSelector

## Диагноз

- `CompactAccessSelector` — popover-based dropdown, scroll не работает корректно (Radix Popover ограничивает высоту).
- `ProductTariffAccessSelector` — уже существует в проекте, **не используется нигде**, но имеет рабочий scroll (`max-h-[50vh] overflow-y-auto`), Collapsible-аккордеон, quick-selector (Все/Выборочно/Нет).
- Оба компонента имеют **идентичный интерфейс**: `selectedTariffIds`, `onChange`, `products`, `className`.

## Что делаем

### Шаг 1: Заменить импорт в двух файлах

`**src/pages/admin/AdminTrainingModules.tsx**` (строка 65):

```diff
- import { CompactAccessSelector } from "@/components/admin/trainings/CompactAccessSelector";
+ import { ProductTariffAccessSelector } from "@/components/admin/trainings/ProductTariffAccessSelector";
```

JSX: `<CompactAccessSelector` → `<ProductTariffAccessSelector` (props идентичны).

`**src/components/admin/trainings/ContentCreationWizard.tsx**` (строка 32):

```diff
- import { CompactAccessSelector } from "./CompactAccessSelector";
+ import { ProductTariffAccessSelector } from "./ProductTariffAccessSelector";
```

JSX: замена в 2 местах (строки ~908, ~1011).

### Шаг 2: Удалить CompactAccessSelector.tsx

Файл `src/components/admin/trainings/CompactAccessSelector.tsx` больше не используется — удалить.

## Файлы


| Файл                        | Изменение                                        |
| --------------------------- | ------------------------------------------------ |
| `AdminTrainingModules.tsx`  | Импорт + JSX → `ProductTariffAccessSelector`     |
| `ContentCreationWizard.tsx` | Импорт + JSX × 2 → `ProductTariffAccessSelector` |
| `CompactAccessSelector.tsx` | Удалить                                          |


## Почему это безопасно

- Интерфейс props идентичен: `selectedTariffIds`, `onChange`, `products`, `className`.
- `ProductTariffAccessSelector` уже имеет рабочий scroll и поиск не нужен — список inline с аккордеоном, а не popover.
- Write-path не меняется: оба компонента просто передают `tariffIds` наверх, запись в `module_access` происходит в родительских компонентах.

## DoD

1. Dropdown «Доступ к контенту» скроллится нормально
2. Все продукты видны и доступны для выбора
3. Write-path не изменён (всё ещё `module_access`)
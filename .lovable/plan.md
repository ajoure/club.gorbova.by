# да, согласен, с учетом правок:

&nbsp;

1. **Пункт 3 — твой JSX снова невалидный (двойные {})**
  &nbsp;
  - В примере:
  &nbsp;

&nbsp;

```
{tab.mobileLabel 
  ? {tab.mobileLabel}
  : {tab.label}
}
```

&nbsp;

1. &nbsp;
  - — фигурные скобки внутри тернарника создают объект, это сломает сборку.
  - Правильно (строка/нода без дополнительных {}):
  &nbsp;

&nbsp;

```
{tab.mobileLabel ? tab.mobileLabel : tab.label}
```

&nbsp;

1. &nbsp;
  - &nbsp;
  - И одновременно нужно **развести mobile/desktop** через классы, иначе на desktop будет показано и tab.label, и результат тернарника (дубли).
  - Лучший вариант без дублей:
  &nbsp;

&nbsp;

```
<span className="hidden sm:inline">{tab.label}</span>
<span className="sm:hidden">{tab.mobileLabel ?? tab.label}</span>
```

&nbsp;

1. &nbsp;
2. **Пункт 3 — “hidden sm:inline + безусловный span” действительно даёт дубли**
  &nbsp;
  - Фикс выше решает это строго.
  &nbsp;
3. **Пункт 5 — calc(var(--app-height) - 280px) ок только если --app-height гарантированно задан**
  &nbsp;
  - В плане по мобильной верстке --app-height задаётся в src/index.css. Если это ещё не вмержено/не подключено — добавь guard:
    &nbsp;
    - либо оставить fallback через @supports (как уже планировали),
    - либо использовать minHeight/flex вместо hard-coded calc (лучше, но раз план уже про 5 ошибок — оставляем calc).
    &nbsp;
  - DoD: на desktop и mobile высота панели корректна, без “пустого” пространства и без обрезания инпута.
  &nbsp;
4. **Пункт 5 — не оставляй магическое -280px без комментария**
  &nbsp;
  - Добавь короткий комментарий рядом, что это “header + tabs + paddings”, иначе потом никто не поймёт и сломает.
  &nbsp;
5. **Пункт 1 — проверь, что key реально "/ai", а не "/ai/*" или route id**
  &nbsp;
  - В некоторых роутерах label мапится по pathname/routeId. В плане добавить DoD:
    &nbsp;
    - breadcrumbs на /ai показывает именно «AI-инструменты для твоего бизнеса».
    &nbsp;
  &nbsp;
6. **Добавь DoD на компиляцию**
  &nbsp;
  - После правок страница собирается без TS/JSX ошибок, таб-лейблы не дублируются (desktop и mobile).
  &nbsp;

&nbsp;

&nbsp;

---

&nbsp;

&nbsp;

## **Исправленный блок пункта 3 (готовый для вставки)**

&nbsp;

```
<span className="hidden sm:inline">{tab.label}</span>
<span className="sm:hidden">{tab.mobileLabel ?? tab.label}</span>
```

Остальные пункты плана (1,2,4,5) — ок с учётом правок выше.

&nbsp;

План: Исправление 5 ошибок на странице /ai

## Изменения

### 1. `src/components/layout/DashboardBreadcrumbs.tsx` (строка 28)

Заменить `"/ai": "AI"` на `"/ai": "AI-инструменты для твоего бизнеса"`.

### 2. `src/pages/AI.tsx` — удалить дублирующий subheader (строка 211)

Удалить `<p className="text-sm text-muted-foreground">AI-инструменты для твоего бизнеса</p>` — текст теперь в breadcrumbs.

### 3. `src/pages/AI.tsx` — исправить рендер label в табах (строки 232-234)

Сейчас на desktop label показывается дважды (hidden sm:inline + безусловный span для !mobileLabel). Заменить на:

```tsx
<Icon className="h-4 w-4 mr-0.5" />
<span className="hidden sm:inline">{tab.label}</span>
{tab.mobileLabel 
  ? <span className="sm:hidden">{tab.mobileLabel}</span>
  : <span className="sm:hidden">{tab.label}</span>
}
```

Это показывает `mobileLabel` на mobile (если есть) и полный `label` на desktop, без дублей.

### 4. Кнопки табов — добавить `type="button"` (строка 224)

Добавить `type="button"` к `<button>`, чтобы предотвратить случайный submit.

### 5. Chat panel — заменить `100vh` на `var(--app-height)` (строка 243)

`style={{ height: "calc(100vh - 280px)" }}` → `style={{ height: "calc(var(--app-height) - 280px)" }}` — согласованность с PATCH мобильной верстки.

## Файлы


| Файл                       | Строки  | Что                                         |
| -------------------------- | ------- | ------------------------------------------- |
| `DashboardBreadcrumbs.tsx` | 28      | label → «AI-инструменты для твоего бизнеса» |
| `AI.tsx`                   | 211     | удалить subheader                           |
| `AI.tsx`                   | 224     | `type="button"`                             |
| `AI.tsx`                   | 232-234 | fix mobile/desktop label rendering          |
| `AI.tsx`                   | 243     | `var(--app-height)` вместо `100vh`          |

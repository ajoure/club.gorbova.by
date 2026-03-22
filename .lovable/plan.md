

# PATCH 4 — Секция «Реквизиты» в /ai + placeholder screens

## Scope

Add-only расширение `src/pages/AI.tsx`. Никаких новых таблиц, миграций, edge functions, hooks с данными. Только UI-каркас.

## Что делаем

### 1. Расширить типы в AI.tsx

```typescript
type Section = "ai" | "documents" | "requisites";
type SubTab = "chat" | "tutorials" | "prompts" | "accountant" | "manager" | "audit" | "templates" | "entities" | "persons";
```

### 2. Добавить секцию «Реквизиты» в SECTIONS

Новый элемент с иконкой `Building2` (или `FileText` / `Briefcase` — по контексту существующих).

### 3. Добавить REQUISITES_SUB_TABS

Два подменю:
- **Юрлица / ИП** (`entities`) — иконка `Building2`, glass pill style
- **Физлица** (`persons`) — иконка `Users`, glass pill style

Стиль — аналогичный существующим `AI_SUB_TABS` и `DOC_SUB_TABS` (gradient + border + icon color).

### 4. Обновить DEFAULT_SUB

```typescript
const DEFAULT_SUB: Record<Section, SubTab> = {
  ai: "chat",
  documents: "accountant",
  requisites: "entities",
};
```

### 5. Обновить subTabs selector

Добавить третью ветку: `activeSection === "requisites" ? REQUISITES_SUB_TABS : ...`

### 6. Добавить placeholder screens для entities и persons

По аналогии с существующими document stubs (строки 528-544): GlassCard с иконкой, заголовком и текстом «Раздел в разработке».

## Файлы

- `src/pages/AI.tsx` — единственный файл, add-only изменения

## Что НЕ меняется

- Никакие hooks
- Никакие edge functions
- Никакие таблицы
- Никакие компоненты вне AI.tsx
- Существующие секции ai / documents — без изменений

## DoD

- Третья секция «Реквизиты» видна в pill-bar
- Переключение работает корректно
- SubTabs «Юрлица / ИП» и «Физлица» отображаются
- Placeholder screens показываются
- Существующие секции не сломаны


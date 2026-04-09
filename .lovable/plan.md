да, согласен, с учетом правок:

&nbsp;

1. Kill-switch нельзя кэшировать 5 минут.  
Это аварийный флаг. Для него нужен отдельный режим:  

  - staleTime: 0 или максимум 5–10 секунд,
  - либо явная инвалидация query после изменения значения.  
  Иначе kill-switch не будет “мгновенным”.
2. &nbsp;
3. isError -> deny формулируй как правило только для уже обёрнутой gated-секции.  
Не как универсальное правило “для любого sectionCode”.  
Сейчас это допустимо только для eisenhower, потому что guard подключён только там. Иначе потом это начнёт противоречить ранее согласованному поведению public routes.
4. Маппинг key → section_code вынести в один shared-файл и использовать везде одинаково.  
Не дублировать отдельно в sidebar и отдельно в guard.  
Нужен один SoT, например:  

  - src/constants/sectionCodes.ts
  - экспорт map + helper resolveSectionCode().
5. &nbsp;
6. Добавь жёсткий STOP-guard по админке секций.  
Пока SectionGuard подключён только к eisenhower, запрещено переводить в is_public=false любые другие секции, у которых guard ещё не внедрён.  
Иначе получится опасная рассинхронизация:  

  - в /admin/sections секция закрыта,
  - в sidebar может появиться lock,
  - но сама страница всё ещё откроется.  
  Это надо либо блокировать в UI, либо хотя бы подтверждать жёстким warning с запретом save.
7. &nbsp;
8. DoD дополни proof-кейсом по kill-switch latency.  
Нужно отдельно доказать:  

  - section_gating_enabled=false реально снимает deny без ожидания долгого TTL,
  - после возврата в true gating снова включается.
9. &nbsp;

&nbsp;

&nbsp;

После этих правок план корректный.

# План: исправление критических багов section_access enforcement

## Диагностика — 3 подтверждённых бага

### Баг 1: Kill-switch парсинг (useSectionAccess.ts:53-54)

**Факт:** В БД `app_settings.value = true` (boolean). Код читает `data.value === true || data.value === "true"`.
**Проблема:** Если значение будет записано как JSON `{"enabled": false}`, текущий код прочитает его как truthy-объект и вернёт `true` (gating включён). Нет поддержки формата `{enabled: boolean}`.
**Фикс:** Парсить value с приоритетом: объект с `.enabled` → boolean → string → fallback `true`.
**STOP-guard:** Если значение отсутствует или имеет неизвестный формат → gating **включён** (safe mode, deny по умолчанию для gated секций).

### Баг 2: Порядок проверок в SectionGuard (SectionGuard.tsx:40-45)

**Факт:** `checkAccess()` при `isError=true` возвращает `found: false` (пустой массив sections), guard пропускает → gated секция открывается при ошибке RPC.
**Проблема:** Проверка `!access.found` (строка 43) стоит **до** проверки `isError` (строка 53). При ошибке RPC секции пустые → found=false → allow.
**Фикс:** Переставить: сначала `isError` → deny для любого sectionCode (нельзя определить public/gated без данных), потом `!found` → allow.

### Баг 3: Маппинг key → section_code (AppSidebar.tsx:188)

**Факт:** sidebar key `self-development`, а в app_sections code `self_development`. Также `eisenhower` в sidebar — в отдельном массиве `leaderToolsItems`, а не в `mainMenuItems`.
**Проблема:** `checkAccess(item.key)` с дефисом не найдёт запись с подчёркиванием → `found: false` → lock не покажется.
**Фикс:** Явный маппинг `Record<string, string>` для всех расхождений.

---

## Файлы и изменения

### 1. `src/hooks/useSectionAccess.ts` — kill-switch парсинг

Строки 47-54: заменить queryFn на безопасный парсер:

```typescript
queryFn: async () => {
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "section_gating_enabled")
    .maybeSingle();
  
  // Отсутствует или ошибка → safe mode (gating включён)
  if (error || !data) return true;
  
  const val = data.value;
  
  // JSON-объект: { enabled: true/false }
  if (val && typeof val === 'object' && 'enabled' in val) {
    return val.enabled === true || val.enabled === 'true';
  }
  
  // Прямой boolean
  if (typeof val === 'boolean') return val;
  
  // Строка "true"/"false"
  if (val === 'true') return true;
  if (val === 'false') return false;
  
  // Неизвестный формат → safe mode
  console.warn('section_gating_enabled: unexpected format', val);
  return true;
},
```

### 2. `src/components/layout/SectionGuard.tsx` — порядок проверок

Переставить блоки после loading:

```
1. Kill-switch → allow
2. Loading → spinner
3. isError → deny + error UI (для ЛЮБОГО sectionCode, т.к. данных нет)
4. checkAccess() → found/public/access логика
```

Конкретно: блок `isError` перенести **до** вызова `checkAccess()`, с текстом "Не удалось проверить доступ. Обновите страницу."

### 3. `src/components/layout/AppSidebar.tsx` — маппинг key → code

Добавить константу:

```typescript
const SIDEBAR_KEY_TO_SECTION_CODE: Record<string, string> = {
  "self-development": "self_development",
};
```

В `renderMenuItem` (строка 188): использовать маппинг:

```typescript
const sectionCode = SIDEBAR_KEY_TO_SECTION_CODE[item.key] || item.key;
const sectionAccess = gatingEnabled && !isAdminUser ? checkAccess(sectionCode) : null;
```

Применить тот же маппинг для `leaderToolsItems` (eisenhower), чтобы lock работал и там.

### 4. `src/components/layout/SectionGuard.tsx` — маппинг в guard

Добавить тот же маппинг (или вынести в shared константу), чтобы guard тоже резолвил code корректно. Экспортировать маппинг из общего файла, например `src/constants/sectionCodes.ts`.

---

## Что НЕ меняется

- Никакие другие страницы и роуты
- RPC `get_user_section_access`
- Таблицы `app_sections`, `access_rules`
- Enforcement только на `eisenhower`
- money, live, ai, self_development — не подключаются к SectionGuard

## DoD

1. Kill-switch: value=`true` → gating вкл; value=`{"enabled": false}` → gating выкл; value отсутствует → gating вкл (safe mode)
2. RPC error → deny + error UI для eisenhower
3. sidebar key `self-development` корректно маппится на `self_development`
4. lock-иконка видна для обычного пользователя на gated секции
5. lock-иконка не видна для admin
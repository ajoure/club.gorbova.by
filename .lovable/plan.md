да, согласен, с учетом правок:

&nbsp;

1. В SectionGuard не нужен resolveSectionCode, если он получает уже готовый sectionCode через prop. Маппинг нужен только там, где источник — sidebar key.
2. Для leaderToolsItems проверь, что у элемента точно есть поле key. Если сейчас тип/объект его не содержит, сначала добавить key: "eisenhower" в сам массив, иначе план упирается в скрытую TS-ошибку.
3. В DoD добавь отдельный proof на скорость срабатывания kill-switch:  
enabled=false → deny снимается без ручного hard refresh максимум за 10 секунд или после явной invalidate.
4. Добавь STOP-guard: пока SectionGuard подключён только к eisenhower, перевод в is_public=false других секций должен быть запрещён или хотя бы сопровождаться жёстким warning “enforcement ещё не подключён”.
5. В DoD пункт про lock-иконку уточни: проверка должна быть на реально gated секции, а не абстрактно. Иначе формально пункт можно “закрыть” без живого кейса.

&nbsp;

&nbsp;

# План: исправление 3 критических багов section_access enforcement

## Диагностика

### Баг 1: Kill-switch парсинг (`useSectionAccess.ts:53-54`)

Сейчас: `data.value === true || data.value === "true"`. В БД значение `true` (boolean). Но если записать JSON `{"enabled": false}`, код прочитает объект как truthy и вернёт неверный результат.  
**Фикс:** Парсить с приоритетом: объект `{enabled}` → boolean → string → fallback `true` (safe mode). staleTime снизить до 10с.

### Баг 2: Порядок проверок в SectionGuard (`SectionGuard.tsx:40-45`)

Сейчас: при ошибке RPC `sections=[]` → `checkAccess()` возвращает `found: false` → guard пропускает (allow). Gated секция открывается при ошибке.  
**Фикс:** Проверку `isError` поставить **до** `checkAccess()`. При ошибке RPC — deny + error UI.

### Баг 3: Маппинг key → section_code

Sidebar key `self-development` ≠ DB code `self_development`. `checkAccess("self-development")` → `found: false` → lock не покажется.  
**Фикс:** Создать `src/constants/sectionCodes.ts` с маппингом, использовать в sidebar и guard.

## Файлы и изменения

### 1. Новый файл `src/constants/sectionCodes.ts`

```typescript
export const SIDEBAR_KEY_TO_SECTION_CODE: Record<string, string> = {
  "self-development": "self_development",
};
export function resolveSectionCode(key: string): string {
  return SIDEBAR_KEY_TO_SECTION_CODE[key] || key;
}
```

### 2. `src/hooks/useSectionAccess.ts`

- Kill-switch queryFn: парсинг `value` как JSON-объект / boolean / string / fallback `true`
- `console.warn` при неизвестном формате
- staleTime: `10_000` (10с, для быстрого отключения)

### 3. `src/components/layout/SectionGuard.tsx`

Порядок проверок:

1. Kill-switch off → allow
2. Loading → spinner
3. **isError → deny + error UI** (до checkAccess)
4. checkAccess → found/public/access логика

### 4. `src/components/layout/AppSidebar.tsx`

- Импорт `resolveSectionCode`
- В `renderMenuItem`: `checkAccess(resolveSectionCode(item.key))`
- В `leaderToolsItems.map`: `checkAccess(resolveSectionCode(item.key))`

## Что НЕ меняется

- RPC, таблицы, миграции
- AdminSections.tsx
- Роуты (guard только на eisenhower)
- money, live, ai — не подключаются

## DoD

1. Kill-switch: `true` → gating вкл; `{"enabled": false}` → gating выкл; отсутствует → safe mode (вкл)
2. RPC error → deny + error UI для eisenhower
3. `self-development` корректно маппится на `self_development`
4. Lock-иконка видна обычному пользователю на gated секции
5. Lock не видна admin
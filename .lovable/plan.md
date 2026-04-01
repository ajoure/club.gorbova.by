# да, согласен, с учетом правок:

&nbsp;

1. В AdminSystemDocs.tsx seed должен логировать именно фактически созданные manual-домены.  
Сейчас вместе с исправлением existingManualKeys нужно отдельно собирать createdDomains[] и писать в audit_logs.meta именно его, а не вычислять список постфактум по старой логике.
2. В useSystemDocs.ts авто-переключение в auto нужно делать как единственный fallback-режим.  
Добавь поведение:  

  - если manual.length === 0 && auto exists → setViewMode("auto")
  - одновременно сбрасывать selectedManualVersion в "", чтобы не оставался stale state от прошлой вкладки/домена
  - если initialVersion был передан, но такой manual-версии нет, а AUTO-CURRENT есть — тоже уходить в auto, а не оставаться на пустом экране
3. &nbsp;
4. initialMode должен стать реально опциональным по всей цепочке.  
Не только в AdminSystemDocs.tsx, но и в пропсах/вызове DomainTab и useSystemDocs не форсировать "manual" по умолчанию раньше времени. Решение о fallback-режиме должен принимать хук после загрузки данных.
5. Нужен явный post-proof после патча.  
Проверить и показать:  

  - домен, где есть только AUTO-CURRENT → открывается сразу в auto
  - после Seed у такого домена появляется POINT A
  - products_sales не получает новый POINT A
  - system_docs.seed_generated в audit_logs содержит только реально созданные section_key
6. &nbsp;
7. Idempotency seed зафиксировать явно.  
Повторный Seed не должен:  

  - создавать второй POINT A
  - менять AUTO-CURRENT
  - менять active/manual-историю существующих доменов
8. &nbsp;

&nbsp;

&nbsp;

В остальном патч правильный.

&nbsp;

PATCH: Починить Seed и стартовый режим документации

## Корень проблемы

1. **Seed** (строка 172-174 в AdminSystemDocs.tsx) проверяет `existingKeys.has(domain.key)` — если для домена есть хоть одна запись (включая AUTO-CURRENT), seed считает домен "заполненным" и не создаёт POINT A.
2. **useSystemDocs** (строка 106-110) при отсутствии manual-версий не переключается в auto-режим — пользователь видит пустой экран.

## Патч (3 файла)

### 1. `src/pages/admin/AdminSystemDocs.tsx` — seed-логика

Заменить проверку `existingKeys` на проверку наличия именно manual-версий:

```ts
// Было: existingKeys = Set всех section_key (включая AUTO-CURRENT)
// Нужно: проверять только manual-версии
const existingManualKeys = new Set(
  ((existing as any[]) || [])
    .filter((d: any) => d.version_label !== 'AUTO-CURRENT')
    .map((d: any) => d.section_key)
);

for (const domain of SYSTEM_DOC_DOMAINS) {
  // products_sales не трогать, если manual уже есть
  if (existingManualKeys.has(domain.key)) continue;
  // создать POINT A
}
```

### 2. `src/hooks/useSystemDocs.ts` — автовыбор режима

После загрузки версий, если manual-версий нет, но есть AUTO-CURRENT — переключиться в auto:

```ts
// После строки 109, добавить:
if (manual.length === 0) {
  const auto = docs.find((d) => isAutoVersion(d));
  if (auto) {
    setViewMode("auto");
  }
}
```

### 3. `src/pages/admin/AdminSystemDocs.tsx` — modeParam по умолчанию

Строка 92: если `initialMode` не задан через URL, позволить хуку самому определить режим на основе данных. Не форсировать `"manual"`.

Изменение минимальное: передавать `initialMode` из URL только если он явно задан, иначе `undefined` — и хук сам решит.

## Не изменяется

- `SystemDocViewer.tsx` — без изменений
- `systemDocsRegistry.ts` — без изменений  
- EF `system-docs-nightly-refresh` — без изменений
- RLS, схема — без изменений

## DoD

- Seed создаёт POINT A для доменов, где есть только AUTO-CURRENT
- Seed не трогает products_sales (там уже POINT A/B/C)
- Если manual-версий нет, UI открывается в режиме auto
- Copy/Download в auto-режиме работают с AUTO-CURRENT
- audit_logs содержит запись `system_docs.seed_generated`
- Пустой экран не появляется, если хотя бы одна версия существует
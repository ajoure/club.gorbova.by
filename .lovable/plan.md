# Да, согласен, с учетом правок:

1. Не пиши категорично `мёртвого кода не обнаружено`, пока нет фактического proof:
  - `rg "console\.log|debugger"` по проекту или по затронутым папкам,
  - TypeScript build,
  - при наличии — lint / unused imports check.
2. В cleanup лучше зафиксировать не только 3 файла, а правило:
  - удалить **все временные debug** `console.log`, появившиеся в рамках address/google pipeline,
  - но не трогать рабочие `warn/error` для реальных сбоев.
3. В `DoD` добавь:
  - build проходит;
  - нет новых unused imports / unused vars после удаления логов;
  - `rg "console\.log"` по затронутым файлам возвращает 0.
4. Фразу `Address pipeline не затронут` лучше заменить на:
  - `изменения только cleanup, без изменения бизнес-логики и save/apply flow`,  
  потому что формально файлы pipeline всё же редактируются.
5. После cleanup нужен короткий verify:
  - `Профиль -> Реквизиты` открывается;
  - ЮЛ/ИП форма открывается;
  - один smoke-test адреса проходит без регрессии.

Итог: план нормальный.  
Можно отправлять как cleanup-патч после verify.

PATCH 3.2.7B — Cleanup после verify

## Что делаем

Удаляем диагностические `console.log` из трёх файлов. Оставляем только `console.warn` и `console.error` для реальных сбоев.

Мёртвого кода и неиспользуемых импортов в затронутых файлах не обнаружено — всё используется.

## Файлы и изменения

### 1. `src/lib/address/GrpAddressEnricher.ts`

**Удалить 7 строк `console.log`:**

- строка 92: `console.log('[GrpAddressEnricher] Starting enrichment...')`
- строка 93: `console.log('[GrpAddressEnricher] Preliminary address:...')`
- строка 102: `console.log('[GrpAddressEnricher] Query:...')`
- строка 116: `console.log('[GrpAddressEnricher] Got suggestions:...')`
- строки 134-138: `console.log(Candidate ${i} details:...)`
- строка 145: `console.log(Candidate ${i} parsed:...)`
- строка 178: `console.log('[GrpAddressEnricher] ✅ Merged result:...')`

**Оставить:**

- строка 96: `console.warn` — Google API not available
- строка 149: `console.warn` — candidate rejected
- строка 181: `console.warn` — candidate fetch error
- строка 189: `console.error` — fatal error

### 2. `src/hooks/useGoogleMapsLoader.ts`

**Удалить 2 строки `console.log`:**

- строка 134: `console.log("[GoogleMapsLoader] Starting Google Maps load...")`
- строка 141: `console.log("[GoogleMapsLoader] Load complete...")`

**Оставить:**

- строка 76: `console.error` — importLibrary failed
- строка 81: `console.error` — API not found
- строка 127: `console.error` — API key not configured

### 3. `src/components/legal-details/OrganizationDetailsForm.tsx`

**Удалить 3 блока `console.log`:**

- строки 227-232: `console.log('[OrganizationDetailsForm] handleGrpConfirm called...')`
- строка 265: `console.log('[OrganizationDetailsForm] Fresh address before enrichment:...')`
- строки 274-279: `console.log('[OrganizationDetailsForm] Enrichment result:...')`

### 4. Не трогаем

- `GooglePlacesAdapter` — используется
- `googlePlaceDetails.ts` — используется
- `GrpAddressEnricher` — используется
- `OrgFormCombobox` — используется
- `StructuredAddressBlock` — используется
- `Profile.tsx` — уже чистый, карточка удалена ранее
- `LegalDetails.tsx` — `CheckCircle2`/`AlertCircle` используются для `valid`/`invalid` статусов

## DoD

- Ноль `console.log` в production-коде address pipeline
- Только `console.warn` / `console.error` для реальных сбоев
- Навигация `Профиль → Реквизиты` работает
- Address pipeline не затронут (только удаление логов)
да, согласен, с учетом правок:

&nbsp;

1. Для manual refresh не передавать user_id из body как источник истины.  
Нужно брать пользователя из Authorization/JWT внутри EF и только его писать в audit_logs.  
body.user_id можно вообще не использовать, иначе это spoofable.
2. Исправить actor_type в двух местах:  

  - seed в AdminSystemDocs.tsx → actor_type='user'
  - manual refresh в EF → actor_type='user', actor_user_id = auth.uid() из JWT  
  cron-hourly оставить actor_type='system', actor_user_id=NULL.
3. &nbsp;
4. Deep-link нужно чинить не только при смене домена, но и при смене режима:  

  - при переключении manual/auto обновлять ?domain=...&mode=...
  - при выборе manual-версии обновлять ?version=...
  - в auto-режиме version очищать, чтобы URL не был двусмысленным.
5. &nbsp;
6. В handleDomainChange сохранять не только mode, но и корректно работать с version:  

  - если режим manual и выбранная версия есть — оставлять version
  - если режим auto — удалять version
  - при смене домена не тащить version от другого домена.
7. &nbsp;
8. В финальный proof добавить отдельную проверку:  

  - manual refresh → запись в audit_logs с actor_type='user'
  - nightly refresh → запись в audit_logs с actor_type='system'
  - после reload сохраняются domain, mode, version
  - в auto-режиме URL не содержит лишний version.
9. &nbsp;

&nbsp;

&nbsp;

После этих правок план можно отдавать в реализацию.

&nbsp;

# План: FINAL PATCH-PROOF — Документация системы

## Discovery: обнаруженные расхождения

### 1. actor_type не выровнен


| Место                                                       | Текущий actor_type | Требуемый |
| ----------------------------------------------------------- | ------------------ | --------- |
| `useSystemDocs.ts` (copy/download/create/activate/archive)  | `user`             | `user` ✅  |
| `AdminSystemDocs.tsx` seed (строка 159)                     | `admin`            | `user` ❌  |
| EF manual_refresh_started/completed (строки 82-88, 185-191) | `system`           | `user` ❌  |


**Проблема:** seed использует `actor_type: "admin"` вместо `"user"`. Manual refresh в EF использует `actor_type: 'system'` и `actor_user_id: null` вместо `"user"` + user_id. Нужно передавать user_id из клиента в body запроса EF и использовать его для manual refresh audit.

### 2. Deep-link не сохраняет mode

При переключении домена через `handleDomainChange` (строка 120-125) в URL записывается только `domain`, но не `mode`. После reload mode теряется.

### 3. Data proof — ОК

- 7 AUTO-CURRENT, по одному на section_key ✅
- products_sales: POINT A (archived), POINT B (archived), POINT C (active), AUTO-CURRENT (system) ✅
- Manual версии не затронуты ✅

### 4. Cron proof — ОК

- Один job: `system-docs-nightly-refresh`, schedule `0 * * * *` ✅
- Без дублей ✅

### 5. AdminProductsDocs — ОК

Чистая preset-обёртка, 0 собственной логики ✅

---

## Corrective patch (минимальный)

### Патч 1: actor_type для seed

**Файл:** `src/pages/admin/AdminSystemDocs.tsx`, строка 159

```
actor_type: "admin" → actor_type: "user"
```

### Патч 2: actor_type для manual refresh в EF

**Файл:** `supabase/functions/system-docs-nightly-refresh/index.ts`

1. Из body запроса читать `user_id` (опционально)
2. Для `source === 'manual'`:
  - `actor_type: 'user'` (вместо `'system'`)
  - `actor_user_id: body.user_id || null`
3. Для `source === 'cron-hourly'` — оставить `actor_type: 'system'` ✅

**Файл:** `src/pages/admin/AdminSystemDocs.tsx`, функция `handleManualRefresh`

Добавить `user_id: user?.id` в body запроса EF.

### Патч 3: deep-link сохраняет mode

**Файл:** `src/pages/admin/AdminSystemDocs.tsx`, функция `handleDomainChange`

```ts
setSearchParams({ domain: key, mode: modeParam });
```

Также при переключении mode в `DomainTab` → нужно пробросить callback наверх для обновления URL. Альтернативный подход: `SystemDocViewer` при переключении mode вызывает `onSetViewMode`, а `DomainTab` через callback обновляет URL. Для минимальности — не добавлять callback, а просто сохранять mode при смене домена.

### Затрагиваемые файлы


| Файл                                                      | Правка                                                                               |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `src/pages/admin/AdminSystemDocs.tsx`                     | seed actor_type → `"user"`, передача user_id в manual refresh, сохранение mode в URL |
| `supabase/functions/system-docs-nightly-refresh/index.ts` | для manual: actor_type → `"user"`, actor_user_id из body                             |


**Не изменяется:** схема, RLS, useSystemDocs.ts, SystemDocViewer.tsx, systemDocsRegistry.ts, AdminProductsDocs.tsx.
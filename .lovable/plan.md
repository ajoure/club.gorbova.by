да, согласен, с учетом правок:

1. План можно выполнять. Диагностика корректная: проблема сейчас не в БД, а в read-model/cache UI. Если в БД уже стоит:
  &nbsp;
  `generation_mode='per_role_person'`  
  `repeat_role_catalog_id='c8fc4200-75c0-4c24-8eea-112c4e468aeb'`
  а карточка показывает «Один документ», значит `PackageDocumentCard` получает неполный item без `generation_mode/repeat_role_catalog_id`.
2. В `DocumentPackageQuestionnairesView.tsx` обязательно добавить в select не только:
  &nbsp;
  `generation_mode, repeat_role_catalog_id`
  но и проверить, не нужен ли `package_template_id` для корректной передачи в hook/role query. Если карточка не знает package_template_id, она может брать роли не из того источника или не обновлять правильный query key.
3. Mutation в `usePackageItemGenerationMode.ts` должна возвращать полную минимальную строку:
  &nbsp;
  ```sql
  id, package_template_id, generation_mode, repeat_role_catalog_id, updated_at
  ```
  Это нужно для точечного `setQueryData` и proof.
4. Success toast показывать только после подтверждённого `.select(...).single()` response. Если Supabase вернул error, trigger error или пустой response — только error toast, без optimistic success.
5. `setQueryData` должен обновлять все реальные read-models, где используется item:
  - `['doc-pkg-template-items-q', packageTemplateId]`
  - `['pkg-bound-templates', packageTemplateId]`
  - `['document-package-items', packageTemplateId]`
  Если в коде есть дополнительные keys для package items — их тоже добавить после `rg`.
6. В `PackageDocumentCard` убрать любой `useEffect`, который на каждом render сбрасывает local mode из неполного/старого `item`. Локальный preview можно сбрасывать только когда пришёл подтверждённый persisted value из актуального query или mutation response.
7. Проверить, что нет второго update `single/null`.
  В proof нужен Network trace:
  - один update payload:
  - нет последующего payload:
8. В `TemplateBindingControl` и `PackageDocumentCard` не должно быть двух разных реализаций сохранения. Оба должны использовать `usePackageItemGenerationMode`. Если останется локальная mutation в одном из компонентов — Stage не принимать.
9. В proof добавить проверку hard refresh:
  - сохранить `per_role_person`;
  - обновить страницу браузера;
  - открыть карточку «Извещение»;
  - режим всё ещё `Отдельный документ для каждого физлица с ролью`;
  - роль всё ещё `Участник`.
10. В proof добавить сверку двух UI-точек:

- вкладка «Анкеты документов» / карточка «Извещение»;
- вкладка «Шаблоны пакета» / тот же item.

Обе должны показывать одинаково:

`per_role_person + Участник`.

11. Stage C после этого save-fix ещё не закрывать автоматически как full PASS.

Этот патч закрывает только:

`runtime save/cache bug`.

Полный Stage C PASS будет только после генерации 3 отдельных извещений или после явной фиксации, что оставшийся блокер — проблема шаблона `ln-000014 Ревизор`, а не механики `per_role_person`.

12. После выполнения этого патча статус должен быть:

- если режим сохраняется, но генерация всё ещё блокируется из-за `ln-000014 Ревизор`:  
`Stage C runtime: PARTIAL — UI/save fixed, waiting for template/data fix по Ревизору`.
- если после назначения Ревизора или замены токена на `recipient.*` генерация дала 3 извещения:  
`Stage C runtime: PASS`.

13. DoD дополнить:

- `DocumentPackageQuestionnairesView` реально читает `generation_mode/repeat_role_catalog_id`: PASS.
- Mutation response возвращает updated row: PASS.
- Все query keys синхронизированы: PASS.
- Нет второго update `single/null`: PASS.
- После hard refresh режим сохраняется: PASS.
- Карточка документа и `TemplateBindingControl` показывают одинаковое состояние: PASS.
- SQL подтверждает `per_role_person + роль Участник`: PASS.
- Stage D не начинать до полного Stage C PASS.

После этих правок план можно выполнять.

&nbsp;

План:

## 1. Проблема

Stage C runtime fix остаётся **FAIL/PARTIAL**: в карточке документа «Извещение» выбор режима `per_role_person` с ролью «Участник» показывает toast «Режим генерации сохранён», но UI сразу возвращается на «Один документ».

## 2. Диагностика

Факты по текущему состоянию:

- В БД для item `febd1821-fba8-4290-babf-99c59c27f2f4` сейчас уже сохранено:
  - `generation_mode = 'per_role_person'`
  - `repeat_role_catalog_id = 'c8fc4200-75c0-4c24-8eea-112c4e468aeb'`
- Роль `c8fc4200-75c0-4c24-8eea-112c4e468aeb` = «Участник», `public_id = ln-000015`, активна.
- Trigger `trg_dpti_assert_repeat_role_consistency` есть и корректно требует:
  - для `single`: `repeat_role_catalog_id IS NULL`
  - для `per_role_person`: `repeat_role_catalog_id IS NOT NULL`, роль существует, активна и принадлежит тому же пакету.
- Корневая UI-причина найдена: `DocumentPackageQuestionnairesView.tsx` запрашивает items через query key `['doc-pkg-template-items-q', packageTemplateId]`, но выбирает только `id, sort_order, template_id`. Поля `generation_mode` и `repeat_role_catalog_id` не читаются вообще.
- `PackageDocumentCard` получает item без этих полей, поэтому вычисляет `persistedMode = 'single'` и после render/refetch откатывает UI на «Один документ», даже если БД уже сохранена правильно.
- Shared hook `usePackageItemGenerationMode` инвалидирует `['pkg-bound-templates', packageTemplateId]` и `['document-package-items', packageTemplateId]`, но не инвалидирует фактический query key карточки `['doc-pkg-template-items-q', packageTemplateId]`.
- Есть риск ложного success: mutation сейчас не возвращает обновлённую строку, поэтому UI не подтверждает payload response и не может сделать optimistic cache update по реальному результату.

## 3. Предлагаемое решение

Сделать PATCH-C-STAGE-RUNTIME-SAVE-FIX-V1 точечно, без Stage D и без изменений генератора:

1. Исправить источник данных карточки документа:
  - в `DocumentPackageQuestionnairesView.tsx` добавить в select items поля `generation_mode, repeat_role_catalog_id`;
  - расширить `ItemRow`, чтобы `PackageDocumentCard` получал сохранённое состояние из БД.
2. Исправить invalidation/cache consistency:
  - в `usePackageItemGenerationMode.ts` добавить инвалидирование query key `['doc-pkg-template-items-q', packageTemplateId]`;
  - оставить существующие keys для `TemplateBindingControl` и legacy hooks;
  - при возможности добавить точечный `setQueryData` для `['doc-pkg-template-items-q', packageTemplateId]`, `['pkg-bound-templates', packageTemplateId]`, `['document-package-items', packageTemplateId]`, чтобы UI не мигал старым `single` между success и refetch.
3. Сделать mutation подтверждаемой:
  - заменить `.update(payload).eq('id', itemId)` на `.update(payload).eq('id', itemId).select('id, generation_mode, repeat_role_catalog_id').single()`;
  - success toast показывать только после успешного update response;
  - если trigger отклоняет update, показывать error toast, success не показывать.
4. Убрать возможный локальный откат preview-state:
  - в `PackageDocumentCard` не очищать `previewPerRole` до подтверждённого успеха update;
  - для выбора роли использовать `mutateAsync`/`await`, затем очищать preview только после success;
  - cleanup preview делать также при приходе persisted `per_role_person` из query.
5. Синхронизировать `TemplateBindingControl` с тем же контрактом:
  - wrapper не должен вручную инвалидировать query сразу после `genMode.update`, до подтверждения mutation;
  - выбор роли должен отправлять один payload: `generation_mode='per_role_person'` + `repeat_role_catalog_id='<role_id>'`;
  - очистка `repeat_role_catalog_id` допускается только при явном выборе «Один документ».
6. Обновить proof:
  - `.lovable/proofs/package_repeatable_documents_stage_c_runtime_fix_v1.md` дополнить runtime-save evidence и оставить Stage C как PASS только после проверки DoD.

## 4. Изменяемые компоненты

Файлы:

- `src/components/ai-documents/packages/DocumentPackageQuestionnairesView.tsx`
- `src/components/ai-documents/packages/PackageDocumentCard.tsx`
- `src/components/ai-documents/packages/TemplateBindingControl.tsx`
- `src/hooks/usePackageItemGenerationMode.ts`
- `.lovable/proofs/package_repeatable_documents_stage_c_runtime_fix_v1.md`

Таблицы только читаются/обновляются существующим UI:

- `document_package_template_items`
- `document_package_role_catalog`

DB schema/RPC/edge functions/cron/jobs не меняются.

## 5. Что не будет изменено

- Stage D не начинать.
- `ai-generate-document-package` не менять в этом патче, если сохранение UI-настройки чинится на frontend/cache уровне.
- Не менять trigger `dpti_assert_repeat_role_consistency`, если он подтверждает корректный контракт.
- Не создавать новые таблицы/RPC/edge functions.
- Не делать массовых UPDATE/DELETE.
- Не менять semantics `role_assignment_missing` и генерацию DOCX в рамках этого save-fix патча.

## 6. Dry-run

Перед правкой/во время проверки:

1. SQL before:

```sql
SELECT id, title_override, generation_mode, repeat_role_catalog_id, created_at
FROM document_package_template_items
WHERE id = 'febd1821-fba8-4290-babf-99c59c27f2f4';
```

2. Проверить роли:

```sql
SELECT id, label, public_id, is_active
FROM document_package_role_catalog
WHERE package_template_id = (
  SELECT package_template_id
  FROM document_package_template_items
  WHERE id = 'febd1821-fba8-4290-babf-99c59c27f2f4'
)
ORDER BY sort_order, label;
```

3. Проверить trigger contract:

```sql
SELECT pg_get_functiondef('public.dpti_assert_repeat_role_consistency()'::regprocedure);
```

4. В UI/network проверить payload при выборе роли:
  - item id = `febd1821-fba8-4290-babf-99c59c27f2f4`;
  - `generation_mode = 'per_role_person'`;
  - `repeat_role_catalog_id = ID роли «Участник»`;
  - нет второго payload `single/null` после успешного выбора роли.

## 7. Execute

После утверждения плана:

1. Обновить `DocumentPackageQuestionnairesView.tsx`, чтобы карточка получала `generation_mode` и `repeat_role_catalog_id` из БД.
2. Обновить `usePackageItemGenerationMode.ts`, чтобы mutation возвращала updated row и синхронно обновляла/инвалидировала все реальные query keys.
3. Обновить `PackageDocumentCard.tsx`, чтобы preview-state не сбрасывал выбранный режим до подтверждённого success.
4. Обновить `TemplateBindingControl.tsx`, чтобы он использовал тот же подтверждённый mutation flow без преждевременной инвалидции.
5. Обновить proof-файл с before/after SQL, payload/response, refresh-проверкой и состоянием обеих вкладок.

## 8. STOP-guards

Остановить выполнение и не считать Stage C PASS, если:

- SQL after save не показывает `generation_mode='per_role_person'` для item «Извещение».
- `repeat_role_catalog_id` не равен ID роли «Участник».
- После выбора роли появляется второй update `single/null`.
- Trigger отклоняет update, но UI показывает success.
- После refresh карточка возвращается на «Один документ».
- `TemplateBindingControl` показывает состояние, отличное от карточки документа.
- Найдётся другой writer, который перетирает `document_package_template_items` после save.

## 9. DoD

PATCH-C-STAGE-RUNTIME-SAVE-FIX-V1 считается выполненным только если:

- Выбор `per_role_person` не откатывается на `single`.
- `repeat_role_catalog_id` сохраняется корректно.
- Toast success показывается только после реального успешного update.
- После refresh страницы режим остаётся `per_role_person`.
- Карточка документа и вкладка «Шаблоны пакета» показывают одинаковое состояние.
- SQL подтверждает `generation_mode='per_role_person'` и роль «Участник».
- Proof обновлён: `.lovable/proofs/package_repeatable_documents_stage_c_runtime_fix_v1.md`.

## 10. Риски и зависимости

- Основной риск — разные query keys для одного SOT. Решение: добавить единый update/invalidate всех реально используемых keys.
- Возможен race между local preview-state и refetch старой строки. Решение: mutation response + `setQueryData` до invalidation.
- В текущей БД уже сохранено корректное значение; баг проявляется как UI/cache/read-model desync, а не обязательно как DB-write failure.

## 11. Требуется дополнительная информация

Дополнительная информация от пользователя не требуется. Можно выполнять патч после утверждения плана.
Ответ для Lovable:

да, согласен, с учетом правок:

1. План можно выполнять. Это правильный финальный runtime-прогон Stage C, без перехода к Stage D.
2. В Diagnose обязательно добавить проверку, что режим `per_role_person` виден и сохранён именно в UI карточки документа «Извещение» на вкладке «Анкеты документов», а не только SQL.
  &nbsp;
  Proof должен содержать:
  - скрин карточки «Извещение»;
  - выбран режим `Отдельный документ для каждого физлица с ролью`;
  - роль-источник = `Участник`.
3. В SQL по assignments нужно явно разделить роли:
  &nbsp;
  &nbsp;
  - repeat-role:  
  `ln-000015 = Участник` → 3 активных назначения;
  - обычная обязательная роль шаблона:  
  `ln-000014 = Ревизор` → минимум 1 активное назначение.
  Если Ревизор не назначен — STOP, не запускать генерацию и не считать это ошибкой Stage C mechanics.
4. Dry-run должен показать не просто «3 строки для item Извещение», а структуру по каждому recipient:
  - assignment_id;
  - person_id;
  - recipient_display_name;
  - recipient_index;
  - generation_mode = `per_role_person`.
5. В реальной генерации проверять не только `template_id`, а именно связку:
  - `source_package_template_item_id = febd1821-fba8-4290-babf-99c59c27f2f4`;
  - `generation_mode = per_role_person`;
  - `repeat_role_catalog_id = роль Участник`;
  - разные `repeat_assignment_id`;
  - разные `recipient_person_id`.
6. В SQL after не использовать только `meta.recipient.person_id`, если фактическая структура meta хранит recipient иначе. Проверять все реально записанные поля:
  - `meta->>'generation_mode'`;
  - `meta->>'repeat_role_catalog_id'`;
  - `meta->>'repeat_assignment_id'`;
  - `meta->>'recipient_person_id'`;
  - `meta->>'recipient_display_name'`;
  - `meta->>'recipient_index'`;
  - при наличии `recipient_snapshot` — показать его отдельно.
7. Проверка DOCX должна быть не только на одном файле. Минимум:
  - открыть один файл полностью и показать excerpt `document.xml`;
  - дополнительно по всем 3 извещениям проверить, что `recipient_display_name` в meta соответствует имени в DOCX либо в generated snapshot.
  Нельзя закрывать PASS, если все 3 файла имеют одинакового recipient.
8. Обязательно проверить отсутствие cross-recipient contamination:
  - извещение Петрова содержит Петрова и не содержит Иванова/Федорчука как recipient;
  - извещение Иванова содержит Иванова и не содержит Петрова/Федорчука как recipient;
  - извещение Федорчука содержит Федорчука и не содержит Петрова/Иванова как recipient.
  Ревизор может повторяться во всех документах — это нормально, потому что это отдельная роль `ln-000014`, а не recipient.
9. Проверить, что `ln-000014` действительно подставлен как Ревизор во всех трёх извещениях, если токен остаётся в шаблоне.
  &nbsp;
  Это отдельная проверка от `recipient.*`.
10. Проверить, что single-документы не получили recipient meta:

&nbsp;

- Инструкция;
- Приказ.

Для них должно остаться:

- 1 документ на item;
- старый idempotency key без `:assn:`;
- отсутствие `repeat_assignment_id`, `recipient_person_id`, `recipient_display_name`, `recipient_index`.

11. В proof добавить batch-level summary:

```json
{
  "total_items": 3,
  "total_documents": 5,
  "generated": 5,
  "errors": 0,
  "blocked": 0
}
```

Если фактическое количество items отличается — указать реальное, но принцип тот же: `total_items` = позиции шаблона, `total_documents` = фактически созданные документы.

12. Если в response/dry-run/SQL остаётся любая `role_assignment_missing:*`, Stage C не закрывать.
13. Если генерация создаёт только 1 «Извещение», Stage C не закрывать.
14. Если генерация создаёт 3 записи в БД, но UI в «Результате последнего запуска» показывает их как один документ или скрывает часть результатов, Stage C mechanics можно считать backend PASS, но UI-группировку результатов вынести в Stage D. В proof это нужно явно разделить:

- backend generation PASS;
- UI grouping deferred to Stage D.

15. После успешного прогона обновить статус:

```text
Stage C — PASS
Stage D — NOT STARTED
```

Stage D не начинать в этом же выполнении.

Итоговый DoD Stage C business runtime:

- UI показывает `per_role_person + Участник` в карточке «Извещение»: PASS.
- SQL подтверждает `generation_mode='per_role_person'` и `repeat_role_catalog_id=Участник`: PASS.
- 3 активных назначения Участника и минимум 1 назначение Ревизора подтверждены: PASS.
- Dry-run показывает 3 recipient-плана для «Извещения»: PASS.
- Реальная генерация создаёт 3 отдельных извещения: PASS.
- У всех 3 разные `repeat_assignment_id`, `recipient_person_id`, `recipient_display_name`, `recipient_index`: PASS.
- `recipient.*` подставлен в DOCX: PASS.
- `ln-000014` Ревизор подставлен и не блокирует генерацию: PASS.
- Нет cross-recipient contamination: PASS.
- Single-документы работают без recipient meta: PASS.
- Proof обновлён:  
`.lovable/proofs/package_repeatable_documents_stage_c_runtime_fix_v1.md`
- &nbsp;
- План: Stage C business runtime — финальный прогон и proof

## Цель

Закрыть Stage C — PASS: подтвердить, что в режиме per_role_person по роли «Участник» в пакете из примера фактически генерируются 3 отдельных «Извещения», recipient.* подставляется, ln-000014 (Ревизор) больше не блокирует генерацию (роль Ревизор назначена пользователем).

## Шаги

1. **Diagnose (read-only, до генерации)**
  - SQL: подтвердить состояние item `febd1821-fba8-4290-babf-99c59c27f2f4`
    - `generation_mode='per_role_person'`, `repeat_role_catalog_id=c8fc4200-... (Участник)`
    - `document_package_item_role_assignments`: 3 назначения с role_catalog_id Участника + минимум 1 назначение с role_catalog_id `40b6dd45-...` (Ревизор)
  - SQL: подтвердить `template_path` шаблона «Извещение» и наличие токенов `{{ln-000014}}`, `{{ln-000015}}`/`{{recipient.full_name}}` (через unpacked DOCX).
  - Если Ревизор по факту не назначен в БД — STOP, попросить пользователя подтвердить назначение в UI.
2. **Dry-run генерации пакета**
  - Вызвать `ai-generate-document-package` с `dry_run=true` для текущей session.
  - DoD dry-run:
    - В плане появляется 3 строки для item «Извещение» (per-recipient breakdown).
    - Нет ошибок `role_assignment_missing:ln-000014` и `role_assignment_missing:ln-000015`.
    - LN-token pre-scan для repeat-role обходится корректно (как в PATCH-C-STAGE-C v1).
  - Если хоть одна ошибка — фиксируем код, причину, останавливаемся.
3. **Реальная генерация**
  - Вызвать `ai-generate-document-package` без dry_run.
  - DoD:
    - В `ai_generated_documents` появляется 3 новых записи по template_id «Извещение» с разными `meta.recipient.person_id`.
    - У каждого документа `meta.generation_mode='per_role_person'`, `meta.repeat_role_catalog_id=Участник`, `meta.recipient.full_name` = ФИО трёх участников (Петров, Иванов, Федорчук).
    - `status` всех трёх = успешный (готов к скачиванию).
    - Остальные single-документы пакета сгенерированы как раньше — 1 экземпляр на item.
4. **Проверка содержимого DOCX (минимум 1 файл)**
  - Скачать один из трёх «Извещений» из storage, распаковать `word/document.xml`, убедиться что `{{recipient.full_name}}` (или соответствующий разрешённый токен) реально заменён на ФИО конкретного участника, а `{{ln-000014}}` заменён на назначенного Ревизора.
5. **Proof + статус**
  - Дополнить `.lovable/proofs/package_repeatable_documents_stage_c_runtime_fix_v1.md` секцией «Stage C business runtime — PASS»:
    - SQL before (item + assignments)
    - dry-run plan output (3 строки)
    - SQL after (3 ai_generated_documents с meta)
    - Excerpt из document.xml одного DOCX
  - Обновить `.lovable/plan.md`: Stage C — PASS (полностью). Stage D остаётся NOT STARTED.

## Что НЕ делаем

- Не трогаем DOCX-шаблон (по решению пользователя — Ревизор назначен, токен ln-000014 остаётся).
- Не меняем код save/cache flow (PATCH-C-STAGE-RUNTIME-SAVE-FIX-V1 уже PASS).
- Не запускаем Stage D.
- Не делаем миграций БД.

## Stop-guards

- 3 «Извещений» не создано → FAIL, диагностируем resolver per-role.
- meta.recipient.* пустой или одинаковый для всех 3 копий → FAIL.
- В DOCX остались литералы `{{recipient.full_name}}` или `{{ln-000014}}` → FAIL, проблема в token-резолвере.
- Любая ошибка `role_assignment_missing:*` в response → FAIL, не считаем Stage C закрытым.

## DoD Stage C (полный)

- Code-level PASS
- UI save/cache PASS (PATCH-C-STAGE-RUNTIME-SAVE-FIX-V1)
- Business runtime PASS — закрывается этим планом: 3 «Извещения» сгенерированы, recipient.* подставлен, Ревизор подставлен, proof обновлён.
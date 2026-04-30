да, согласен, с учетом правок:

1. **В шаге 4 исправить SQL.**  
Если access_mode — отдельная колонка, обновлять нужно колонку, а не conditions:  
UPDATE access_rules
2. SET access_mode = 'full',
3.     updated_at = now()
4. WHERE id = '417e5071-d2e0-43ed-9bed-91696ea108ec';  
Если в этой таблице access_mode хранится внутри conditions, тогда сначала подтвердить schema-proof.
5. **Ledger для data-fix обязателен.**  
Перед/после:
  - rule_id;
  - old_access_mode;
  - new_access_mode;
  - target_ref;
  - reason='business_tariff_should_receive_all_new_training_modules'.
6. **Backfill auto_include_new_modules=false только для partial.**  
Не трогать full.
7. **Триггер должен быть no-op, если allowed_module_ids отсутствует.**  
В этом случае сначала создать пустой массив и добавить [NEW.id](http://NEW.id).
8. **UI-кнопка “Перевести в full” — с подтверждением.**  
Текст: “После перевода в full пользователи этого правила увидят все текущие и будущие папки тренинга.”

Можно выполнять.

&nbsp;

План: Авто-видимость новых папок тренинга через корректное использование full/partial

## Диагноз (доказан в БД)

Тренинг «База знаний» (TRN-000001, root=`8b1fb03e…`) имеет 5 активных `training_content` правил:


| product / тариф                               | mode        | allowed_module_ids             | вердикт                                    |
| --------------------------------------------- | ----------- | ------------------------------ | ------------------------------------------ |
| CB20 / БАЗА (b276d8a5)                        | partial     | 2 (Видеоответы + Итоги месяца) | partial корректно — это ограниченный тариф |
| CB20 / БИЗНЕС (7c748940)                      | **full**    | —                              | корректно, новые папки уже видны           |
| Горбуша Club / BUSINESS (f9e53860, no tariff) | **partial** | 1 модуль                       | **БАГ**: бизнес-тариф должен быть `full`   |
| Бухгалтер 1.0 (84055f12)                      | partial     | 1 модуль                       | корректно (бонусный standalone)            |
| Закрытие года (b868013a)                      | partial     | 1 модуль                       | корректно (бонусный standalone)            |


Корень проблемы из скриншота: пользователь с тарифом BUSINESS (Горбуша Club) не видит новые папки «Идеологическая работа в бизнесе», «Вебинары», «Квесты» и т.д. — потому что правило ошибочно `partial` со статичным списком из 1 модуля. По бизнес-логике BUSINESS = всё, значит должно быть `full`.

## Ключевые принципы (зафиксированы)

1. `**full` — единственный механизм авто-видимости новых папок.** Если тариф должен автоматически получать все будущие модули — это `mode='full'`, не `partial` с авто-расширением списка.
2. `**partial` означает строго выбранный список.** Новые папки сюда не добавляются автоматически.
3. **Авто-расширение partial — только под явным флагом** `conditions.auto_include_new_modules=true` (default `false`). Это редкий, опциональный кейс (например: «эта когорта получает все будущие подмодули папки X, кроме архивных» — но даже тогда лучше `full` на уровне родителя).
4. **Read-path не трогаем.** `useTrainingContentRules.resolveTrainingContentFilter` уже корректно интерпретирует `full`/`partial`. Меняется только write/config-path и одно конкретное данные-правило.

## Шаги (Diagnose → Plan → Dry-run → Execute → Verify)

### Шаг 1. Dry-run классификация всех `training_content` правил

Read-only SQL-отчёт по всем активным правилам со статусом `partial`:

- product/tariff name + текущий `allowed_modules_count`;
- сколько активных дочерних модулей сейчас в target тренинге;
- ручная классификация админом по 3 корзинам:
  - **A. → перевести в `full**`: тариф по бизнес-логике даёт «весь тренинг» (BUSINESS Горбуша Club — кандидат №1).
  - **B. оставить `partial` без авто-расширения**: ограниченные тарифы (CB20/БАЗА), бонусные standalone (Бухгалтер 1.0, Закрытие года).
  - **C. оставить `partial` + поставить `auto_include_new_modules=true**`: только если админ явно подтвердит для конкретного правила. По умолчанию никого в эту корзину.

Артефакт: `.lovable/proofs/training_content_partial_audit.md` со списком правил и предлагаемой классификацией. **Execute только после явного approve пользователем**.

### Шаг 2. Миграция схемы (минимальная)

Никаких новых колонок. Используем только `conditions JSONB`:

- ввести опциональный ключ `conditions.auto_include_new_modules: boolean` (default `false` при отсутствии);
- backfill: для всех существующих `partial`-правил выставить явное `auto_include_new_modules=false` (no surprise, нет неоднозначности `undefined`).

### Шаг 3. Триггер БД `tg_training_module_propagate_to_partial_rules`

`AFTER INSERT ON training_modules` — срабатывает только при создании дочернего модуля (`NEW.parent_module_id IS NOT NULL`).

Жёсткие условия применения (все обязательны):

1. `access_rules.grant_target_type = 'training_content'`
2. `access_rules.is_active = true`
3. `access_rules.target_ref = NEW.parent_module_id` (root этого модуля)
4. `conditions->>'access_mode' = 'partial'`
5. `(conditions->>'auto_include_new_modules')::boolean = true`

При совпадении — добавляет `NEW.id` в `conditions.allowed_module_ids` и пишет запись в `access_grant_ledger`:

- `outcome = 'auto_propagated_new_module'`
- before/after snapshot
- `actor = 'system_trigger'`

Для `mode='full'` — триггер НЕ нужен (full видит всё нативно через read-path).
Для `partial + auto_include_new_modules=false` — триггер НЕ срабатывает (по дизайну).

### Шаг 4. Точечный execute по корзине A

После approve пользователем dry-run:

- правило `417e5071…` (BUSINESS Горбуша Club): `UPDATE access_rules SET conditions = jsonb_set(conditions, '{access_mode}', '"full"') WHERE id = '417e5071-d2e0-43ed-9bed-91696ea108ec'`;
- запись в `access_grant_ledger` с before/after.
- НЕ трогаем `allowed_module_ids` — read-path в режиме `full` его игнорирует.

### Шаг 5. UI-патч `ProductAccessRulesTab` (минимальный)

Для каждого правила `training_content`:

- если `mode='partial'` — показать чек-бокс «Автоматически добавлять новые папки тренинга» (привязан к `conditions.auto_include_new_modules`, по умолчанию выкл);
- если `mode='partial'` и есть «осиротевшие» новые папки (созданы после `updated_at` правила и не входят в `allowed_module_ids`) — показать ненавязчивый алерт «Новые папки не включены: …» с двумя кнопками: «Добавить выбранные» (открывает tree-picker) и «Перевести в full» (переключает режим). **Никаких авто-действий без подтверждения**.

### Шаг 6. Verify

- SQL-proof: BUSINESS Горбуша Club правило теперь `mode='full'`; пользователь с активной подпиской видит «Идеологическая работа в бизнесе» (новую папку) без правок `allowed_module_ids`.
- SQL-proof: CB20/БАЗА правило осталось `partial` с прежними 2 модулями, новые папки туда не попали (как и должно быть).
- Smoke: создать тестовую папку под `8b1fb03e…` → убедиться, что триггер не сработал (т.к. ни одно правило не имеет `auto_include_new_modules=true`); запись в `access_grant_ledger` отсутствует.
- Visual: `/library/<новый-slug>` виден у BUSINESS, не виден у БАЗА.

## DoD

- BUSINESS Горбуша Club правило переведено в `mode='full'` после approve dry-run; новые папки в «Базе знаний» автоматически видны этой когорте без ручных правок `allowed_module_ids`.
- Все существующие `partial`-правила имеют явный `conditions.auto_include_new_modules=false`.
- Триггер `tg_training_module_propagate_to_partial_rules` создан и срабатывает строго по 5 условиям; для `full` и `partial+false` — no-op.
- Read-path `useTrainingContentRules` НЕ изменён.
- В админке `ProductAccessRulesTab` для `partial` правил доступен чек-бокс `auto_include_new_modules` и алерт об осиротевших папках с двумя действиями: «Добавить выбранные» / «Перевести в full».
- Артефакты: `.lovable/proofs/training_content_partial_audit.md` (dry-run) + `.lovable/proofs/training_content_business_full_fix.md` (execute + verify).

## Технические артефакты

- Миграция: `supabase/migrations/<ts>_training_content_auto_include_trigger.sql` — функция + триггер + backfill `auto_include_new_modules=false` для существующих `partial`.
- Точечный data-fix (через insert-tool): `UPDATE access_rules` для правила `417e5071…` (после approve).
- Patch UI: `src/components/admin/product/ProductAccessRulesTab.tsx` (чек-бокс + алерт-блок).
- Read-path: **без изменений**.
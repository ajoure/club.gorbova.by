## да, согласен, с учетом правок:

&nbsp;

1. В шаге 1 по UI-proof зафиксируй не только скрин, но и **точные идентификаторы пользователя/контакта** в proof-артефакте: user_id, profile_id, email/имя. Иначе потом нельзя будет доказуемо связать скрин с SQL-выборкой.
2. Для Фазы В добавь отдельный **proof по badge**:
  &nbsp;
  - число на вкладке «Доступы»
  - количество строк в основном списке
  - количество строк после включения toggle «Показать завершённые»
  - SQL-ожидание по этому же user_id
    DoD: badge = active_list_count = SQL valid count, а toggle_list_count = SQL historical count.
  &nbsp;
3. В SQL для UI-proof используй **тот же strict predicate, что в коде**, включая все 5 условий:
  &nbsp;
  - status IN ('active','trial')
  - access_end_at IS NULL OR access_end_at > now()
  - product_id есть в access_[rules.is](http://rules.is)_active = true
  - products_[v2.is](http://v2.is)_active != false
  - [tariffs.is](http://tariffs.is)_active != false
    Сейчас в описании местами упомянут только product rule и срок. Нужно явно зафиксировать полное совпадение с predicate.
  &nbsp;
4. Для тестового пользователя 6ae5cc6e... добавь в proof отдельную таблицу:
  &nbsp;
  - total_subscriptions
  - valid_by_predicate
  - historical_by_predicate
  - tech_active_without_ground
    Чтобы не смешивать «исторические» и «технически активные без основания».
  &nbsp;
5. По Фазе Г в preview-proof добавь **JSON-слепок входных параметров** для каждой из 3 тестовых сделок:
  &nbsp;
  - order_id
  - user_id
  - product_id
  - status
  - current access_end_at
  - products_[v2.is](http://v2.is)_active
  - [tariffs.is](http://tariffs.is)_active
  - has_active_rule
    И рядом — ожидаемый reasonCode. Иначе будет только визуальное описание без доказуемой входной базы.
  &nbsp;
6. Для сценария execute по валидной сделке зафиксируй **before/after** минимум по 4 полям:
  &nbsp;
  - subscription_id
  - old_access_end_at
  - new_access_end_at
  - delta_days
    И отдельно укажи, что изменение произошло **не в обход**, а через grant-access-for-order.
  &nbsp;
7. В runtime-proof не ограничивайся формулировкой «edge function вызван». Нужен proof одного из двух типов:
  &nbsp;
  - запись в edge logs с orderId
  - или изменение данных + отсутствие прямого update в компоненте + совпадение с preview target
    Это нужно явно прописать как допустимый DoD.
  &nbsp;
8. Для кейса «нет active rule» добавь в proof явный SQL:
  &nbsp;
  - product_id
  - product_name
  - COUNT(*) FROM access_rules WHERE product_id = ... AND is_active = true
    DoD: count = 0. Это уберёт спор о причине блокировки.
  &nbsp;
9. Для кейса «историческая покупка» зафиксируй, что блокировка произошла именно из-за **непрохождения predicate**, а не из-за другого guard. Нужен breakdown:
  &nbsp;
  - status
  - expired / not expired
  - has_active_rule / no
  - product_active / tariff_active
  - итоговый reasonCode
  &nbsp;
10. В шаге 9 добавь новый add-only артефакт:

&nbsp;

&nbsp;

&nbsp;

- 14_proof_single_user_ui_breakdown.csv
  с одной строкой по тестовому пользователю из Фазы В.
  И ещё:
- 15_proof_bulk_extend_cases.csv
  с тремя тестовыми сделками из Фазы Г и их фактическим outcome.

&nbsp;

&nbsp;

&nbsp;

11. В .lovable/[plan.md](http://plan.md) статус Фаз В и Г переводить в «закрыта» **только после** появления:

&nbsp;

&nbsp;

&nbsp;

- реального UI-proof
- реального preview-proof
- real before/after execute-proof
  До этого статус должен быть: «код готов, proof в процессе».

&nbsp;

&nbsp;

&nbsp;

12. Явно зафиксируй в плане, что **код не меняется по умолчанию**. Если в proof обнаружится расхождение между SQL и UI, это оформляется не как тихая правка, а как отдельный PATCH с причиной расхождения и новым DoD.

&nbsp;

&nbsp;

План: Финальный UI/Runtime proof для закрытия Фаз В и Г

### Текущий статус (подтверждено)


| Артефакт                                          | Статус                             |
| ------------------------------------------------- | ---------------------------------- |
| Единый predicate в `useAccessValidation.ts`       | Код подтверждён, 5 условий         |
| Подключение в 3 компонентах                       | Код подтверждён (imports + вызовы) |
| Query joins (products_v2, tariffs)                | Код подтверждён во всех 3 файлах   |
| Прямой update убран                               | Код подтверждён                    |
| SQL counts: 322 valid / 540 hist / 10 tech-active | SQL подтверждено сейчас            |



| Фаза | Статус                        |
| ---- | ----------------------------- |
| А v3 | Закрыта                       |
| В    | Код готов, ждёт UI-proof      |
| Г    | Код готов, ждёт runtime-proof |
| Б    | Заблокирована                 |


### Что нужно сделать

#### 1. UI-proof Фазы В: проверка вкладки «Доступы» в браузере

**Тестовый пользователь:** `6ae5cc6e-81f5-4920-bdf6-805eb700de12`

- По SQL: 12 подписок, 4 проходят predicate, 8 исторических
- Есть и active, и expired, и canceled, и past_due записи

**Действия:**

1. Открыть ContactDetailSheet для этого контакта в браузере
2. Зафиксировать screenshot: основной список показывает 4 записи
3. Нажать toggle «Показать завершённые» → зафиксировать 8 записей
4. Проверить badge на вкладке: должен показывать 4

**Второй тест:** UserSubscriptions — если текущий залогиненный пользователь имеет подписки, проверить аналогично.

**Артефакт:** `08_proof_ui_vs_csv.csv` с реальными данными:

- источник: ContactDetailSheet
- ожидалось_по_predicate: 4
- фактически_в_ui: (из screenshot)
- расхождение: 0 или N
- статус: совпадает / расхождение

#### 2. Runtime-proof Фазы Г: preview + execute через BulkExtendAccessDialog

**3 тестовых сделки (найдены в БД):**


| Сценарий                             | order_id                               | Продукт                | Ожидание                            |
| ------------------------------------ | -------------------------------------- | ---------------------- | ----------------------------------- |
| Валидная (active sub + active rule)  | `2109028f-6764-48c9-a6d1-feb70c4d8c60` | Бухгалтерия как бизнес | применить                           |
| Нет active rule                      | `f8f17976-dc8c-46eb-9933-272baedb24c5` | Подоходный налог ИП    | заблокировано: нет_правила_доступа  |
| Историческая (canceled sub, expired) | `4cadb9ab-b8c8-4bfb-8efc-7c02662c6b59` | Gorbova Club           | заблокировано: нет_текущего_доступа |


**Действия:**

1. Открыть таблицу сделок, выбрать эти 3 сделки
2. Нажать «Продлить доступ», указать 30 дней
3. Screenshot preview: проверить действие и причину по каждой строке
4. Для валидной сделки — execute
5. Проверить edge function logs: `grant-access-for-order` вызван
6. SQL before/after: срок `access_end_at` изменился

**Артефакты:**

- `12_proof_runtime_preview_execute.csv` — реальные данные из preview/execute
- `13_proof_predicate_conditions.csv` — подтверждение 5 условий predicate

#### 3. Discrepancy report

Между шагами 1 и 2 сформировать краткий отчёт:

- Валидных в CSV: 322
- Показывает UI для тестового юзера: ожидается 4, факт — из browser
- Preview блокирует/разрешает: по 3 тестовым сделкам

#### 4. Обновить plan.md

Финальные статусы:

- Фаза А v3: закрыта (batch `20260405_160530_4e1f607b`)
- Фаза В: закрыта (UI-proof подтверждён)
- Фаза Г: закрыта (runtime-proof подтверждён)
- Фаза Б: заблокирована

### Последовательность выполнения

```text
1. Browser → ContactDetailSheet для user 6ae5cc6e → screenshot + count
2. Browser → toggle «Показать завершённые» → screenshot + count  
3. Discrepancy report (CSV count vs UI count)
4. Browser → таблица сделок → выбрать 3 сделки → preview
5. Screenshot preview → проверить 3 строки
6. Execute 1 валидной сделки
7. Edge function logs → proof вызова
8. SQL → before/after access_end_at
9. Сформировать proof CSV (add-only)
10. Обновить plan.md
```

### Файлы

**Новые артефакты (add-only):**

- `08_proof_ui_vs_csv.csv` — реальные UI counts
- `12_proof_runtime_preview_execute.csv` — реальные preview/execute результаты
- `13_proof_predicate_conditions.csv` — подтверждение 5 условий

**Изменение:**

- `.lovable/plan.md` — обновление статусов

**Код не меняется** — если в ходе proof не обнаружено расхождений.

### Технические детали

Для UI-proof используется browser tool:

- `navigate_to_sandbox` → admin → контакты → карточка контакта
- `observe` + `screenshot` для фиксации count
- `extract` для получения точных чисел из DOM

Для runtime-proof:

- Browser: preview в BulkExtendAccessDialog
- `supabase--edge_function_logs` для подтверждения вызова
- `supabase--read_query` для before/after сравнения
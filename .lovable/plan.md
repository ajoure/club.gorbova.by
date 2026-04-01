да, согласен, с учетом правок:

&nbsp;

1. Для BUSINESS → ЦБ не хардкодить в blueprint конкретные UUID/названия как источник истины.  
В blueprint оставить только структуру кейса, а реальные:  

  - rule id
  - product_id
  - tariff_id
  - product_name
  - target_product_ids
  - duration_days
2.   
тянуть live из БД при генерации документа.  
Иначе документ станет зависимым от текущего окружения и сломается при замене rule / продукта / тарифа.
3. Для блока «Изменения за 24 часа» добавить не только auditActionPrefixes, но и:  

  - excludeAuditPrefixes
  - maxItems
  - aggregateRepeated = true
4.   
Иначе по одному prefix всё равно можно получить шум.  
Для trainings_access явно исключить:  

  - cron.job.triggered
  - bepaid.erip.reconcile_batch
  - общие sync/job-события, не относящиеся к доступам/тренингам.
5. &nbsp;
6. В trainings_access помимо narrative обязательно добавить отдельный factual snapshot по правилам:  

  - active training_content
  - active product_access
  - active club
  - active email
7.   
Не общим count, а раздельно по grant_target_type.  
Это важно, потому что сейчас именно смешение типов правил скрывает реальную картину.
8. В секции active rules добавить ещё:  

  - grant_target_type
  - product_id short
  - tariff_id short
  - is_active
  - created_at
9.   
А для conditions не только narrative, но и raw доказуемые поля:  

  - condition_type
  - rule_purpose
  - match_mode
  - target_product_ids
  - required_product_ids
10.   
То есть документ должен показывать и интерпретацию, и фактический source row.
11. Для кейса BUSINESS → ЦБ нужен не только текстовый flow, но и live proof-блок:  

  - сколько active/past_due BUSINESS subscriptions
  - сколько profile_id из них имеют historical paid order по ЦБ
  - сколько уже имеют active entitlement по ЦБ
  - сколько ещё не имеют entitlement и требуют retroactive batch
12.   
Это должен быть отдельный subsection вида:  

  - subscriptions_total
  - historical_purchase_matches
  - already_granted
  - needs_batch_grant
13. &nbsp;
14. Для раздела Исторические сделки добавить жёсткое разграничение:  

  - что считается historical purchase proof
  - что считается grant source
  - что считается target entitlement
15.   
И отдельно указать:  

  - historical order сам по себе не равен действующему доступу
  - доступ появляется только через rule/grant pipeline
  - pending proof: как именно считается срок при duration_days = NULL
16. &nbsp;
17. В trainings_access добавить отдельный блок «Проблемные тренинги / расхождения UI vs DB» с dry-run списком:  

  - root_module_id
  - title
  - direct_lessons_count
  - descendant_lessons_count
  - active_descendant_lessons_count
  - has_training_content_rule
  - suspected_ui_bug
18.   
Это нужно, чтобы баг 0 уроков был не абстрактным текстом, а конкретным реестром.
19. Для live snapshot по тренингам считать не только общее количество уроков, но раздельно:  

  - lessons_total
  - lessons_active
  - lessons_inactive
  - root_modules_total
  - child_modules_total
  - root_modules_with_zero_direct_lessons
  - root_modules_with_descendant_lessons
20.   
И отдельно выводить top-N таких root-модулей.
21. В open_tails нужно добавить не только known issues, но и доказуемые pending-proof items с источником:  

  - proof_type
  - domain
  - status
  - evidence_source
  - next_required_action
22.   
Иначе раздел остаётся слишком текстовым и неуправляемым.
23. Для platform_master в секции «Как использовать как входной артефакт» добавить ещё:

&nbsp;

&nbsp;

&nbsp;

- что копировать по умолчанию: platform_master AUTO-CURRENT
- когда дополнительно прикладывать доменный документ
- когда обязательно прикладывать open_tails
- что manual POINT A/B/C — это история, а не текущий SoT

&nbsp;

&nbsp;

&nbsp;

11. В EF добавить отдельную секцию «Границы доказанности» не только для trainings_access, но и для любого домена, где есть:

&nbsp;

&nbsp;

&nbsp;

- FK-confirmed facts
- live-query facts
- inferred narrative
- pending proof

&nbsp;

&nbsp;

Формат единый:

&nbsp;

- Подтверждено
- Выведено из текущих данных
- Требует proof
- Известные расхождения

&nbsp;

&nbsp;

&nbsp;

12. Для seed/repair добавить guard:  
если manual doc уже содержит реальный контент и не scaffold, но короче AUTO-CURRENT, не считать его автоматически устаревшим и не repair’ить.  
Repair только для явных placeholder/scaffold, как ты уже указал.
13. В proof после деплоя добавить ещё два обязательных SQL proof:

&nbsp;

&nbsp;

&nbsp;

- список active product_access rules с полями condition_type, rule_purpose, match_mode
- dry-run список BUSINESS пользователей, которым должен быть выдан/продлён ЦБ по historical purchase, но у кого ещё нет active entitlement

&nbsp;

&nbsp;

&nbsp;

14. Отдельный guard по narrative:

&nbsp;

&nbsp;

&nbsp;

- не писать, что site_domain_bindings связаны с продуктом напрямую
- не писать, что duration_days = NULL уже корректно работает
- не писать, что BUSINESS → ЦБ уже полностью работает глобально, пока нет batch/proof

&nbsp;

&nbsp;

&nbsp;

15. Фронтенд действительно можно не трогать в этом патче, кроме одного исключения:  
если после генерации длинного trainings_access / platform_master UI начнёт подвисать или ломать copy/download, тогда нужен отдельный follow-up patch только на viewer-performance. В текущий scope это не включать, но зафиксировать как возможный follow-up.

&nbsp;

&nbsp;

Итог: сам каркас плана правильный. Главное — убрать любые env-specific hardcodes из blueprint, добавить factual live-proof блоки по BUSINESS → ЦБ и historical deals, и сделать доменную фильтрацию изменений действительно строгой, а не только по одному include-prefix.

&nbsp;

# План: Улучшение генератора документации — доменная фильтрация, бизнес-логика, proof-границы

---

## Диагностика текущего состояния

### Проблема 1: «Изменения за 24 часа» тащит весь audit_logs без фильтрации

Строки 258-270 EF: `changesSummary` собирает 100 последних audit_logs без доменной фильтрации. Этот же `changesSummary` передаётся в каждый `buildDomainDocument()`. Результат: в trainings_access появляются bepaid.erip.reconcile_batch, cron.job.triggered и прочий шум.

### Проблема 2: liveTrainingsAccess (строки 1009-1051) — только counts + список модулей

Нет: root vs child breakdown, active lesson stats, active rules listing, проблемных тренингов с 0 уроков.

### Проблема 3: Blueprint trainings_access (строки 152-194) — слишком общий

Нет flows для: BUSINESS → ЦБ, historical deals, prior_purchase конкретных кейсов.

### Проблема 4: open_tails (строки 1201-1267) — Source 2 не фильтрует по домену

`pendingAudits` берёт 50 последних pending/failed/deferred из audit_logs без доменного фильтра.

### Реальные данные (discovery)

- access_rules: нет колонки `rule_type` — есть `grant_target_type`, `conditions->>'condition_type'`, `conditions->>'rule_purpose'`
- Active rules: 7 штук (1 club, 3 product_access, 3 training_content)
- BUSINESS tariff: `7c748940` для Gorbova Club → prior_purchase rule `1b497fba` с 9 target_product_ids
- Root modules: 16, child: 64, lessons: 390, active lessons: 186
- «Ценный бухгалтер | 1 ступень 2.0» (root `c9f7e9b8`): 0 direct lessons, но 28+ allowed_module_ids в training_content rules → уроки в child-модулях
- duration_days = NULL для **всех** active rules

---

## Файлы и патчи

### 1. `supabase/functions/_shared/system_docs_blueprint.ts`

**1a. Доменные фильтры audit_logs** — добавить в DomainBlueprint:

```ts
auditActionPrefixes: string[]; // для фильтрации "Изменений за 24 часа"
```

Заполнение:

- platform_master: `['system_docs.', 'cron.']`
- products_sales: `['admin.grant_access', 'corrective_batch', 'bulk_grant', 'entitlement']`
- trainings_access: `['entitlement', 'subscription.', 'admin.subscription.', 'bulk_grant', 'corrective_batch', 'access.', 'bepaid.sync.access_chain', 'bepaid.sync.entitlement']`
- orders_payments: `['bepaid.', 'admin.create_deal', 'admin.link_payment', 'admin.payment_link']`
- sites_pages_forms: `['site.', 'form.']`
- integrations: `['telegram.', 'bepaid.', 'broadcast.', 'amocrm.']`
- open_tails: `[]` (показывать все pending/failed/deferred)

**1b. trainings_access blueprint расширить** — добавить flows:

- Flow «BUSINESS → Ценный бухгалтер (prior_purchase)»:
  1. Клиент покупает/продлевает подписку Gorbova Club BUSINESS (tariff 7c748940)
  2. grant-access-for-order проверяет access_rules для product 11c9f1b8 + tariff BUSINESS
  3. Rule 1b497fba: grant_target_type=product_access, condition_type=prior_purchase, match_mode=per_product
  4. Для каждого target_product_id проверяется: есть ли paid order в orders_v2 для этого profile_id+product_id
  5. Если да → entitlement создаётся/продлевается; если нет → skipped_by_condition
  6. duration_days=NULL → **ПРОБЛЕМА: требует ручного определения срока** (не подтверждено)
- Flow «Historical deals → entitlement sync»:
  1. Исторические paid orders определяются по orders_v2 (status=paid, product_id)
  2. Факт покупки = наличие paid order для данного product_id + profile_id
  3. Связь historical order → entitlement: через product_id FK
  4. **ПРОБЛЕМА**: duration_days=NULL → как определяется expires_at? Pending proof.

**1c. knownIssues trainings_access расширить**:

- `'duration_days=NULL для всех active rules — неизвестно как определяется срок доступа'`
- `'Root-модуль "Ценный бухгалтер | 1 ступень 2.0" показывает 0 direct lessons — уроки в child-модулях, но UI может показывать 0'`
- `'prior_purchase batch для BUSINESS → ЦБ — pending retroactive application'`
- `'proof по historical deals mapping — pending'`

**1d. platform_master** — добавить в flows:

- Flow «Как использовать этот документ как входной артефакт»

**1e. open_tails knownIssues** расширить полным списком из требований.

### 2. `supabase/functions/system-docs-nightly-refresh/index.ts`

**2a. Доменная фильтрация audit changes** (строки 258-270):
Вместо сбора единого `changesSummary` и передачи всем доменам — передавать `filteredAudit` целиком, а в `buildDomainDocument()` фильтровать по `bp.auditActionPrefixes`. Агрегировать одинаковые события: `bepaid.erip.reconcile_batch × 24`. Лимит: 20 строк на домен.

**2b. liveTrainingsAccess переписать** (строки 1009-1051):
Добавить:

- root vs child module breakdown
- active modules / active lessons counts
- modules_with_product count
- active product_access rules count
- active training_content rules count
- **Таблица active access_rules** с колонками: id (short), grant_target_type, product_name, tariff_id (short), condition_type, rule_purpose, match_mode, duration_days, target_label
- **Проблемные тренинги**: root-модули где direct_lesson_count=0 но is_active=true (есть child-модули с уроками)
- **Секция «Фактические баги»**: 0 уроков в UI vs реальные уроки в child-модулях

**2c. buildDomainDocument** — добавить для trainings_access:

- Секция «3.1. Матрица доступа через продукты» — из live access_rules
- Секция «3.2. BUSINESS → Ценный бухгалтер» — конкретный кейс из blueprint flow + live данные (
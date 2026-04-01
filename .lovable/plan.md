да, согласен, с учетом правок:

&nbsp;

1. Вынеси в отдельный STOP-guard для narrative, что генератор не имеет права писать в документы неподтверждённые связи.  
Пример:  

  - если связь не доказана по схеме/коду/discovery — писать как не подтверждено или требует проверки;
  - не домысливать прямую связь там, где есть только косвенная.
2. &nbsp;
3. В Phase 0 добавь не только матрицу колонок, но и матрицу join-path для спорных доменов:  

  - site_domain_bindings -> site_pages
  - products_v2 -> tariffs -> tariff_offers
  - orders_v2 -> payments_v2
  - training_modules -> training_lessons
  - products_v2 -> access_rules -> entitlements
4.   
Это нужно, чтобы platform_master и доменные документы описывали реальные связи, а не “похожие”.
5. Для sites_pages_forms явно зафиксируй правку narrative:  

  - site_domain_bindings не описывать как прямую привязку домена к продукту, если в схеме там site_page_id, а не product_id;
  - если продукт определяется через страницу/блок/контент — так и писать;
  - если путь неполный — маркировать как неполная доказательная связь.
6. &nbsp;
7. Для integrations закрепи, что генератор должен брать из edge_functions_registry:  

  - name
  - enabled
  - category
  - tier
  - notes
8.   
И в документе выводить это именно как реестр EF, а не как “все реально существующие EF платформы”, если это не доказано полностью.
9. Для training_modules и tariffs добавь отдельный пункт в DoD:  

  - в итоговом документе нигде не должно остаться слов status там, где реальная модель использует is_active;
  - в orders_v2 нигде не должно остаться cancelled, только canceled.
10. &nbsp;
11. Для seed и repair добавь обязательный dry-run response до execute:  

  - какие домены будут созданы;
  - какие будут repaired;
  - какие skipped;
  - какие попадают в manual review.
12.   
Только потом execute. Даже если это один вызов EF, логически внутри должно быть preview -> apply.
13. Для repair-признака placeholder усили критерий:  
placeholder = не только (Заполнить), но и совпадение с seed-scaffold сигнатурой по нескольким секциям.  
Одной строки (Заполнить) недостаточно, чтобы не зацепить вручную испорченный/смешанный документ.
14. Добавь в EF отдельный manual_review bucket в response:

&nbsp;

{

  "manual_review_domains": [],

  "manual_review_docs": []

}

&nbsp;

8. Чтобы не терялись случаи, где авто-repair запрещён.
9. Для products_sales закрепи ещё один guard:  

  - если код seed/repair по ошибке получает этот домен в списке mutate-операций, EF должен не просто skip, а писать structured warning:
10. &nbsp;

&nbsp;

{ "type": "guard_skip", "domain": "products_sales", "message": "manual history is read-only" }

&nbsp;

9.   

10. В buildDomainDocument() добавь фиксированную первую секцию:  

  - 0. Назначение
  - 1. Источники истины (SoT)
  - 2. Таблицы и связи
  - 3. Ключевые потоки
  - 4. Edge Functions
  - 5. UI / маршруты
  - 6. Legacy / deprecated
  - 7. Текущее состояние
  - 8. Открытые хвосты
11.   
Нужно, чтобы все документы имели одинаковый каркас и были сравнимы между собой.
12. В platform_master добавь обязательную секцию “Границы доказанности”:  

  - что подтверждено по БД;
  - что подтверждено по коду;
  - что пока описано как hypothesis/manual review.
13.   
Это повысит доверие к master-документу.
14. В open_tails добавь отдельный блок “Проблемы самого генератора документации”:  

  - pending proof по actor_user_id
  - proof seed/repair
  - proof полноты snapshot
  - возможные schema mismatch / truncation warnings последних batch
  - build-proof, если он ещё не зафиксирован
15. &nbsp;
16. Для safeSelect и live-списков зафиксируй правило:  

  - если таблица большая, список в документе ограничивается top-N;
  - в документе рядом указывать показаны первые N из M;
  - чтобы не превращать docs в мусорный дамп.
17. &nbsp;
18. В AdminSystemDocs.tsx добавь отображение результата seed/repair не только toast, но и в UI:  

  - created domains
  - repaired domains
  - skipped
  - warnings
  - manual review
19.   
Иначе после запуска непонятно, что реально произошло.
20. В SystemDocViewer добавь для platform_master кнопку не только Скачать master, но и отдельный action:  

  - Копировать master как контекст
21.   
Это должен быть основной UX-сценарий, раз документ задуман как входной артефакт для новых задач.
22. В DoD добавь ещё 3 обязательных proof-пункта:  

  - products_sales manual versions остались byte-to-byte неизменными
  - repair не затронул ни один manual doc с признаками ручной правки
  - warnings/current batch отражены в open_tails и audit_logs.meta, а не только в response EF
23. &nbsp;
24. actor_user_id действительно оставить pending-proof, пока не будет UI-вызова с фактом.  
Его нельзя считать закрытым по коду.
25. Финальный отчёт по этому патчу требуй в двух частях:  

  - что исправлено в генераторе
  - что уже реально появилось в документации
26.   
С отдельным SQL/UI proof по:  

  - admin_docs
  - audit_logs
  - products_sales manual history
  - отсутствию (Заполнить) в active manual docs.
27. &nbsp;

&nbsp;

# План: Единый генератор документации — Blueprint + Live Snapshot + Repair

---

## Phase 0: Discovery (завершён)

### Матрица: что читает генератор → реальные колонки


| Таблица                   | Код EF сейчас                                                        | Реальная схема                                                                                                        | Действие                                                                 |
| ------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `edge_functions_registry` | `select('function_name, description, is_active')`, safeCount по `id` | PK=`name`, колонки: `name, enabled, category, tier, notes`. **Нет** `id`, `function_name`, `is_active`, `description` | Исправить select на `name, notes, enabled, category`, safeCount без `id` |
| `app_settings`            | safeCount по `id`                                                    | PK=`key`. **Нет** `id`                                                                                                | safeCount через `select('*', { count: 'exact', head: true })`            |
| `telegram_bots`           | `select('id, bot_name, is_active')`                                  | Колонки: `bot_name, status`. **Нет** `is_active`                                                                      | `select('id, bot_name, status')`, отображать status                      |
| `training_modules`        | safeSelect `'id, title, status'`                                     | Колонки: `is_active, title`. **Нет** `status`                                                                         | `select('id, title, is_active')`                                         |
| `tariffs`                 | safeCount filter `status`                                            | Колонка: `is_active`. **Нет** `status`                                                                                | Фильтр по `is_active`                                                    |
| `site_domain_bindings`    | `select('id, domain, product_id, is_active')`                        | Колонки: `id, domain, site_page_id, is_primary, is_home, public_id`. **Нет** `product_id`, `is_active`                | `select('id, domain, site_page_id, is_primary, is_home')`                |
| `orders_v2`               | filter `status='cancelled'`                                          | Реальное значение: `canceled` (одна l)                                                                                | Заменить на `canceled`                                                   |
| `entitlements`            | filter `status='active'`                                             | Колонка `status` **есть**                                                                                             | ОК, без изменений                                                        |


### safeCount — универсальное правило

Генератор **не имеет права предполагать наличие `id**`. Все count-запросы через `select('*', { count: 'exact', head: true })`.

---

## Phase 1: Диагностика build error

Build error: `failed to build project: build-run failed with status failed`. Точный текст ошибки недоступен из логов/LSP.

**Действие**: сделать минимальный коммит (cleanup unused import `useMemo` в AdminSystemDocs.tsx, unused `isAutoVersion` в SystemDocViewer.tsx) и проверить, проходит ли билд. Если нет — искать реальную причину по Vite output.

---

## Phase 2: Архитектура решения

```text
supabase/functions/_shared/
  system_docs_blueprint.ts  ← Единственный SoT narrative (серверный)

src/lib/systemDocsRegistry.ts ← UI-реестр (только key, title, sort, filename)
                                НЕ дублирует архитектурный контент

EF: system-docs-nightly-refresh/index.ts
  import blueprint from '../_shared/system_docs_blueprint.ts'
  buildDomainDocument(key, mode)
    = blueprint narrative
    + live DB snapshot (universal safeCount)
    + changes 24h (только для auto_current)
    + open tails (4 источника)

  Режимы:
    source='manual'       → mode='auto_current'
    source='cron-hourly'  → mode='auto_current'
    source='seed'         → mode='manual_baseline' + repair
```

---

## Phase 3: Патчи (5 файлов)

### 3.1. НОВЫЙ: `supabase/functions/_shared/system_docs_blueprint.ts`

Единственный серверный SoT. Структура по домену:

```ts
interface DomainBlueprint {
  purpose: string;
  sotTables: { name: string; role: string }[];
  relatedTables: string[];
  edgeFunctions: { name: string; role: string }[];
  uiRoutes: { path: string; description: string }[];
  sharedHooks: string[];
  legacyZones: string[];
  crossDomainLinks: string[];
  knownIssues: string[];
  rules: string[];
  flows: { name: string; steps: string[] }[];
}
```

Обязательные flows в blueprint:

- product purchase → order → paid → grant-access-for-order
- site form → profile resolve → draft order
- product_access / prior_purchase
- trainings_access / training_content
- nightly docs refresh pipeline

Обязательные cross-domain links в platform_master:

- продукты ↔ тарифы ↔ заказы ↔ оплаты ↔ доступы
- продукты ↔ тренинги ↔ access_rules ↔ entitlements
- сайты/формы ↔ CRM resolve ↔ draft order
- Telegram clubs ↔ product_club_mappings ↔ subscriptions/access
- docs subsystem ↔ admin_docs ↔ nightly refresh

Frontend НЕ импортирует blueprint. Все narrative-данные берутся только из EF-пайплайна.

### 3.2. `supabase/functions/system-docs-nightly-refresh/index.ts` — полная переработка

**3.2a. Import blueprint** из `../_shared/system_docs_blueprint.ts`.

**3.2b. safeCount fix**: все count-запросы через `select('*', { count: 'exact', head: true })` — без зависимости от PK.

**3.2c. Column fixes** (все из Phase 0 discovery matrix).

**3.2d. Единый `buildDomainDocument(key, mode)**`:

- **Детерминированный**: фиксированный порядок секций, фиксированный порядок таблиц/EF/роутов, stable sorting для live-списков
- Один и тот же snapshot без изменений даёт идентичный markdown, кроме timestamp/24h changes
- Секции: Назначение → SoT → Таблицы и связи → Flows → EF → UI/Роуты → Legacy → Текущее состояние (live) → Open tails
- Для `auto_current`: + блок «Изменения за 24 часа» + timestamp
- Для `manual_baseline`: без блока изменений, метка seed

**3.2e. Fail-safe per domain**: если один домен падает — warning в audit, домен получает error-doc, остальные продолжают.

**3.2f. Structured warnings**:

```json
{
  "type": "schema_mismatch",
  "domain": "trainings_access",
  "table": "entitlements",
  "column": "is_active",
  "message": "column does not exist"
}
```

В документе open_tails — человекочитаемая сводка.

**3.2g. open_tails собирается из 4 источников**:

1. blueprint.knownIssues
2. pending/failed/deferred из audit_logs
3. warnings текущего batch
4. известные proof gaps проекта (hardcoded в blueprint)

**3.2h. Seed mode** (`source='seed'`):

- Для каждого домена без manual baseline → `buildDomainDocument(key, 'manual_baseline')` → INSERT POINT A
- **products_sales STOP-guard**: исключён из seed, исключён из repair. Для products_sales разрешён ТОЛЬКО AUTO-CURRENT. Manual history read-only.
- Собирает `createdDomains[]`

**3.2i. Repair mode** (часть seed pipeline):

- Если для домена есть manual doc, который одновременно:
  - НЕ AUTO-CURRENT
  - `meta.source = 'seed'`
  - `content_text` содержит `(Заполнить)` или совпадает с scaffold-сигнатурой
- И НЕТ признаков ручного редактирования (updated_by === created_by, content не изменён от шаблона):
  - archive placeholder → create new manual version → make active
- Если есть хоть малейшие признаки ручной правки:
  - НЕ repair автоматически → warning + manual_review
- Версионирование: вычислять следующую свободную manual-версию по section_key (не хардкодить POINT B)
- Mapping в response: `old_doc_id → new_doc_id, old_version_label → new_version_label`

**3.2j. Seed response** возвращает 3 массива:

```json
{
  "created_domains": [],
  "repaired_domains": [],
  "skipped_domains": [],
  "repair_mapping": [{ "old_doc_id": "...", "old_version_label": "...", "new_doc_id": "...", "new_version_label": "..." }],
  "warnings": []
}
```

**3.2k. STOP-guard на размер**: если snapshot > 80KB — summary + warning. Priority: platform_master, products_sales, trainings_access, orders_payments, open_tails.

### 3.3. `src/pages/admin/AdminSystemDocs.tsx`

- **Удалить hardcoded scaffold** (строка 184). Весь markdown-шаблон убрать.
- **Seed через EF**: `handleSeed` вызывает `supabase.functions.invoke("system-docs-nightly-refresh", { body: { source: "seed" } })`.
- **Показать результат seed**: toast с created/repaired/skipped counts.
- **Удалить unused import** `useMemo`.

### 3.4. `src/hooks/useSystemDocs.ts`

- **Placeholder detection**: добавить `isPlaceholder` boolean — true если `content_text` содержит `(Заполнить)` и `meta.source === 'seed'`.
- **Auto-fallback расширить**: если manual — placeholder, а auto есть → по умолчанию показывать auto.
- **Экспортировать** `isPlaceholder` для currentDoc.
- **Unused imports** `DocMeta`, `AUTO_CURRENT_LABEL` — убрать если не используются.

### 3.5. `src/components/admin/SystemDocViewer.tsx`

- **Placeholder badge**: если currentDoc — placeholder, показать warning «placeholder — содержит только шаблон».
- **CTA «Перегенерировать baseline»**: вызывает seed через parent.
- **CTA «Открыть AUTO-CURRENT»**: переключает viewMode.
- **По умолчанию auto**: если manual placeholder + auto есть → авто-переключение.
- **Master кнопки**: для platform_master — «Скопировать master» / «Скачать master» (filename: `system-architecture-master.md`).
- **Удалить unused import** `isAutoVersion`.

---

## products_sales STOP-guard (отдельный блок)

- products_sales **исключён из seed**
- products_sales **исключён из repair**
- Для products_sales разрешено ТОЛЬКО: чтение manual history + обновление/создание AUTO-CURRENT
- Manual history (POINT A/B/C) — **read-only**

---

## Затрагиваемые файлы


| Файл                                                      | Действие                                      |
| --------------------------------------------------------- | --------------------------------------------- |
| `supabase/functions/_shared/system_docs_blueprint.ts`     | **НОВЫЙ** — единственный серверный SoT        |
| `supabase/functions/system-docs-nightly-refresh/index.ts` | Полная переработка                            |
| `src/pages/admin/AdminSystemDocs.tsx`                     | Seed через EF, убрать scaffold, cleanup       |
| `src/hooks/useSystemDocs.ts`                              | Placeholder detection, auto-fallback          |
| `src/components/admin/SystemDocViewer.tsx`                | Placeholder badge/CTA, master кнопки, cleanup |


### Не изменяется

- `src/lib/systemDocsRegistry.ts` — UI-реестр без архитектурного контента
- Схема БД, RLS

---

## DoD

### Код

1. Build проходит без ошибок
2. В `AdminSystemDocs.tsx` нет hardcoded scaffold markdown
3. Seed/repair не создают пустые manual baseline с `(Заполнить)`
4. Manual baseline и AUTO-CURRENT строятся одним `buildDomainDocument()`
5. Один SoT для blueprint в `_shared/`, без дублирования между frontend и EF
6. EF column queries соответствуют discovery matrix
7. safeCount не зависит от наличия `id`
8. products_sales manual history не изменена (STOP-guard в seed + repair)
9. Версионирование repair вычисляет следующую свободную версию, не хардкодит

### Контент

10. Ни в одном active manual doc нет `(Заполнить)`
11. Ни в одном active manual doc нет пустых scaffold-секций
12. Каждый домен содержит narrative + live snapshot (не только counts)
13. platform_master содержит cross-domain map и пригоден как входной артефакт
14. open_tails собирается из 4 источников

### UI

15. Placeholder badge показывается только на реальных placeholder
16. Домен без manual открывается в auto
17. Copy/download работают в manual и auto
18. UI не показывает placeholder как готовую документацию

### Pending proofs (после деплоя)

- **actor_user_id proof**: manual refresh из UI → `actor_type='user'`, `actor_user_id IS NOT NULL` — **незакрыт до факта**
- **Seed proof**: 6 доменов получили реальный POINT A/B
- **UI proof**: auto-fallback, copy/download, placeholder badge
- **Content proof**: по каждому домену — section_key, version_label, managed_by, content_len, первые 20-30 строк, список секций

### Незакрытые хвосты → open_tails blueprint

- actor_user_id proof для manual refresh
- training access runtime proof
- site pricing proof
- duration_days = NULL
- retroactive batch для product_access
- manual review / wrongly_removed / shortened
- pending live proof по renewal/access
- proof, что docs generator реально даёт полный snapshot, а не scaffold
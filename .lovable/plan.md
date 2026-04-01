# да, согласен, с учетом правок:

&nbsp;

1. Патч 5 разбить на discovery → execute.  
Нельзя заранее жёстко вписывать расширение по таблицам, пока не доказано, что они реально существуют в этой ветке и используются текущей архитектурой.  
Добавь правило:  

  - сначала dry-run по information_schema / фактическим SELECT;
  - только потом расширять снапшоты только подтверждёнными таблицами;
  - если таблица не существует или legacy/deprecated — не включать её как SoT, а выносить в секцию Legacy / не подтверждено discovery.
2. &nbsp;
3. Уточнить список таблиц в Патче 5 как “кандидаты, требующие подтверждения discovery”.  
Не фиксировать без проверки как обязательные:  

  - edge_functions_registry
  - product_relations
  - payment_methods
  - installment_payments
  - lesson_progress
  - site_page_folders
  - integration_instances
  - integration_logs
  - bepaid_sync_logs
  - email_accounts
  - payment_reconcile_queue
  - ban_cases
  - duplicate_cases  
  Для них формулировка должна быть: “если таблица/контур подтверждён discovery — включить; если нет — не выдумывать и не подменять архитектуру”.
4. &nbsp;
5. Добавить отдельный патч на createdDomains.push(domain.key).  
В предыдущем патче был риск, что created_domains в audit останется пустым. Это нужно явно добить и проверить.  
DoD:  

  - после seed audit_logs.meta.created_domains совпадает с реально созданными POINT A.
6. &nbsp;
7. Добавить финальный proof по actor_user_id после UI-вызова.  
Сейчас патч на getUser() правильный, но не закрыт proof.  
Обязательно после деплоя:  

  - нажать “Обновить сейчас” из UI;
  - проверить в audit_logs:  

    - manual_refresh_started
    - manual_refresh_completed
    - actor_type='user'
    - actor_user_id IS NOT NULL  
    Пока этого proof нет — пункт не закрывать.
  - &nbsp;
8. &nbsp;
9. Для initialVersion fallback добавить ещё один кейс.  
Если в URL передан version=POINT X, которого нет, и manual есть, но AUTO-CURRENT тоже есть:  

  - не уходить автоматически в auto всегда;
  - приоритет:  

    - найденный manual version;
    - active manual;
    - первый manual;
    - только если manual нет вообще — auto.  
    Иначе можно потерять ожидаемое поведение manual-режима.
  - &nbsp;
10. &nbsp;
11. Для авто-режима нужен отдельный UI proof, не только кодовый.  
После патча показать:  

  - домен без manual сразу открывается в Автообновление;
  - кнопки Copy / Download активны;
  - контент реально рендерится;
  - пустой экран больше не появляется.
12. &nbsp;
13. По EF entitlements — исправить не только фильтр, но и сделать fail-safe для домена trainings_access.  
Если один из запросов домена падает:  

  - не валить весь refresh;
  - домен должен сохранить snapshot с предупреждением в тексте;
  - warnings должны попасть в audit_logs.meta.  
  Это особенно важно для nightly.
14. &nbsp;
15. Для Патча 5 добавить ограничение: не превращать AUTO-CURRENT в “счётчики ради счётчиков”.  
В каждый домен включать:  

  - SoT;
  - реально используемые таблицы;
  - реальные активные контуры;
  - known issues / pending proof;
  - только после этого статистику.  
  Иначе документация станет шумной и бесполезной как входной артефакт.
16. &nbsp;
17. Добавить финальный data proof после manual refresh.  
После запуска refresh проверить:  

  - 7 AUTO-CURRENT существуют;
  - updated_at обновился у всех 7;
  - products_sales manual POINT A/B/C не изменены;
  - content_text у проблемного trainings_access больше не содержит ошибку по [entitlements.is](http://entitlements.is)_active.
18. &nbsp;
19. Добавить явный STOP-guard на раздувание контента.  
Если расширенный доменный snapshot становится слишком большим:  

  - сначала summary + warning;
  - не добавлять неподтверждённые блоки “про запас”;
  - priority: platform_master, products_sales, trainings_access, orders_payments, open_tails.
20. &nbsp;
21. Финальный статус закрытия оформить по пунктам.  
В отчёте после выполнения должно быть отдельно:  

  - build proof;
  - seed proof;
  - auto-fallback proof;
  - manual refresh actor proof;
  - 7 AUTO-CURRENT proof;
  - expanded content proof;
  - незакрытые хвосты, если остались.
22. &nbsp;

&nbsp;

&nbsp;

План: Финальный патч — сборка, seed, fallback, контент документации

## Диагностика build error

**Причина:** В `src/pages/admin/AdminSystemDocs.tsx` есть неиспользуемые импорты:

- `GlassCard` (строка 4)
- `ShieldCheck` (строка 12)

TypeScript strict mode выдаёт ошибку на unused imports.

## Диагностика EF `entitlements.is_active`

В `system-docs-nightly-refresh/index.ts` строка 370: `.eq('is_active', true)` — но таблица `entitlements` не имеет колонки `is_active`. Есть колонка `status`. Это вызывает ошибку при сборке снапшота `trainings_access`.

## Текущее состояние данных


| section_key       | AUTO-CURRENT | Manual                            |
| ----------------- | ------------ | --------------------------------- |
| platform_master   | ✅            | нет                               |
| products_sales    | ✅            | POINT A, B (archived), C (active) |
| sites_pages_forms | ✅            | нет                               |
| trainings_access  | ✅            | нет                               |
| orders_payments   | ✅            | нет                               |
| integrations      | ✅            | нет                               |
| open_tails        | ✅            | нет                               |


6 доменов не имеют manual baseline — seed должен их создать.

## Что исправляем (5 патчей)

### Патч 1: Build fix — убрать unused imports

**Файл:** `src/pages/admin/AdminSystemDocs.tsx`

- Удалить `GlassCard` из импортов
- Удалить `ShieldCheck` из импортов

### Патч 2: initialVersion fallback в useSystemDocs

**Файл:** `src/hooks/useSystemDocs.ts`, строки 96-105

Если `initialVersion` передан, но не найден среди docs, и есть AUTO-CURRENT — переключиться в auto:

```ts
if (initialVersion) {
  const found = docs.find((d) => d.version_label === initialVersion);
  if (found) {
    if (isAutoVersion(found)) {
      setViewMode("auto");
      setSelectedManualVersion("");
    } else {
      setViewMode("manual");
      setSelectedManualVersion(found.version_label);
    }
  } else {
    // version не найден — fallback
    const auto = docs.find((d) => isAutoVersion(d));
    if (auto) {
      setViewMode("auto");
      setSelectedManualVersion("");
    }
  }
}
```

### Патч 3: Убрать `initialMode` default = "manual"

**Файл:** `src/hooks/useSystemDocs.ts`, строка 24, 29

- Убрать `= "manual"` из деструктуризации
- useState: `useState<ViewMode>(initialMode || "manual")` — оставить, но в fallback (строка 113) убрать проверку `if (!initialMode)` — всегда переключать в auto если manual.length === 0:

```ts
if (manual.length === 0 && auto) {
  setSelectedManualVersion("");
  setViewMode("auto");
}
```

### Патч 4: EF — исправить `entitlements.is_active`

**Файл:** `supabase/functions/system-docs-nightly-refresh/index.ts`, строка 370

Заменить `.eq('is_active', true)` на `.eq('status', 'active')`.

### Патч 5: EF — расширить контент снапшотов

Сейчас снапшоты содержат только базовые счётчики. Нужно расширить каждый домен реальными данными из БД.

Расширения по доменам:

**platform_master:**

- Добавить: количество edge_functions_registry, количество cron jobs из audit_logs, количество доменных событий
- Добавить: список ключевых таблиц с row counts

**products_sales** — уже содержит данные, расширить:

- Добавить: tariff_offers count, product_relations count
- Добавить: список тарифов по продуктам

**orders_payments** — расширить:

- Добавить: payment_methods count, installment_payments count
- Добавить: статистику по статусам заказов

**trainings_access** — расширить:

- Добавить: подписки (subscriptions_v2), module_access counts
- Добавить: lesson_progress statistics

**sites_pages_forms** — расширить:

- Добавить: site_domain_bindings, site_page_folders counts
- Добавить: список страниц с доменами

**integrations** — расширить:

- Добавить: integration_instances, integration_logs counts
- Добавить: bepaid_sync_logs, email_accounts counts

**open_tails** — расширить:

- Добавить: payment_reconcile_queue count
- Добавить: ban_cases, duplicate_cases counts

### Затрагиваемые файлы


| Файл                                                      | Правка                                                                    |
| --------------------------------------------------------- | ------------------------------------------------------------------------- |
| `src/pages/admin/AdminSystemDocs.tsx`                     | Удалить unused imports                                                    |
| `src/hooks/useSystemDocs.ts`                              | initialVersion fallback, initialMode default, убрать guard на auto-switch |
| `supabase/functions/system-docs-nightly-refresh/index.ts` | entitlements fix, расширить контент всех доменов                          |


### Не изменяется

- `SystemDocViewer.tsx`
- `systemDocsRegistry.ts`
- `AdminProductsDocs.tsx`
- Схема БД, RLS

### DoD

1. Build проходит без ошибок
2. entitlements query не падает в EF
3. initialVersion fallback: если version в URL не найден — UI уходит в auto
4. Если manual.length === 0 — UI всегда показывает auto, без пустого экрана
5. После manual refresh все 7 доменов содержат расширенный контент
6. Seed создаёт POINT A для 6 доменов без manual; products_sales не трогает
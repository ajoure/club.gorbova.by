# да, согласен, с учетом правок:

&nbsp;

1. Для **PATCH 1** добавь в proof-файлы не только агрегаты, но и **точные SQL-проверки / формулы**, которыми получены цифры. Иначе потом нельзя будет 1:1 воспроизвести proof.
2. В блоке про offer_id = NULL допиши, что это **не только legacy/manual/import/reconcile**, но и что **PATCH 0 уже исправил direct-charge для новых orders**, то есть доля offer_id = NULL должна уменьшаться только на новых заказах после deploy.
3. **PATCH 2 нельзя начинать как execute-план без явного входного источника.** Нужно сначала зафиксировать один из двух режимов:
  &nbsp;
  - **CSV file mode** — пользователь загружает файл
  - **GetCourse API mode** — dry run по API
    Сейчас в плане это смешано.
  &nbsp;
4. Для PATCH 2 добавь обязательный **source manifest**:
  &nbsp;
  - source_type = csv_file / getcourse_api
  - source_name
  - source_row_count
  - source_hash или другой идентификатор файла/выгрузки
  - batch_id
  - dry_run_at
    Без этого dry run не будет воспроизводимым.
  &nbsp;
5. В PATCH 2 обязательно раздели отчёт на **dedupe against DB** и **dedupe inside source file**. Это разные вещи:
  &nbsp;
  - повторы внутри самого CSV
  - сделки, уже импортированные в БД
  &nbsp;
6. Добавь в dry run отдельный блок **mapping proof**:
  &nbsp;
  - какой gc_offer_id в какой tariff_id замапился
  - сколько строк попало в каждый тариф
  - сколько строк не замапилось вообще
    Это один из ключевых результатов dry run.
  &nbsp;
7. Если dry run идёт через API, зафиксируй **STOP-guard по rate limit**:
  &nbsp;
  - перед запуском показать ожидаемый объём запросов
  - если объём опасен для лимита, не выполнять без отдельного подтверждения режима API.
  &nbsp;

&nbsp;

&nbsp;

В остальном план правильный:

&nbsp;

- PATCH 1 закрывается proof-артефактами,
- offer_id = NULL документируется корректно,
- PATCH 2 логично начинается с dry run, а не с импорта.

&nbsp;

&nbsp;

План: PATCH 1 proof-артефакты + offer_id документация + PATCH 2 dry run

## Часть 1: Закрытие PATCH 1

### 1.1 Сохранить proof-файлы в /mnt/documents/

**patch1_fk_check.txt** — результаты проверки orphan FK:

- orphan product_id: 0
- orphan tariff_id: 0  
- orphan offer_id: 0
- coverage: product_id 1781/1799, tariff_id 1781/1799, offer_id 206/1799

**patch1_public_id_coverage.txt** — покрытие public_id:

- products_v2: 20/20 (100%)
- tariffs: 12/12 (100%)

### 1.2 Документация offer_id = NULL

Отдельный блок в proof-файле:

```
offer_id отсутствует у 1593 / 1799 orders (88.5%)
Это НЕ orphan — это корректные данные:
- legacy orders до внедрения offers
- manual/admin orders (без привязки к offer)
- getcourse import orders (gc_offer_id ≠ offer_id)
- reconcile flows

Post-purchase rules (PATCH 5-6) будут работать 
только на orders с offer_id IS NOT NULL (206 orders сейчас).
Для legacy orders правила не применяются — это by design.
```

---

## Часть 2: PATCH 2 — Dry run импорта GetCourse CSV

### Диагностика

Существующие import-пути:

- `getcourse-import-deals` — через GetCourse Export API (по offer_id), пишет orders + subscriptions
- `getcourse-import-file` — через JSON-массив deals (из UI-загрузки файла)

Hardcoded OFFER_TARIFF_MAP в `getcourse-import-deals`:

```
6744625 → CHAT tariff
6744626 → FULL tariff  
6744628 → BUSINESS tariff
```

### Что нужно для dry run

**Вопрос к пользователю**: нет CSV-файла в проекте. Нужно уточнить:

- Какой CSV будет импортироваться? (новый файл или повторный запуск через GetCourse API?)
- Если CSV — пользователь должен загрузить файл

### Шаги dry run

1. **Зафиксировать source**: имя файла, число строк, источник, batch_id
2. **Добавить dry_run режим** в `getcourse-import-deals` (или создать отдельную функцию):
  - парсинг и маппинг данных
  - проверка дубликатов (по gc_deal_id и order_number)
  - проверка email → profile matching
  - проверка tariff mapping
  - **НЕ** делать INSERT — только отчёт
3. **Отчёт dry run** сохранить в `/mnt/documents/patch2_dry_run_report.txt`:
  - total deals в source
  - deals с валидным email
  - deals с маппингом tariff
  - deals-дубликаты (уже в БД)
  - deals готовые к импорту
  - deals с ошибками

### Риски

- GetCourse API rate limit: 100 запросов / 2 часа
- Если dry run через API — это расходует квоту
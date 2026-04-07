да, согласен, с учетом правок:

&nbsp;

1. В write_paths_root_fix_status.csv добавь ещё 2 колонки:  

  - victims_count_known
  - notes  
  Чтобы было видно не только статус пути, но и подтверждённый масштаб последствий по каждому path.
2. &nbsp;
3. В таблице по AdminEntitlements явно укажи в notes:  

  - manual/non-canonical by design
  - не считается system root-fix
  - только warning + audit trail  
  Чтобы этот путь не выглядел как полноценно исправленный.
4. &nbsp;
5. В блоке про 14 real access defect добавь обязательную разбивку не только по типу ремонта, но и по источнику:  

  - manual/admin flow
  - paid flow
  - unknown / requires deeper trace  
  Это нужно, чтобы не смешивать жертв broken manual path с остальными кейсами.
6. &nbsp;
7. Для Матук в обновлённом [plan.md](http://plan.md) явно раздели два статуса:  

  - access repair = done
  - content visibility = pending  
  Не одной фразой, а двумя отдельными строками.
8. &nbsp;
9. Для Абрамович добавь в план явный follow-up пункт:  

  - нужен UI/runtime proof после data repair  
  Иначе кейс так и останется “условно закрыт” без понятного следующего действия.
10. &nbsp;
11. В финальной таблице этапов добавь отдельную строку:  

  - Edge-function root-fix → ❌ pending  
  Потому что сейчас она скрыта внутри общего System root-fix, а это один из главных незакрытых блокеров.
12. &nbsp;
13. В STOP-guard добавь ещё одно правило:  

  - нельзя считать backfill victims закрытым, пока не получены before/after counts по 14 real access defect  
  То есть не только сам факт backfill, но и доказуемое уменьшение 14 → 0.
14. &nbsp;
15. В финальной формулировке вывода лучше написать чуть жёстче:  

  - discovery завершён
  - UI root-fix завершён
  - edge root-fix не завершён
  - historical backfill не выполнен
  - полное закрытие дефекта не достигнуто  
  Чтобы убрать двусмысленность из фразы “выполнен частично”.
16. &nbsp;
17. В [plan.md](http://plan.md) в разделе “Что НЕ меняется” явно допиши:  

  - код приложения не меняется
  - данные не меняются
  - выполняется только корректировка документации, статусов и CSV-артефакта  
  Чтобы подрядчик не начал делать лишние правки.
18. &nbsp;
19. В артефакте write_paths_root_fix_status.csv для payments-reconcile и bepaid-auto-process в needs_backfill не оставляй расплывчатое определить. Напиши:

&nbsp;

&nbsp;

&nbsp;

- yes_needs_separate_discovery  
Это точнее и не даёт закрыть вопрос формально пустым значением.

&nbsp;

&nbsp;

## План: Обновление отчёта с точными статусами и подготовка backfill-патча

### Суть правок

Текущий `plan.md` содержит завышенные статусы: PHASE 3 помечен ✅, хотя 2 edge-function пути не исправлены; Матук помечена ✅ без оговорки о content-блокере; 53 кейса sweep смешаны без жёсткого разделения; backfill не выполнен.

### Что нужно сделать

**1. Переписать plan.md с корректными статусами**

- PHASE 3: `⚠️ ЧАСТИЧНО` — UI root-fix выполнен (4 файла), edge-function root-fix не выполнен (payments-reconcile, bepaid-auto-process)
- Матук: `⚠️ УСЛОВНО` — access-chain repaired, content visibility requires separate fix (published_at=NULL)
- Ярошевич: ✅ — source order корректен, runtime full, meta нормализована, модульная покупка сохранена как исторический факт без влияния на scope
- Абрамович: `⚠️ УСЛОВНО` — subscription repaired на уровне данных, UI/runtime пост-проверка не выполнена
- Global sweep: ✅ как диагностика, жёсткое разделение: **14 real access defect** / **39 content_not_published**
- Backfill: ❌ не выполнен

**2. Добавить детализацию 14 real access defect**

SQL-запрос для классификации:

- сколько из manual/admin flow
- сколько требуют create_missing_entitlement
- сколько restore_wrong_status
- сколько rebuild_full_chain_from_order

**3. Уточнить статус AdminEntitlements.tsx**

Не root-fix, а guard: warning + audit trail добавлены, но путь остаётся manual/non-canonical by design.

**4. Добавить таблицу write_paths_root_fix_status**


| path_name                   | category | fixed_in_code | still_bypasses | needs_backfill |
| --------------------------- | -------- | ------------- | -------------- | -------------- |
| ContactDetailSheet          | UI       | ✅             | ❌              | да (10 жертв)  |
| CreateDealFromPaymentDialog | UI       | ✅             | ❌              | да (56 жертв)  |
| BulkCreateDealsDialog       | UI       | ✅             | ❌              | да (90 жертв)  |
| AdminEntitlements           | UI       | ⚠️ guard only | да (by design) | нет            |
| payments-reconcile          | Edge     | ❌             | да             | определить     |
| bepaid-auto-process         | Edge     | ❌             | да (partial)   | определить     |


**5. Обновить финальные цифры**

Добавить строки:

- Путей исправлено системно: **4** (3 canonical + 1 guard)
- Путей остаётся исправить: **2** (payments-reconcile, bepaid-auto-process)
- Real access defect из 53: **14**
- Content defect из 53: **39**
- Backfill выполнен: **0 из 14**

**6. Обновить финальный статус проекта**


| Этап                                     | Статус                                                     |
| ---------------------------------------- | ---------------------------------------------------------- |
| Discovery write-paths                    | ✅ закрыто                                                  |
| Point repairs (Матук/Ярошевич/Абрамович) | ⚠️ условно закрыто (content у Матук, UI-proof у Абрамович) |
| Global sweep                             | ✅ закрыт как диагностика                                   |
| Backfill victims                         | ❌ не выполнен                                              |
| System root-fix                          | ⚠️ частично (UI done, edge functions pending)              |


**7. STOP-guard на следующий спринт**

- Нельзя объявлять "исправлено во всей системе" до: перевода payments-reconcile и bepaid-auto-process; выполнения backfill 14 access-жертв; разделения access/content в статистике

**8. Генерация артефакта write_paths_root_fix_status.csv**

**9. Финальная формулировка вывода:**
"System-wide discovery выполнен, root-fix выполнен частично (UI-пути канонизированы, 2 edge-function пути pending), исторический backfill 14 access-жертв и патч edge-functions остаются обязательными для полного закрытия дефекта."

### Файлы для изменения

- `.lovable/plan.md` — полная перезапись с корректными статусами
- `/mnt/documents/write_paths_root_fix_status.csv` — новый артефакт

### Объём

Только документация и артефакты, никаких изменений в коде.
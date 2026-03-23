# да, согласен, с учетом правок:

1. **Нельзя хардкодить UUID canonical/duplicate записей.**  
Cleanup надо делать **доказуемо по normalized label**, а не по конкретным id из текущей базы.  
Иначе патч будет не переносим между окружениями.  
Нужно:
  - построить группы дублей по `normalized_label`
  - внутри каждой группы выбрать canonical запись по правилу
  - все links перевесить на canonical id
  - остальные записи удалить/деактивировать
2. **Явно зафиксировать правило выбора canonical записи.**  
Не просто “кириллический code”, а детерминированный приоритет, например:
  - `is_active = true`
  - затем запись с `code`, совпадающим с нормализованным label
  - затем минимальный `created_at`
  - затем минимальный `id` как tie-breaker  
  Это нужно, чтобы cleanup был воспроизводимым и без ручного списка id.
3. **Cleanup должен идти раньше финального proof и в том же патче обновить seed-логику.**  
Нужно не только почистить текущие дубли, но и исключить повторное появление дублей при повторном прогоне seed.  
То есть:
  - cleanup migration
  - затем seed/upsert
  - затем proof, что повторный прогон миграции/seed не создаёт дублей снова
4. **UI dedupe в** `PositionPicker` **оставить как страховку, но не как основное решение.**  
Нужно явно зафиксировать:
  - primary fix = cleanup БД
  - UI dedupe = defensive layer до/после миграции  
  Иначе можно скрыть мусор в UI, но оставить мусор в базе.
5. **Scroll fix описать точнее.**  
Нужен не просто `max-height`, а разделение:
  - scrollable list area
  - sticky footer / отдельный footer для кнопки “Добавить … в справочник”  
  И обязательно проверить:
  - wheel scroll
  - trackpad scroll
  - keyboard navigation
  - список внутри modal/sheet
  - footer не уезжает вместе со списком
6. **Proof по RPC расширить.**  
Нужна проверка не только на `Бухгалтер`, но и минимум на:
  - `бухгалтер`
  - `Бухгалтер`
  - `БУХГАЛТЕР`  
  Во всех случаях должна возвращаться **одна и та же существующая запись**, без insert дубля.
7. **Добавить SQL proof по links rebind.**  
После cleanup показать:
  - сколько `legal_details_entity_person_links.position_catalog_id` было перевязано
  - какие normalized labels были слиты
  - что после cleanup нет orphan/invalid references
  - что `position_catalog_id` в links указывает только на существующие записи
8. **Отдельно проверить edit существующих links после cleanup.**  
Нужен proof, что:
  - старый link с бывшим duplicate id открывается нормально
  - picker показывает уже canonical запись
  - сохранение не создаёт дубль
  - legacy `custom_position_text` не ломается
9. **Нужен STOP-guard на удаление каталогов.**  
Если по какой-то группе дублей после rebind остаётся более одной активной canonical-кандидатной записи или есть неочевидный конфликт, миграция должна:
  - либо безопасно скипнуть группу
  - либо логировать её в audit/result set  
  Нельзя слепо удалять записи без guard-проверки.
10. **DoD дополнить явной проверкой отсутствия дублей в БД.**  
После патча должно быть:

- `count(*) > 1` по `normalized_label` = 0
- UI по поиску `бух` не показывает дублей
- RPC не создаёт дублей
- links после cleanup валидны

Если пришлют обновлённый план с этими правками, его уже можно брать в работу.

&nbsp;

PATCH 7.3 FIX — Scroll + Dedupe Positions

## Проблемы

1. **Нет вертикального скролла** — `max-h-60 overflow-y-auto` в `PositionPicker.tsx` уже есть в коде (строка 118), но проблема может быть в том, что PopoverContent ограничивает высоту или контент не растягивается. Нужно убедиться, что scroll контейнер работает корректно внутри sheet/modal.
2. **5 групп дублей в БД** — старые seed-записи с английскими кодами (`accountant`, `chief_accountant`, `director`, `deputy_director`, `secretary`) + новые с кириллическими кодами. RPC не поймала их, потому что искала по normalized label, но вставка шла через `ON CONFLICT (code)`, а коды разные.

## Найденные дубли


| Нормализованный label | IDs                    | Коды                                       |
| --------------------- | ---------------------- | ------------------------------------------ |
| бухгалтер             | `8bb5498e`, `d02c8177` | `бухгалтер`, `accountant`                  |
| главный бухгалтер     | `18be473e`, `731dbdfa` | `главный_бухгалтер`, `chief_accountant`    |
| директор              | `0f330158`, `ff08b590` | `director`, `директор`                     |
| заместитель директора | `2a0a30c0`, `28f5f974` | `заместитель_директора`, `deputy_director` |
| секретарь             | `9017e1e3`, `52a8c5a5` | `secretary`, `секретарь`                   |


Существующий link: `position_catalog_id = 731dbdfa` (Главный бухгалтер, старый код `chief_accountant`) — нужно перевесить на `18be473e`.

## Что делаем

### 1. SQL миграция — cleanup дублей

Для каждой группы дублей:

- Каноническая запись = та, что с кириллическим кодом (новый seed)
- `UPDATE legal_details_entity_person_links SET position_catalog_id = canonical_id WHERE position_catalog_id = duplicate_id`
- `DELETE FROM legal_details_positions_catalog WHERE id = duplicate_id`

Конкретно:

- `731dbdfa` → `18be473e` (главный бухгалтер) — 1 link перевешивается
- `d02c8177` → `8bb5498e` (бухгалтер) — 0 links
- `0f330158` → `ff08b590` (директор) — 0 links
- `28f5f974` → `2a0a30c0` (заместитель директора) — 0 links (NB: в seed списке была `заместитель директора`, а старая была `Заместитель директора` — обе с `зам.` нет, точная пара)
- `9017e1e3` → `52a8c5a5` (секретарь) — 0 links

### 2. PositionPicker.tsx — scroll fix

Строка 108: добавить ограничение высоты PopoverContent и убедиться в scroll:

- На `PopoverContent` убрать дефолтный `p-4` (уже `p-0`)
- Обернуть scrollable area в div с явным `max-h-[280px] overflow-y-auto overscroll-contain`
- Кнопку "Добавить в справочник" вынести **за пределы** scroll-контейнера, закрепить внизу (sticky footer), чтобы она всегда была видна

### 3. PositionPicker.tsx — UI dedupe

В `filtered` memo добавить dedupe по normalized label. Из группы с одинаковым normalized label оставлять первую запись (после сортировки). Это страховка на случай, если cleanup миграция ещё не применилась или появятся новые дубли.

### 4. RPC уже корректна

RPC `create_position_catalog_entry` уже ищет по `lower(trim(regexp_replace(label, '\s+', ' ', 'g')))` — это правильно. Проблема была только в seed, который шёл через `ON CONFLICT (code)` и не ловил старые записи с английскими кодами. После cleanup дублей RPC будет работать корректно.

## Файлы


| Файл                                              | Действие                                  |
| ------------------------------------------------- | ----------------------------------------- |
| SQL миграция                                      | Cleanup 5 групп дублей + перевязка 1 link |
| `src/components/ai-requisites/PositionPicker.tsx` | Scroll fix + UI dedupe                    |


## Что НЕ трогаем

- `useEntityPersonLinks.ts` — без изменений
- `EntityPersonLinkForm.tsx` — без изменений
- founder / other / delete / reassign
- `/settings/legal-details`, documents, billing
- RPC `create_position_catalog_entry` — уже корректна
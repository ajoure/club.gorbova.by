# да, согласен, с учетом правок:

1. Для **массового обновления МНС** сделать не прямой execute по кнопке, а **dry-run → execute**:
  - сколько записей найдено;
  - сколько с УНП;
  - сколько без `grp_last_fetched_at`;
  - сколько устарели;
  - сколько будут обновлены.  
  Только после preview запускать execute.
2. Массовое обновление делать **только admin-only** и с жёсткими guard:
  - батчи;
  - rate limit / задержка между запросами;
  - stop after N ошибок подряд;
  - итоговый отчёт: updated / skipped / failed.
3. Для single-record кнопки **«Обновить из реестра»** явно зафиксировать:
  - обновляются только `grp_*` поля;
  - основные реквизиты юрлица не перезаписываются автоматически;
  - адрес/форма/название не меняются без отдельного подтверждённого flow.
4. В `useGrpRefresh` добавить audit:
  - писать факт refresh;
  - old grp snapshot / new grp snapshot;
  - actor;
  - source = manual refresh / bulk refresh.
5. Для **COMPACT_LAYOUT** добавить в DoD не только видимость полей, но и порядок:
  - `Населённый пункт`
  - `Район`
  - `Район города`  
  должны быть одновременно видны и не перепутаны в юрлице / ИП / физлице.
6. Для backfill existing entities добавить правило stale-check:
  - обновлять не все подряд, а только:
    - `grp_*` пустые,
    - либо `grp_last_fetched_at` отсутствует,
    - либо данные старше заданного срока.  
    Срок явно зафиксировать в плане.
7. В отчёте по этому PATCH отдельно показать proof:
  - у старой карточки юрлица до refresh `grp_*` пустые;
  - после refresh заполнены:
    - дата регистрации,
    - код ИМНС,
    - название ИМНС,
    - статус;
  - статус отображается плашкой.
8. Для bulk-refresh лучше предусмотреть **идемпотентность**:
  - повторный запуск не должен ломать данные;
  - если запись уже свежая, она должна быть skipped, а не обновляться без причины.
9. Не трогать:
  - `grp-lookup` edge function без необходимости;
  - основной flow создания новой записи по УНП;
  - snapshot/token/document architecture этого спринта.
10. Финальный статус по этому PATCH считать закрытым только при наличии:

- UI proof по `city_district` в compact layout;
- single refresh proof;
- bulk dry-run proof;
- proof заполнения `grp_*` у старых юрлиц.
- &nbsp;
- Корректирующий PATCH: city_district в compact layout + backfill MNS данных

## Проблемы

### 1. «Район города» не виден в формах юрлиц

**Причина найдена:** Все формы юрлиц (`OrganizationDetailsForm`, `LegalEntityDetailsForm`, `EntrepreneurDetailsForm`, `IndividualDetailsForm`) используют `StructuredAddressBlock` с `compact` mode. `COMPACT_LAYOUT` (строки 69-78 `StructuredAddressBlock.tsx`) **не содержит** `city_district` и `district` — только street/house/building/apartment/city/region/postal_code/country. Поэтому «Район города» и «Район» не отображаются ни в одной форме юрлиц.

### 2. Данные реестра МНС не заполнены для старых юрлиц

**Причина:** `grp_*` поля заполняются только при новом вводе УНП через GRP lookup + подтверждение в `OrganizationDetailsForm` (строки 301-313). Юрлица, созданные до добавления этой функциональности, не имеют `grp_*` данных. Автоматического backfill при открытии карточки нет.

## Изменения

### 1. Добавить city_district и district в COMPACT_LAYOUT

**Файл:** `src/components/shared/StructuredAddressBlock.tsx`

Новый COMPACT_LAYOUT:

```text
street (col-span-2), house, building, apartment,
city, district, city_district,
region, postal_code, country_name
```

Это обеспечит видимость «Район города» и «Район» во всех формах (и юрлиц, и физлиц, и ИП).

### 2. Кнопка «Обновить из реестра» в карточке юрлица (view mode)

**Файл:** `src/components/ai-requisites/EntityRecordSheet.tsx`

В блок «Данные реестра» (или в блок «Основная информация», если grp данных ещё нет) добавить кнопку «Обновить из реестра»:

- Видна только если у юрлица есть УНП (`leg_unp` или `ent_unp`)
- При нажатии вызывает `grp-lookup` edge function по текущему УНП
- Обновляет `grp_*` поля в записи без изменения остальных данных
- Показывает результат (toast success/error)
- Кнопка доступна и когда `grp_*` данных нет (первичное заполнение), и когда есть (обновление)

### 3. Массовое обновление MNS данных — кнопка в таблице юрлиц

**Файл:** `src/components/ai-requisites/EntityTableView.tsx`

Добавить кнопку «Обновить данные реестра» (или в хедере таблицы):

- Итерирует по всем active юрлицам с УНП, у которых нет `grp_last_fetched_at` или данные устарели
- Вызывает `grp-lookup` для каждого последовательно (с задержкой, чтобы не перегрузить API)
- Обновляет `grp_*` поля
- Показывает прогресс и итог

### 4. Новый хук useGrpRefresh

**Файл:** `src/hooks/useGrpRefresh.ts` (новый)

Хук для обновления MNS данных существующей записи:

- Принимает `entityId` + `unp`
- Вызывает `grp-lookup` edge function
- Маппит результат в `grp_*` поля
- Обновляет запись через Supabase update
- Возвращает loading/error state

## Файлы


| Файл                                                 | Что                                                |
| ---------------------------------------------------- | -------------------------------------------------- |
| `src/components/shared/StructuredAddressBlock.tsx`   | Добавить city_district и district в COMPACT_LAYOUT |
| `src/hooks/useGrpRefresh.ts`                         | Новый: обновление MNS данных существующей записи   |
| `src/components/ai-requisites/EntityRecordSheet.tsx` | Кнопка «Обновить из реестра» в view mode           |
| `src/components/ai-requisites/EntityTableView.tsx`   | Массовое обновление MNS данных                     |


## Что НЕ меняется

- Backend columns — без миграций (grp_* поля уже существуют)
- OrganizationDetailsForm — не трогаем
- GrpAddressEnricher — не трогаем
- Edge function grp-lookup — не трогаем
- Formatter — не трогаем
- FULL_LAYOUT — не трогаем

## DoD

- «Район города» виден в edit mode юрлица, ИП и физлица
- «Район» виден в edit mode юрлица, ИП и физлица
- Кнопка «Обновить из реестра» работает для одной записи
- Массовое обновление заполняет grp_* данные для всех юрлиц с УНП
- Статус МНС отображается плашкой после обновления
- Existing flows не сломаны
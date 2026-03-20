# Да, согласен, с учетом правок:

1. **План покрывает не всё ТЗ.**  
Сейчас он закрывает только:
  - safe enrichment адреса,
  - ширину формы,
  - UX для `Другое`.  
  Но из ТЗ еще был запрос про **ИП flow**. Либо добавь это в план, либо явно пометь как **out of scope текущего PATCH**.
2. **Добавь отдельный VERIFY по ИП.**  
В ТЗ было важно, чтобы для ИП:
  - имя не искажалось,
  - не добавлялись кавычки,
  - не пыталась выделяться оргформа там, где её нет,
  - адрес работал по тем же safe-enrichment правилам.  
  Сейчас в плане это только словесно упомянуто, но **нет в DoD**.
3. **Для** `Другое` **недостаточно исправить только layout.**  
Нужно явно добавить в DoD:
  - `Полная форма` сохраняется;
  - `Краткая форма` сохраняется;
  - после `save + reopen` оба значения остаются;
  - эти поля не схлопываются обратно и не теряются.  
  Иначе из ТЗ будет закрыт только внешний вид, но не фактическое поведение.
4. **Расширение формы лучше зафиксировать не только через** `max-w-4xl`**.**  
Это может помочь, но может оказаться недостаточно.  
Добавь формулировку:
  - расширить **основной контейнер страницы и внутреннюю карточку реквизитов**;
  - адресный блок и блок `Другое` должны использовать доступную ширину, а не оставаться визуально зажатыми.  
  То есть не ограничивайся одним классом, а фиксируй **ожидаемый UI-результат**.
5. **Safe enrichment опиши жестче.**  
Сейчас идея правильная, но нужно явно зафиксировать:
  - если GRP уже распознал `street / house / city / apartment / building`, Google **не имеет права** их перезаписать;
  - Google только дозаполняет пустые поля;
  - при конфликте значений Google-ответ автоматически не применяется.  
  Это главный баг, и его нужно зафиксировать как правило, а не только как перестановку `||`.
6. **Добавь proof после сохранения, а не только после apply.**  
В DoD сейчас не хватает:
  - after confirm,
  - after save,
  - after reopen.  
  Нужно доказать:
  - `Панфилова` не превращается в `Верхняя`;
  - `дом 2` и `49л` не теряются;
  - canonical и legacy согласованы после повторного открытия формы.
7. **Отдельно зафиксируй, что новых сущностей не создаём.**  
Напиши явно:
  - без новых таблиц,
  - без новых EF,
  - без миграций,
  - только bugfix текущего flow.  
  Это соответствует add-only подходу и не даст разрастись патчу.
8. **Если объединение/упрощение сценария ЮЛ/ИП не входит в этот PATCH — так и напиши.**  
Иначе план выглядит как будто эта часть ТЗ забыта.  
Нужна одна строка:
  - `рефактор объединения сценариев ЮЛ/ИП в один flow в этот PATCH не входит; сейчас только bugfix и verify существующих flows`.

Итог:  
**План хороший, но не полностью покрывает ТЗ**, пока не добавлены:

- явный VERIFY для ИП,
- сохранение/reopen для `Другое`,
- жёсткое правило safe enrichment,
- фиксация scope по ЮЛ/ИП flow.
- &nbsp;
- План: Phase 3.2.1 — Safe enrichment + UI fixes

## DIAGNOSE

### Баг 1: Google overwrite уже распознанных полей (КРИТИЧЕСКИЙ)

**Файл:** `src/lib/address/GrpAddressEnricher.ts`, строки 70-87
**Причина:** Merge-логика `googleParsed.street || preliminary.street` отдает приоритет Google. Если Google вернул другую улицу, она перезаписывает GRP.
**Факт:** «Панфилова» → «Верхняя» после enrichment.

### Баг 2: ИП — форма не выставляется автоматически

**Файл:** `src/components/legal-details/EntrepreneurDetailsForm.tsx`, строка 140
**Причина:** Для ИП `handleGrpConfirm` применяет только `grpResult.name` (полное имя). Org form `Индивидуальный предприниматель` не устанавливается, потому что в форме ИП нет поля org_form. Но в `GrpAutofillService.parseOrgFormAndName` для ИП (например «Горбова Екатерина Сергеевна») `orgFormFull` возвращается пустым — это корректно, ИП не имеет отдельной org form в форме ИП.

### Баг 3: «Другое» — поля слишком маленькие

**Файл:** `src/components/legal-details/OrgFormCombobox.tsx`, строки 149-169
**Причина:** `grid grid-cols-2 gap-2` с `h-8 text-sm` — выглядит как pill, а не как полноценный Input.

### Баг 4: Форма слишком узкая

**Файл:** `src/pages/settings/LegalDetails.tsx`, строки 137, 186
**Причина:** `max-w-2xl` (672px) — слишком сжато для адресного блока + реквизитов.

## DRY RUN

### Переиспользуемые компоненты

- `GrpAddressEnricher` — исправить merge-логику (не создавать новый файл)
- `OrgFormCombobox` — исправить layout «Другое» (не создавать новый компонент)
- `LegalDetails.tsx` — расширить контейнер

### Что меняется


| Файл                                               | Изменение                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------- |
| `src/lib/address/GrpAddressEnricher.ts`            | Merge: GRP-поля приоритетнее Google для street/house/city/apartment |
| `src/components/legal-details/OrgFormCombobox.tsx` | Layout «Другое»: полноценные Input, full width                      |
| `src/pages/settings/LegalDetails.tsx`              | `max-w-2xl` → `max-w-4xl`                                           |


### Что НЕ меняем

- Новых файлов нет
- Миграций нет
- Edge functions не трогаем
- EntrepreneurDetailsForm — ИП не имеет org form, это корректное поведение

## EXECUTE — 3 файла

### PATCH 3.2.1 — Safe merge в GrpAddressEnricher

Изменить merge-логику (строки 70-87): GRP-значения имеют приоритет, Google дозаполняет только пустые поля.

```
street: preliminary.street || googleParsed.street,
house: preliminary.house || googleParsed.house,
city: preliminary.city || googleParsed.city,
apartment: grpApartment || googleParsed.apartment || '',
building: preliminary.building || googleParsed.building,
settlement: preliminary.settlement || googleParsed.settlement,
district: preliminary.district || googleParsed.district,
region: preliminary.region || googleParsed.region,
postal_code: preliminary.postal_code || googleParsed.postal_code,
country_code: preliminary.country_code || googleParsed.country_code || 'BY',
country_name: preliminary.country_name || googleParsed.country_name || 'Беларусь',
```

Google заполняет только: `postal_code`, `region`, `country`, `place_id`, `lat`, `lng` и прочие пустые сегменты. Уже распознанные street/house/city/apartment не перезаписываются.

### PATCH 3.2.2 — Fix «Другое» layout

В `OrgFormCombobox.tsx` заменить `grid grid-cols-2 gap-2` на вертикальный layout:

- Полная форма — `w-full`, нормальный `h-9`
- Краткая форма — `w-full` или `max-w-[200px]`, нормальный `h-9`
- Убрать `h-8 text-sm`, сделать стандартные Input-поля

### PATCH 3.2.3 — Widen layout

В `LegalDetails.tsx`: обе строки `max-w-2xl` → `max-w-4xl` (896px).

## DoD

- «Панфилова» не заменяется на «Верхняя» после enrichment
- `дом 2` и `офис 49л` сохраняются
- Google дозаполняет только пустые поля (postal_code, region, country, place_id, lat, lng)
- «Другое» full/short — полноценные поля ввода
- Форма реквизитов визуально шире и не зажата
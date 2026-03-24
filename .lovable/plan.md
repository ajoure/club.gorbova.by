# да, согласен, с учетом правок:

1. **Apartment normalization делать не только в Google path, но и в любом ручном сохранении поля.**  
Правильно:
  - `stripApartmentPrefix()` вызывать:
    - после `subpremise` из Google,
    - после parser fallback,
    - на blur поля `apartment`,
    - перед submit/save как финальный guard.  
    Иначе часть значений `кв. 4` всё равно может проскочить.
2. `stripApartmentPrefix()` **должен быть строго “prefix-only”.**  
Убирать только префиксы в начале строки:
  - `кв.`, `кв`, `квартира`
  - `пом.`, `пом`, `помещение`
  - `оф.`, `офис`  
  Не удалять ничего из середины строки и не пытаться “угадывать” помещение по произвольному тексту.
3. **Для юрлиц статус МНС — да, делать плашкой, но через нормализованную проверку.**  
Не только по подстроке `действующ`, а:
  - trim + lowercase;
  - список допустимых active/inactive значений;
  - unknown status — нейтральная серая плашка, а не красная по умолчанию.  
  Иначе нестандартные значения будут ошибочно краснеть.
4. **В отчёте по MNS metadata обязательно разделить “уже сохранялось” и “теперь улучшено отображение”.**  
По твоему аудиту:
  - дата регистрации, код ИМНС, название ИМНС, статус уже сохраняются в `grp_*`;
  - в этом корректирующем PATCH меняется именно UI-представление статуса, а не сама persistence.  
  Это важно честно зафиксировать.
5. **city_district для юрлиц — в этом PATCH как verify-only принимаю.**  
Но в отчёте нужен явный proof:
  - форма юрлица;
  - поле видно;
  - значение сохраняется/загружается;
  - `Фрунзенский район` не попадает в населённый пункт.
6. **postal_code — тоже как verify-only ок**, но нужен честный proof:
  - сценарий Google select без квартиры;
  - сценарий Google select с квартирой;
  - индекс не потерян.  
  Если кейс с квартирой всё же иногда ломается, не писать “исправлено”, а писать “проверено / требует отдельного follow-up”.
7. **Formatter не трогать — правильно.**  
Но в отчёте прямо указать:
  - баг был не во formatter,
  - баг был в том, что в `apartment` сохранялось уже префиксованное значение.
8. **DoD дополнить ещё одним кейсом:**
  - `пом. 49л` → хранится `49л`
  - в юрлице formatter выводит `пом. 49л`, но не `пом. пом. 49л`
  - в физлице `кв. 4` → хранится `4`, выводится `кв. 4`
9. **Что не меняется — оставить, но добавить:**
  - без DB миграций;
  - без изменения snapshot architecture;
  - без изменения persistence MNS metadata;
  - только apartment normalization + status badge + verification.
10. **Итоговый статус этого корректирующего PATCH я бы формулировал так:**

- если apartment normalization и badge реально проверены в UI, а city_district/postal_code подтверждены скринами/сценариями — **PATCH ЗАКРЫТ**;
- если postal code кейс с квартирой ещё нестабилен — **PATCH ЧАСТИЧНО ЗАКРЫТ, нужен follow-up по Google address parsing**.
- &nbsp;
- Корректирующий PATCH — Apartment normalization + MNS metadata status badge + city_district verification

## Текущее состояние (audit)

1. **Apartment bug**: Google subpremise может вернуть `кв. 4` — сохраняется as-is в `apartment`. Formatter в `formatStructuredAddress.ts` добавляет `пом.` / `кв.` prefix → получается `кв. кв. 4`. Аналогично `parseStreetInput` уже возвращает чистое число, но Google path не нормализует.
2. **MNS metadata**: Уже сохраняется в `grp_*` полях (`grp_registration_date`, `grp_status_name`, etc.) и отображается в `EntityRecordSheet.tsx` секцией "Данные реестра". Но статус показывается простым текстом, без цветовой плашки.
3. **city_district для юрлиц**: `StructuredAddressBlock` уже используется во всех формах (юрлица, ИП, физлица). Поле `city_district` уже в layout. Работает автоматически.
4. **postal_code**: Google select устанавливает все поля атомарно через `onChange(merged)`, минуя `handleFieldChange`. Индекс не теряется.

---

## Изменения

### PATCH C — Нормализация apartment (основной баг)

**Новая функция** `stripApartmentPrefix` в `src/lib/address/parseStreetInput.ts`:

- Убирает префиксы `кв.`, `кв`, `пом.`, `пом`, `квартира`, `помещение`, `офис`, `оф.` из начала строки
- Оставляет только номер/значение: `кв. 4` → `4`, `пом. 49л` → `49л`

**Применить в 3 точках:**

1. `GooglePlacesAdapter.parseComponents()` — нормализовать `apartment` после извлечения из subpremise
2. `StructuredAddressBlock.handleSelect()` — нормализовать `merged.apartment` после parser fallback
3. `StructuredAddressBlock.handleFieldChange()` — на blur поля `apartment` strip prefix (аналогично city blur)

### PATCH A — Статус-плашка для МНС данных

**Файл:** `src/components/ai-requisites/EntityRecordSheet.tsx`

Заменить простой `<InfoRow label="Статус" value={...} />` на плашку:

- `grp_status_name` содержит "действующ" → зеленый бейдж (`bg-green-50 text-green-700 border-green-200`)
- Иначе → красный бейдж (`bg-red-50 text-red-700 border-red-200`)
- Используем `<Badge variant="outline">` с conditional className

### PATCH B — city_district для юрлиц (verify only)

`StructuredAddressBlock` уже содержит `city_district` в `FULL_LAYOUT`. Все формы юрлиц (`OrganizationDetailsForm`, `LegalEntityDetailsForm`, `EntrepreneurDetailsForm`) используют этот компонент. Поле уже видно, сохраняется и загружается. Google adapter маппит sublocality → city_district.

Изменений не требуется — только verification в отчете.

### PATCH D — postal_code (verify only)

`handleSelect` устанавливает поля атомарно. Parser не затирает postal_code. Изменений не требуется.

---

## Файлы


| Файл                                                 | Что                                                      |
| ---------------------------------------------------- | -------------------------------------------------------- |
| `src/lib/address/parseStreetInput.ts`                | Добавить `stripApartmentPrefix()`                        |
| `src/lib/address/adapters/GooglePlacesAdapter.ts`    | Нормализовать apartment после subpremise                 |
| `src/components/shared/StructuredAddressBlock.tsx`   | Blur-нормализация apartment + apply strip в handleSelect |
| `src/components/ai-requisites/EntityRecordSheet.tsx` | Статус-плашка для grp_status_name                        |


## Что НЕ меняется

- Formatter (`formatStructuredAddress.ts`) — не трогаем
- Backend columns — без миграций
- GrpAddressEnricher — не трогаем
- Person address flow — не трогаем
- Billing/template flows — не трогаем

## DoD

- `apartment` хранится без префикса (`4`, не `кв. 4`)
- Formatter не дублирует `кв. кв. 4`
- Статус юрлица отображается цветной плашкой
- city_district у юрлиц работает (verification proof)
- postal_code стабилен (verification proof)
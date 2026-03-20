# да, согласен, с учетом правок:

1. **Переименование МНС проверь не только в заголовке карточки, а во всех user-facing строках.**  
Не должно остаться смешанного `GRP Lookup`:
  - заголовок карточки
  - возможные loading / empty / error messages
  - тестовые подписи в UI
  - если есть provider label / display name в registry — тоже перевести
2. **Для Google Maps VERIFY зафиксируй именно новый сценарий без кнопки.**  
В DoD должно быть явно:
  - ввод `>= 3` символов
  - подсказки появляются автоматически без клика
  - выбор подсказки обновляет результат
  - кнопка удалена из UI полностью
3. **Проверку** `grp-lookup` **сделай 4-сценарной, а не 3-сценарной.**  
Добавь отдельно:
  - без JWT → `401 Unauthorized`
  - с JWT + валидный УНП + найдено
  - с JWT + валидный УНП + не найдено
  - с JWT + невалидный УНП → валидационная ошибка  
  Это соответствует требованию VERIFY и проверке реального поведения, а не только happy-path.
4. **В VERIFY по миграции уточни запрос.**  
Добавь `table_schema = 'public'` и проверь именно 4 ожидаемых поля, а не только `LIKE '%_structured'`, чтобы исключить ложние совпадения.
5. **Добавь обязательный output в отчет.**  
После выполнения должны быть приложены:
  - имя migration-файла
  - SQL-результат проверки 4 JSONB-полей
  - результат вызовов `grp-lookup` по всем 4 сценариям
  - обновлённый скрин UI с русским названием и Google autocomplete без кнопки
6. **Architectural proof сформулируй как проверяемый блок.**  
Не просто “подтвердить через ссылки на файлы”, а показать:
  - где именно сервисный слой
  - где именно adapter layer
  - что UI-карточки только вызывают хуки/адаптеры и не содержат доменной логики  
  Это обязательно, потому что по стандарту бизнес-логика должна жить в сервисах, а интеграции идти через adapters.
7. **Добавь явный финальный статус этапа.**  
После VERIFY должно быть одно из двух:
  - `Phase 2 closed`
  - `Phase 2 returned for rework`  
  Это нужно, потому что план и отчет проверяются раздельно, и этап должен закрываться только после фактической проверки результата.

В остальном план нормальный и его можно отдавать в работу.

&nbsp;

План: Правки Phase 2 — автоподсказки, переименование МНС, VERIFY

## Что делаем

### 1. Google Maps: автоподсказки без кнопки «Лупа»

**Файл:** `src/components/integrations/google-maps/GoogleMapsSettingsCard.tsx`

Сейчас поиск запускается только по клику на кнопку Search. Нужно:

- Вызывать `fetchPredictions(testQuery)` прямо в `onChange` input (хук уже имеет встроенный debounce 300ms)
- Убрать кнопку «Лупа» полностью
- Подсказки появляются динамически при вводе >= 3 символов

### 2. Переименовать МНС GRP Lookup на русский

**Файл:** `src/components/integrations/grp-lookup/GrpLookupSettingsCard.tsx`

- Заголовок: `МНС GRP Lookup` → `Поиск по УНП (МНС)`
- Описание: оставить как есть — уже на русском
- Badge: оставить «Доступно»

### 3. VERIFY: проверка edge function grp-lookup

Выполнить реальные вызовы через `supabase--curl_edge_functions`:

- Вызов **без JWT** → ожидаем 401 Unauthorized
- Вызов **с JWT + валидный УНП** (например 192560618) → ожидаем `{ found: true, data: {...} }`
- Вызов **с JWT + невалидный УНП** (8 цифр) → ожидаем 400 или `{ error: "..." }`

### 4. VERIFY: проверка миграции (JSONB shadow-поля)

Выполнить SQL-запрос через `supabase--read_query`:

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name IN ('client_legal_details', 'executors')
  AND column_name LIKE '%_structured'
ORDER BY table_name, column_name;
```

### 5. VERIFY: architectural proof

Подтвердить через ссылки на файлы:

- Бизнес-логика: `AddressNormalizationService.ts`, `GooglePlacesAdapter.ts`, `GrpLookupAdapter.ts`
- UI-карточки: только вызывают хуки и адаптеры, не содержат доменную логику
- Edge function: JWT обязателен в коде (строки 54-74 `grp-lookup/index.ts`)

## Файлы


| Файл                                                                 | Действие                                |
| -------------------------------------------------------------------- | --------------------------------------- |
| `src/components/integrations/google-maps/GoogleMapsSettingsCard.tsx` | Убрать кнопку, автоподсказки в onChange |
| `src/components/integrations/grp-lookup/GrpLookupSettingsCard.tsx`   | Переименовать заголовок на русский      |


- VERIFY через инструменты (curl, SQL query, скрины)
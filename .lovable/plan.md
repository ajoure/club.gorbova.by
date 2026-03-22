да, согласен, с учетом правок:

1. В Этапе A добавь **обязательный proof по одному и тому же кейсу** в двух местах:
  - `/ai`
  - `/settings/legal-details`  
  Для одной и той же записи/УНП показать:
  - что лежит в `address_structured` до save,
  - что лежит после save,
  - что реально рендерится в preview/view.  
  Иначе можно починить только один путь.
2. Раздели hotfix на два уровня и не смеш
3. PATCH 5R++ HOTFIX

## Что уже доказано по факту

### Блокер 1 — почему в UI все еще виден «Центральный район»

Проблема уже локализована, это не “не тот shell”:

- `EntityRecordSheet` действительно вызывает `formatStructuredAddressForView(...)`
- адрес уже рендерится построчно через `addressLines.map(...)`
- старого `.join(...)` в view-path нет

Значит, проблема не в рендере shell, а в самих данных/правиле formatter.

Для записи `30347fc5-8b43-4391-88b4-9cdcf7befcb1` в БД сейчас лежит:

```text
city = Минск
district = Минский район
settlement = Центральный район
region = Минская область
postal_code = 220035
street = ул. Панфилова
house = 2
apartment = 49л
source = grp
```

Именно поэтому UI показывает:

```text
ул. Панфилова, д. 2, пом. 49л
220035, г. Минск, Центральный район
```

Точный root cause:

- formatter для Минска уже скрывает `district`
- но он все еще добавляет `settlement`
- в текущих данных `settlement = Центральный район`
- значит район города протекает в display не через `district`, а через `settlement`

Это и есть главный дефект по адресу.

### Блокер 2 — что уже доказано по lookup МНС/ГРП

Backend lookup сейчас отвечает корректно. Прямой вызов `grp-lookup` по УНП `193405000` вернул `200` и валидные данные:

- полное наименование
- адрес
- статус
- ИМНС
- дата регистрации

То есть:

- edge-function жива
- внешний реестр отвечает
- контракт `grp-lookup` не сломан на backend-уровне

Следовательно, если lookup “не работает” в реальном UI, root cause нужно искать в client-flow:

- не уходит вызов из формы
- не открывается confirm dialog
- apply/save не сохраняет
- либо ломается только в одном из путей (`/ai` vs `/settings/legal-details`)

## Что исправляем

### 1) Hotfix адреса в реальном UI

Минимальный обязательный фикс:

**Файл:** `src/lib/address/formatStructuredAddress.ts`

Добавить Belarus-specific guard для `settlement`:

- для `Минск / г. Минск / город Минск` не показывать `settlement`, если это район города
- для Минска строка 2 должна быть только:
  - `индекс`
  - `г. Минск`

Правило:

- Минск → скрыть `region`, `district`, `settlement`, если они дают район/область
- Беларусь не-Минск → оставить `region`, оставить район области, скрывать только район города
- generic formatter других стран не трогать

### 2) Убрать источник повторного загрязнения адреса

Нужно не только спрятать вывод, но и проверить ingress-path.

Файлы для проверки и правки:

- `src/lib/legal-entities/GrpAddressParser.ts`
- `src/lib/address/GrpAddressEnricher.ts`
- `src/components/legal-details/OrganizationDetailsForm.tsx`

Что проверить:

- не кладет ли parser городской район в `settlement`
- не возвращает ли Google `sublocality/neighborhood = Центральный район`, который затем сохраняется как `settlement`
- не перетирает ли enrichment корректный GRP-адрес городским районом

Цель hotfix:

- не ломая хранение канонической модели, перестать сохранять район города как display-значимый `settlement` для Минска
- при этом не сломать адреса не-Минска и район области

### 3) Восстановить и доказать UI-flow lookup по УНП

Так как backend работает, hotfix по lookup должен идти через реальный flow.

Файлы для диагностики/возможной правки:

- `src/components/legal-details/OrganizationDetailsForm.tsx`
- `src/hooks/useGrpLookup.ts`
- `src/components/legal-details/GrpConfirmDialog.tsx`
- при необходимости `src/components/ai-requisites/EntityRecordSheet.tsx`

Проверяем по шагам:

1. ввод 9 цифр УНП
2. уходит ли `supabase.functions.invoke("grp-lookup")`
3. приходит ли ответ
4. строится ли diff
5. открывается ли `GrpConfirmDialog`
6. после confirm применяются ли:
  - форма
  - название
  - адрес
  - grp_* metadata
7. после save сохраняются ли данные в запись
8. не сломан ли тот же flow в `/settings/legal-details`

Если регрессия окажется только в UI:

- фикс только в форме/confirm-flow
- backend `grp-lookup` не трогаем

## Порядок выполнения

### Этап A — диагностика hotfix

1. Проверить live UI-flow lookup в `/ai` и `/settings/legal-details`
2. Снять network-proof вызова `grp-lookup`
3. Снять proof, где именно ломается flow:
  - request не ушел
  - request ушел, но диалог не открылся
  - диалог открылся, но apply/save не сохранил
4. Зафиксировать адресный data-path на проблемной записи:
  - что приходит в `EntityRecordSheet`
  - какие поля использует formatter
  - почему именно `settlement` попадает в display

### Этап B — минимальный кодовый hotfix

1. Исправить Belarus formatter для Минска
2. При необходимости санировать ingress-path parser/enricher, чтобы район города не сохранялся как `settlement`
3. Исправить UI-flow lookup только в том месте, где реально найден root cause

### Этап C — proof-пакет

Нужны 4 коротких proof:

1. **Минск без района**

```text
ул. Панфилова, д. 2, пом. 49л
220035, г. Минск
```

2. **Минск без Минской области**

- в строке 2 нет `Минская область`

3. **Не-Минск по Беларуси**

```text
ул. ...
231300, Гродненская обл., Лидский р-н, г. Лида
```

4. **УНП lookup снова работает**

- ввод УНП
- request уходит
- confirm dialog открывается
- apply/save работает
- данные сохраняются

Дополнительно:

- proof, что `/settings/legal-details` не сломан
- proof, что billing/view shell не сломан

## Какие файлы с высокой вероятностью войдут в hotfix

- `src/lib/address/formatStructuredAddress.ts`
- `src/lib/legal-entities/GrpAddressParser.ts`
- `src/lib/address/GrpAddressEnricher.ts`
- `src/components/legal-details/OrganizationDetailsForm.tsx`
- возможно `src/hooks/useGrpLookup.ts` (только если root cause подтвердится там)

## Обновленный DoD

- для Минска в view никогда не показываются:
  - Беларусь
  - Минская область
  - район города
- `EntityRecordSheet` показывает:

```text
ул. Панфилова, д. 2, пом. 49л
220035, г. Минск
```

- не-Минск Беларусь сохраняет область и район области
- lookup МНС/ГРП работает в реальном UI, а не только на прямом вызове backend
- confirm/update/save flow не регресснул
- `/settings/legal-details` не сломан
- только после этого PATCH 5R++ считается закрытым; к PATCH 6 не переходим
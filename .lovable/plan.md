# дополни план следующей информацией:

&nbsp;

1. **Сначала обязательный discovery-этап, потом UI**
  &nbsp;
  - План сейчас сразу идёт в реализацию, но не фиксирует полный discovery по источникам выбора для:
    &nbsp;
    - продукт / тариф
    - клуб
    - домен / раздел платформы
    - entitlement
    - legacy mappings
    - effective preview
    &nbsp;
  - Добавь отдельную Phase 0:
    &nbsp;
    - все таблицы / views / hooks / RPC / edge / UI-компоненты, которые уже участвуют в access grant flow;
    - откуда реально брать справочники для селекторов;
    - где сейчас живёт legacy/fallback логика;
    - где считается итоговый effective access.
    &nbsp;
  - Без этого есть риск снова собрать технический CRUD поверх неполной картины.
  &nbsp;
2. **Нельзя сводить “домен / раздел платформы” к email_accounts**
  &nbsp;
  - Это архитектурно слабое допущение.
  - email_accounts — это канал/интеграция, а не универсальная бизнес-сущность “раздел платформы / домен”.
  - В плане нужно явно разделить:
    &nbsp;
    - email / inbox / mailbox access,
    - domain / section / module access,
    - system entitlement.
    &nbsp;
  - Если отдельного справочника доменов/разделов ещё нет, это надо честно зафиксировать как gap и временно показать только те цели, для которых есть реальный SoT.
  &nbsp;
3. **Нельзя подменять “часть продукта / тренинг / урок” формулировкой “реализуем через product_access или entitlement”**
  &nbsp;
  - В текущем виде это ломает бизнес-смысл, который пользователь хочет видеть.
  - План должен явно разделить:
    &nbsp;
    - **UI taxonomy** — что админ выбирает,
    - **runtime capability** — что система реально умеет выдавать сейчас,
    - **storage mapping** — как это хранится до появления полной runtime-поддержки.
    &nbsp;
  - Нужно добавить explicit mapping matrix:
    &nbsp;
    - UI type
    - storage representation
    - runtime support: full / partial / preview-only / not supported
    &nbsp;
  - Если “часть продукта / урок / тренинг” пока не выдаются runtime, UI не должен притворяться, что это уже рабочий grant.
  &nbsp;
4. **Нужен отдельный слой “effective grant source resolution”**
  &nbsp;
  - Сейчас в плане preview описан слишком общо.
  - Добавь явный алгоритм сборки explain-блока:
    &nbsp;
    - new rule
    - migrated rule
    - legacy mapping
    - fallback
    - conflict winner
    &nbsp;
  - Для каждого grant в preview должны быть поля:
    &nbsp;
    - source_type
    - source_id
    - source_label
    - migrated_status
    - effective_status
    - overridden_by / duplicated_with
    &nbsp;
  - Иначе “что реально получит покупатель” снова будет не доказуемо.
  &nbsp;
5. **Legacy-блок нужно не просто показать, а нормализовать по статусам**
  &nbsp;
  - Недостаточно “всегда видимый”.
  - Добавь обязательные статусы:
    &nbsp;
    - active legacy only
    - duplicated by new rule
    - migrated and replaced
    - inactive legacy
    - fallback currently effective
    &nbsp;
  - И отдельный badge для случая:
    &nbsp;
    - “видно в legacy, но не участвует в effective preview”.
    &nbsp;
  &nbsp;
6. **Срок доступа нельзя строить только от tariffs.access_days**
  &nbsp;
  - В плане это указано как основной default, но нужно discovery:
    &nbsp;
    - есть ли другие источники срока;
    - что делать, если у тарифа access_days = null;
    - как отображать бессрочный / until revoked / inherited duration;
    - как сочетать manual duration и legacy duration.
    &nbsp;
  - Добавь matrix по срокам:
    &nbsp;
    - source = tariff
    - source = rule manual days
    - source = rule manual months
    - source = legacy
    - source = unknown / not configured
    &nbsp;
  - И explicit precedence, какой источник побеждает.
  &nbsp;
7. **rule_purpose в conditions JSON — допустимо только после проверки existing meta/storage**
  &nbsp;
  - Само решение нормальное, но его нельзя фиксировать без проверки:
    &nbsp;
    - нет ли уже metadata/meta/conditions-ключей со схожим смыслом;
    - не используется ли другой canonical key для purpose/category/type.
    &nbsp;
  - Добавь duplicate guard для новых JSON-ключей.
  &nbsp;
8. **Нужен строгий add-only mapping по типам и полям**
  &nbsp;
  - План должен явно перечислить:
    &nbsp;
    - какие текущие DB fields остаются;
    - какие новые computed/UI-only поля добавляются;
    - какие JSON/meta keys добавляются;
    - что не меняется в runtime.
    &nbsp;
  - Иначе подрядчик снова может “упростить” через скрытую замену существующей логики.
  &nbsp;
9. **Нужен отдельный блок по ограничениям UI**
  &nbsp;
  - Если часть целей пока не поддержана runtime, это должно быть видно в интерфейсе:
    &nbsp;
    - “доступно для настройки и preview”
    - “preview-only”
    - “ещё не исполняется автоматически”
    &nbsp;
  - Это критично, чтобы не создать ложное ощущение готовности.
  &nbsp;
10. **Файлы и слой реализации сейчас описаны слишком узко**

&nbsp;

&nbsp;

&nbsp;

- Недостаточно указать только:
  &nbsp;
  - ProductAccessRulesTab.tsx
  - useAccessRules.ts
  &nbsp;
- Добавь discovery/реализацию по:
  &nbsp;
  - hooks/selectors для products/tariffs/clubs/legacy/effective preview,
  - resolver/explain shaping,
  - возможные shared UI components,
  - существующие preview-card/list-row компоненты, если есть.
  &nbsp;
- Иначе снова получится перегруженный монолит в одном компоненте.

&nbsp;

&nbsp;

&nbsp;

11. **DoD нужно усилить доказуемостью**

&nbsp;

&nbsp;

&nbsp;

- Добавь в DoD:
  &nbsp;
  - без SQL админ видит полный effective access по тарифу;
  - отдельно видит источник каждого grant;
  - отдельно видит legacy/fallback;
  - отдельно видит победителя конфликта;
  - если runtime-support отсутствует — UI явно это показывает;
  - для CHAT/BUSINESS есть доказуемый explain-блок с источником и сроком.
  &nbsp;
- Нужны proof-артефакты:
  &nbsp;
  - UI screenshot/recording,
  - данные до/после,
  - сценарии product-level vs tariff-level vs legacy overlap.
  &nbsp;

&nbsp;

&nbsp;

&nbsp;

12. **Нужен deferred/follow-up блок**

&nbsp;

&nbsp;

&nbsp;

- То, чего сейчас реально нет в runtime:
  &nbsp;
  - часть продукта
  - часть тренинга
  - урок
  - полноценный domain/section registry
  &nbsp;
- Если это не входит в текущий безопасный scope, вынеси в отдельный follow-up sprint, но не маскируй как уже реализованное в v23.1.

&nbsp;

&nbsp;

&nbsp;

13. **Обязательный итоговый rewrite структуры плана**

&nbsp;

&nbsp;

&nbsp;

- Пересобери план в таком порядке:
  &nbsp;
  1. Phase 0 — discovery / source-of-truth audit
  2. Phase 1 — UI taxonomy + mapping matrix
  3. Phase 2 — form redesign + selectors
  4. Phase 3 — effective preview / explain / source resolution
  5. Phase 4 — legacy/fallback visibility + conflict states
  6. Phase 5 — duration model
  7. Phase 6 — advanced/settings cleanup
  8. DoD + proof
  9. Deferred follow-up scope
  &nbsp;

&nbsp;

&nbsp;

После этого план станет согласуемым.

&nbsp;

План: v23.1 — Access Rules UI completion

## Цель

Довести вкладку «Доступы» до полноценного админского интерфейса, где видно бизнес-смысл: что именно получит покупатель при покупке продукта/тарифа.

---

## Что меняем

### 1. Русификация типов выдачи + расширение модели

Текущие 4 типа (`entitlement`, `club`, `email`, `product_access`) остаются в БД как есть — они покрывают все реальные runtime-пути. В UI показываем человекопонятные русские названия:


| DB value         | UI-название                         | Описание                                       |
| ---------------- | ----------------------------------- | ---------------------------------------------- |
| `club`           | Доступ в Telegram-клуб              | Селект клуба из `telegram_clubs`               |
| `product_access` | Доступ к продукту                   | Селект продукта из `products_v2`               |
| `email`          | Доступ к домену / разделу платформы | Селект из `email_accounts` с бизнес-названиями |
| `entitlement`    | Системное право доступа (advanced)  | Селект из справочника `product_code`           |


Не добавляем новые `grant_target_type` в БД — нет реальных runtime-обработчиков для «части продукта», «урока», «тренинга». Эти сценарии реализуемы через `product_access` (выбор конкретного продукта/модуля) или `entitlement` (системный код). Расширение типов — follow-up после появления runtime-поддержки.

### 2. Поле «Цель» → связанные селекторы

Заменить `<Input>` на динамические `<Select>` / `<Combobox>` для каждого типа:

- **club**: список `telegram_clubs` (уже есть), добавить отображение chat/channel/chat+channel
- **product_access**: список `products_v2` (name), target_ref = product id
- **email**: список `email_accounts`, показывать бизнес-название
- **entitlement**: список уникальных `product_code` из `entitlements` + из `products_v2.code`

Полностью убрать ручной ввод ID/slug как основной способ.

### 3. Блок «Назначение правила»

Добавить поле `rule_purpose` в `conditions` JSON (без миграции БД):

- Основной доступ
- Бонус
- Дополнительный доступ
- Служебное правило

Показывать badge в списке и preview.

### 4. Модель срока доступа

Заменить сырое `duration_days` input на:

- Переключатель: «По умолчанию из тарифа» / «Задать вручную»
- Если вручную: дни или месяцы + быстрые пресеты (7/14/30/60/90/180/365 дней, 1/2/3/6/12 мес)
- В preview показывать итоговый срок и источник (тариф `access_days` / правило)

Загружать `access_days` из `tariffs` для показа дефолта.

### 5. Preview / Explain — полный редизайн

Для каждого тарифа показывать:

- Карточки: «Покупатель получит:»
- Каждый grant: иконка + бизнес-название + срок + источник (Правило / Legacy / Fallback)
- Для клубов: показывать чат/канал/чат+канал
- Для legacy: явный маркер и пояснение

Добавить `duration_days` и `rule_purpose` в `useEffectiveGrants` результат.

### 6. Legacy блок — всегда видимый

Убрать Collapsible для legacy. Сделать отдельную секцию «Действующие legacy-настройки», всегда раскрытую если есть mappings:

- Источник (product_club_mappings / product_email_mappings)
- Статус: активен / неактивен
- Миграция: перенесено в rules / ещё нет
- Участвует ли в effective preview

### 7. Форма — пошаговая структура

Переорганизовать Dialog в логические секции:

1. **Где действует** — область (продукт/тариф) + выбор тарифа
2. **Что выдаём** — тип выдачи (русские названия)
3. **Куда выдаём** — связанный селектор цели
4. **Назначение** — основной/бонус/дополнительный/служебный
5. **Срок** — из тарифа или вручную + пресеты
6. **Дополнительно** (collapsed) — приоритет, заметка, активность

### 8. Конфликтные состояния

- Дублирование с legacy → badge «Дублирует legacy»
- Product + tariff level одна цель → показать effective winner
- Inactive rule + active legacy fallback → предупреждение

### 9. Список правил — читаемые карточки

В каждой карточке правила показывать без открытия диалога:

- Тип (русский) + иконка
- Цель (бизнес-название)
- Область (продукт/тариф)
- Назначение (основной/бонус)
- Срок
- Источник (rule/legacy)
- Статус

---

## Что НЕ меняем

- Схему БД `access_rules` — используем `conditions` JSON для `rule_purpose`
- Новые `grant_target_type` в БД — нет runtime-обработчиков
- Backend edge functions
- Legacy таблицы

## Файлы


| Файл                                                     | Действие                                                                                                   |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `src/components/admin/product/ProductAccessRulesTab.tsx` | Полная переработка (~625 → ~800 строк)                                                                     |
| `src/hooks/useAccessRules.ts`                            | Добавить `duration_days`, `rule_purpose` в effective grants; загрузка products/entitlements для селекторов |


## DoD

1. Все тексты на русском, без технических ID/slug в основном UX
2. Для 4 типов — связанные селекторы
3. Для клубов видно чат/канал
4. Срок: из тарифа / вручную / пресеты
5. Назначение правила: основной/бонус/доп/служебный
6. Preview отвечает на «что получит покупатель тарифа CHAT/BUSINESS»
7. Legacy видны без скрытия, с маркерами миграции
8. Priority скрыт в advanced
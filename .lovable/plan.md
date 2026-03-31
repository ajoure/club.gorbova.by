# да, согласен, с учетом правок:

&nbsp;

1. Правильно, что ты **исправил опору на memory** и явно зафиксировал: access_links и projection function **сейчас не существуют в коде**. Это важно. Нельзя строить текущий correction plan так, будто canonical SoT уже реализован.
2. В discovery добавь ещё один явный вывод:
  &nbsp;
  - после PATCH v23.1.5 training read-path уже стал **гибридным**:
    &nbsp;
    - module_access + subscriptions_v2
    - плюс entitlements
    &nbsp;
  - а training write-path остался прямым в module_access.
  - Это нужно прямо назвать **частично смешанной моделью**, потому что риск теперь не только в дубле, но и в частично разъехавшихся чтении и записи.
  &nbsp;
3. В блоке про UI-fix CompactAccessSelector добавь обязательный proof записи:
  &nbsp;
  - после выбора продукта в dropdown и сохранения модуля показать, что запись действительно уходит в module_access.
  - Это пригодится как доказательство текущего старого write-path перед переходом к v23.1.6.
  &nbsp;
4. В correction plan для v23.1.6 не фиксируй пока жёстко только access_links.
  &nbsp;
  - Так как discovery показал, что этой таблицы нет, формулируй аккуратнее:
    &nbsp;
    - сначала выбрать и спроектировать canonical SoT;
    - это может быть новая таблица access_links
    - или расширение существующей модели, если это окажется безопаснее.
    &nbsp;
  - То есть в v23.1.6 сначала schema/write-path design, потом migration path.
  &nbsp;
5. Добавь в plan для v23.1.6 отдельный discovery-пункт:
  &nbsp;
  - как маппится:
    &nbsp;
    - product
    - tariff
    - training module
    - lesson/container
    &nbsp;
  - потому что без этого нельзя корректно построить projection/write-path alignment.
  - Особенно важно понять, как из продуктовой настройки однозначно получить тренировочную проекцию доступа.
  &nbsp;
6. В risk statement усили формулировку:
  &nbsp;
  - сейчас админ может настроить доступ в одном месте и не увидеть идентичного состояния в другом;
  - после v23.1.5 это может выглядеть как “частично работает”, что ещё опаснее полного рассинхрона.
  - Это надо подчеркнуть как бизнес-риск неправильной выдачи доступа.
  &nbsp;
7. В DoD добавь ещё один пункт:
  &nbsp;
  - подтверждено, что CompactAccessSelector **не использует** продуктовый access_rules write-path и пишет напрямую в module_access.
  - Это ключевой факт discovery.
  &nbsp;
8. Scope exclusion хороший, но добавь отдельно:
  &nbsp;
  - не делать в этом патче никакой скрытой синхронизации между module_access и access_rules;
  - только UI-fix + фиксация фактической архитектуры + подготовка следующего патча.
  &nbsp;
9. Итоговый смысл патча сформулируй так:
  &nbsp;
  - сейчас чиним dropdown тренингов;
  - параллельно **доказываем**, что продуктовый и тренировочный доступ — это не один SoT;
  - и готовим отдельный архитектурный патч v23.1.6 на выравнивание write-path, а не пытаемся чинить это незаметно в рамках UI-фикса.
  &nbsp;

&nbsp;

&nbsp;

План: PATCH v23.1.5A — Training access dropdown UI fix + SoT discovery

## Критический architectural gap (обновлённый)

### Текущее фактическое состояние (не целевое, не из memory — из кода)

```text
ЭКРАН ТРЕНИНГА ("Доступ к контенту" / CompactAccessSelector):
  WRITE: AdminTrainingModules / ContentCreationWizard
         → supabase.from("module_access").delete() + .insert()
         → ПРЯМАЯ ЗАПИСЬ в module_access
  READ:  useTrainingModules → module_access + subscriptions_v2
         + (после v23.1.5) entitlements

ЭКРАН ПРОДУКТА ("Access Rules" / ProductAccessRulesTab):
  WRITE: useAccessRules → access_rules
  READ:  grant-access-for-order → access_rules → entitlements
         → (после v23.1.5) useTrainingModules читает entitlements
```

### Частично смешанная модель (после PATCH v23.1.5)

Это опаснее обычного дублирования:

- **Training read-path** уже частично новый — читает и `module_access`, и `entitlements`
- **Training write-path** всё ещё старый — пишет напрямую в `module_access`
- **Product write-path** — пишет в `access_rules`, runtime пишет в `entitlements`
- Между `module_access` и `entitlements` **нет автоматической синхронизации write-path**

### Risk statement

Пока тренинговый UI пишет напрямую в `module_access`, а продуктовый UI — в `access_rules`, админ может получить **два разных результата** при настройке одного и того же доступа в разных местах. Это не просто технический gap, а **реальный риск неконсистентной настройки доступа**.

### Критическое уточнение по correction plan

Discovery показал: `**access_links` таблица и SECURITY DEFINER projection function НЕ существуют в коде**. Memory описывает целевую архитектуру, но она ещё не реализована:

- Нет таблицы `access_links`
- Нет REVOKE на `module_access`
- Нет projection function
- `module_access` по-прежнему доступна для прямой записи

Это значит, что canonical write-path через `access_links` **ещё предстоит создать**, а не просто "переключить тренинговый UI на него".

---

## Что делаем в этом патче

### Часть 1: UI-fix CompactAccessSelector

**Файл**: `src/components/admin/trainings/CompactAccessSelector.tsx`

1. **Scroll fix**: `<ScrollArea className="max-h-[300px]">` → `<div className="max-h-[300px] overflow-y-auto">`
2. **Поиск**: добавить input с фильтрацией по `product.name` в header popover
3. **Удалить** неиспользуемый import `ScrollArea`, `HoverCard*`

### Часть 2: Зафиксировать architectural gap

Явно задокументировать:


| &nbsp;              | Экран тренинга                                        | Экран продукта          |
| ------------------- | ----------------------------------------------------- | ----------------------- |
| UI компонент        | `CompactAccessSelector`                               | `ProductAccessRulesTab` |
| Таблица записи      | `module_access` (прямая)                              | `access_rules`          |
| Runtime запись      | —                                                     | `entitlements`          |
| Read path           | `module_access` + `subscriptions_v2` + `entitlements` | `entitlements`          |
| Синхронизация write | **НЕТ**                                               | **НЕТ**                 |


Подтверждено:

- Пишут в **разные таблицы**
- Читаются **разными путями** (частично пересекаются после v23.1.5)
- Между ними **нет автоматической синхронизации write-path**

### Часть 3: Correction plan → PATCH v23.1.6

**PATCH v23.1.6 — Training access write-path alignment to canonical SoT**

Целевое состояние:

- `access_links` (или `access_rules`) = единый SoT для write
- `module_access` = read-only projection, обновляется только через SECURITY DEFINER function
- Тренинговый UI переключается на запись через canonical path
- Прямая запись в `module_access` блокируется (REVOKE)

Предварительные шаги v23.1.6:

1. Создать таблицу `access_links` (если не существует) или определить, достаточно ли `access_rules`
2. Создать SECURITY DEFINER projection function `access_links → module_access`
3. REVOKE INSERT/UPDATE/DELETE на `module_access` для runtime-ролей
4. Переключить `AdminTrainingModules`, `ContentCreationWizard`, `ContentSectionSelector` на canonical write path
5. Проверить `training-copy-move` edge function

**Важно**: v23.1.6 требует отдельного discovery по точной схеме `access_links` и маппингу `tariff_id → product → module`. Не реализовывать в этом патче.

---

## Файлы (этот патч)


| Файл                        | Изменения                                                 |
| --------------------------- | --------------------------------------------------------- |
| `CompactAccessSelector.tsx` | ScrollArea → div overflow-y-auto, +поиск, -unused imports |


## Scope exclusion

- **Не менять** runtime entitlements sync из v23.1.5
- **Не менять** `grant-access-for-order`
- **Не менять** `access_rules` / product access rules
- **Не менять** логику тренинговой записи в `module_access` — только UI-fix + discovery + correction plan
- Выравнивание write-path = отдельный PATCH v23.1.6

## DoD

1. Dropdown «Доступ к контенту» скроллится нормально
2. Все продукты видны и доступны для выбора
3. Есть поиск по названию продукта
4. Подтверждено: тренинговый и продуктовый доступы **пишут в разные таблицы** (`module_access` vs `access_rules`)
5. Подтверждено: **читаются разными путями** (частично пересекаются после v23.1.5)
6. Подтверждено: между ними **нет автоматической синхронизации write-path**
7. Зафиксирован correction plan: **PATCH v23.1.6 — Training access write-path alignment to canonical SoT**
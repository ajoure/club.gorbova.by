# PATCH v23.1.5A — Training access dropdown UI fix + SoT discovery

## Статус: ВЫПОЛНЕН (UI-fix) + DISCOVERY ЗАФИКСИРОВАН

## Критический architectural gap

### Текущее фактическое состояние (из кода, не из memory)

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

- **Training read-path** уже гибридный — читает `module_access` + `subscriptions_v2` + `entitlements`
- **Training write-path** всё ещё старый — пишет напрямую в `module_access`
- **Product write-path** — пишет в `access_rules`, runtime → `entitlements`
- Между `module_access` и `entitlements` **нет автоматической синхронизации write-path**

### Risk statement

Админ может настроить доступ в одном месте и не увидеть идентичного состояния в другом. После v23.1.5 это может выглядеть как "частично работает", что ещё опаснее полного рассинхрона — **реальный бизнес-риск неконсистентной настройки и выдачи доступа**.

### Критическое уточнение

`access_links` таблица и SECURITY DEFINER projection function **НЕ существуют в коде**. Memory описывает целевую архитектуру, но она ещё не реализована. Canonical write-path **ещё предстоит создать**.

### Discovery: write-path / read-path comparison

| | Экран тренинга | Экран продукта |
|---|---|---|
| UI компонент | `CompactAccessSelector` | `ProductAccessRulesTab` |
| Таблица записи | `module_access` (прямая) | `access_rules` |
| Runtime запись | — | `entitlements` |
| Read path | `module_access` + `subscriptions_v2` + `entitlements` | `entitlements` |
| Синхронизация write | **НЕТ** | **НЕТ** |

Подтверждено:
1. Пишут в **разные таблицы** (`module_access` vs `access_rules`)
2. Читаются **разными путями** (частично пересекаются после v23.1.5)
3. Между ними **нет автоматической синхронизации write-path**
4. CompactAccessSelector **не использует** продуктовый access_rules write-path

---

## Выполненные изменения

### UI-fix CompactAccessSelector

**Файл**: `src/components/admin/trainings/CompactAccessSelector.tsx`

1. ✅ **Scroll fix**: `ScrollArea` → `div className="max-h-[300px] overflow-y-auto"`
2. ✅ **Поиск**: input с фильтрацией по `product.name`
3. ✅ **Удалены** неиспользуемые imports: `ScrollArea`, `HoverCard*`

---

## Следующий патч: PATCH v23.1.6

**PATCH v23.1.6 — Training access write-path alignment to canonical SoT**

### Discovery (обязательный первый шаг v23.1.6)

1. Спроектировать canonical SoT (новая `access_links` или расширение `access_rules`)
2. Определить маппинг: product → tariff → training module → lesson/container
3. Понять, как из продуктовой настройки однозначно получить тренировочную проекцию доступа

### Целевое состояние

- Единый SoT для write (canonical path)
- `module_access` = read-only projection через SECURITY DEFINER function
- Тренинговый UI переключается на canonical write path
- Прямая запись в `module_access` блокируется (REVOKE)

### Предварительные шаги

1. Schema/write-path design для canonical SoT
2. Создать projection function → `module_access`
3. REVOKE INSERT/UPDATE/DELETE на `module_access` для runtime-ролей
4. Переключить `AdminTrainingModules`, `ContentCreationWizard`, `ContentSectionSelector`
5. Проверить `training-copy-move` edge function

---

## DoD (v23.1.5A)

1. ✅ Dropdown «Доступ к контенту» скроллится нормально
2. ✅ Все продукты видны и доступны для выбора
3. ✅ Есть поиск по названию продукта
4. ✅ Подтверждено: пишут в **разные таблицы** (`module_access` vs `access_rules`)
5. ✅ Подтверждено: читаются **разными путями**
6. ✅ Подтверждено: **нет автоматической синхронизации write-path**
7. ✅ Подтверждено: CompactAccessSelector **не использует** access_rules write-path
8. ✅ Зафиксирован correction plan: **PATCH v23.1.6**

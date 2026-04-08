# да, согласен, с учетом правок:

&nbsp;

1. В п.5 про orphan rules нельзя использовать прямой target_ref::uuid без guard-а.
  Если в target_ref попадёт невалидная строка, diagnostic/RPC упадёт.
  Нужно зафиксировать safe-cast:
  &nbsp;
  - либо regex на UUID перед cast;
  - либо отдельную helper-функцию safe_uuid(text).
  &nbsp;
2. В п.9 у тебя одновременно написано LANGUAGE sql и логика с IF ... THEN RETURN.
  Это несовместимо.
  Нужно заранее выбрать одно:
  &nbsp;
  - либо LANGUAGE plpgsql с явным guard;
  - либо оставить LANGUAGE sql, но тогда guard реализовать через WHERE/CTE без IF.
  &nbsp;
3. В RPC лучше не доверять входному p_user_id как основному источнику.
  Безопаснее зафиксировать:
  &nbsp;
  - для обычного пользователя RPC всегда считает доступ по auth.uid();
  - p_user_id используется только для admin-режима диагностики;
  - иначе легко получить лишнюю сложность и риск проверки “чужого” пользователя.
  &nbsp;
4. В compatibility checklist добавь отдельный proof по legacy email:
  &nbsp;
  - UI для типа email по-прежнему открывается и сохраняется как раньше;
  - никаких авто-миграций email → section_access не происходит.
    Это важно, раз ты сознательно оставляешь email в CHECK и union.
  &nbsp;
5. В staged rollout добавь явный пункт, что для этапа 2 сначала включается **одна** тестовая секция и только после proof:
  &nbsp;
  - sidebar lock,
  - SectionGuard,
  - direct URL deny/paywall,
  - admin bypass,
  - rollback через is_public=true.
    Потом уже остальные секции.
  &nbsp;
6. В DoD добавь proof на malformed data-case:
  &nbsp;
  - rule с grant_target_type='section_access', но target_ref не UUID;
  - система не падает;
  - rule игнорируется;
  - в админке виден warning.
  &nbsp;
7. В блоке кэширования полезно зафиксировать инвалидацию:
  &nbsp;
  - после create/edit/deactivate section_access rule;
  - после изменения app_[sections.is](http://sections.is)_public;
  - после logout/login.
    Иначе sidebar и guard могут совпадать между собой, но оставаться устаревшими.
  &nbsp;
8. В п.4 по CRUD добавь, что route тоже лучше делать immutable после создания, либо редактируемым только супер-админом.
  Иначе можно случайно “перевесить” существующее правило на другой экран через смену route без изменения code.
9. В разделе page-level layering отдельно зафиксируй:
  live как section_access может закрывать вход в раздел целиком, но НЕ заменяет live_event_access_rules.
  Это нужно явно оставить в финальном discovery, чтобы не было ложного ожидания, что section_access управляет доступом к конкретным эфирам.
10. Структурное требование правильное.
  В следующей версии документов лучше ещё явно разделить:

&nbsp;

&nbsp;

&nbsp;

- **proof/facts**
- **assumptions/decisions**
  чтобы discovery и архитектурные решения не смешивались даже внутри одного документа.

&nbsp;

&nbsp;

Дополненный план: section_access — 10 правок

---

## 1. RPC resolver: product_id + tariff_id — устранение неоднозначности

**Проблема:** текущая формулировка допускает OR-логику при наличии обоих полей, что может привести к overgrant.

**Фиксированное правило:**

```text
Если в access_rule заданы оба поля (product_id + tariff_id):
  → tariff_id является единственным критерием проверки доступа
  → product_id используется ТОЛЬКО как контекст для лейбла/paywall текста
  → проверка: subscriptions_v2 WHERE tariff_id = rule.tariff_id AND status IN ('active','trial')
  → entitlements НЕ проверяются для tariff-level rules

Если задан только product_id (tariff_id IS NULL):
  → проверка: subscriptions_v2 WHERE product_id = rule.product_id AND status IN ('active','trial')
  → ИЛИ entitlements WHERE product_id = rule.product_id AND status = 'active'

Обоснование: tariff-level rule — это подписочный доступ; entitlements могут
содержать исторические/бонусные записи без актуальной подписки на конкретный тариф.
```

---

## 2. Tariff-level: только subscriptions_v2, без entitlements

```text
ПРАВИЛО SOURCE OF TRUTH для section_access:

tariff-level rule (tariff_id заполнен):
  SoT = subscriptions_v2.tariff_id + status IN ('active','trial')
  entitlements НЕ являются равнозначным источником

product-level rule (только product_id):
  SoT = subscriptions_v2.product_id + status IN ('active','trial')
       ИЛИ entitlements.product_id + status = 'active'

Это согласовано с memory/architecture/access-control/club-product-sot:
"для подписочных продуктов SoT = subscriptions_v2, не entitlements"
```

---

## 3. Admin bypass — в DoD/proof

Добавить в DoD:

```text
13. Admin bypass: admin user открывает gated section (is_public=false)
    даже без section_access rules → has_access=true
14. Sidebar для admin: НЕ показывает lock-иконку на gated sections
    (admin всегда видит обычный стиль пункта меню)
```

В RPC `get_user_section_access`:

```text
Шаг 0 (до проверки правил):
  IF has_role_v2(p_user_id, 'admin') → все секции has_access=true
  Выход из функции без JOIN на access_rules/subscriptions
```

---

## 4. AppSectionsAdmin — ограничения CRUD

```text
Правила управления app_sections:

1. code — immutable после создания (disabled в форме редактирования)
   Исключение: super_admin может редактировать code
2. code + route — UNIQUE constraint (уже в DDL), валидация на frontend
3. Деактивация секции (is_active=false):
   → проверить: SELECT count(*) FROM access_rules
     WHERE grant_target_type='section_access' AND target_ref=section.id AND is_active=true
   → если count > 0: показать warning dialog
     "На эту секцию ссылаются {N} активных правил.
      Деактивация сделает эти правила неэффективными. Продолжить?"
   → подтверждение обязательно
4. Удаление секции: запрещено (только деактивация)
```

---

## 5. Orphan rules — proof и поведение resolver

```text
Diagnostic SQL (dry-run):
  SELECT ar.id, ar.target_ref, ar.target_label
  FROM access_rules ar
  WHERE ar.grant_target_type = 'section_access'
    AND NOT EXISTS (
      SELECT 1 FROM app_sections s WHERE s.id = ar.target_ref::uuid
    );

Поведение resolver:
  - orphan rules (target_ref не найден в app_sections) → ИГНОРИРУЮТСЯ
  - в результате RPC такие секции не появляются
  - в админке: orphan rules помечаются badge "⚠ секция не найдена"

DoD:
  15. Orphan proof: создать rule с target_ref на несуществующий UUID
      → RPC возвращает результат без этой секции
      → админка показывает warning badge
```

---

## 6. Кэширование sidebar + SectionGuard

```text
ПРАВИЛО ЕДИНОГО КЭША:

Hook: useSectionAccess()
  queryKey: ['section-access', userId]
  staleTime: 60_000 (1 мин)
  gcTime: 300_000 (5 мин)

Sidebar: вызывает useSectionAccess() → рендерит lock/unlock
SectionGuard: вызывает useSectionAccess() → тот же кэш (react-query dedup)
Paywall overlay: читает из того же result

Гарантия: один RPC-вызов, один кэш, один TTL.
Sidebar и SectionGuard НИКОГДА не могут разойтись по данным.
```

---

## 7. Fallback при ошибке RPC — жёсткое разделение

```text
Hidden rollout (этап 1, все секции is_public=true):
  RPC error → default allow
  Обоснование: все секции public, ошибка не может открыть закрытое

Visible rollout (этап 2+, есть секции с is_public=false):
  RPC error для is_public=true секции → allow
  RPC error для is_public=false секции → default DENY + error UI:
    "Не удалось проверить доступ к разделу. Обновите страницу."
    + кнопка "Обновить"
  НЕ молчаливый allow — это high-risk, ошибка resolver
  не должна открывать закрытый контент

Kill-switch (SECTION_GATING_ENABLED=false):
  → все проверки возвращают allow, как будто gating выключен
```

---

## 8. DoD — proof по существующим страницам

```text
16. Money.tsx: страница открывается как раньше при is_public=true;
    внутренняя проверка buh_business tab-контента работает без изменений
17. LiveEvents.tsx: per-event access через live_event_access_rules не затронут
18. Knowledge/Products: module visibility через useSidebarModules не изменилась
19. Создание/редактирование существующего club rule через UI — работает
20. Создание/редактирование training_content rule — работает
21. section_access selector не ломает форму для других типов правил
```

---

## 9. RPC: SECURITY DEFINER + список читаемых таблиц

```text
get_user_section_access(p_user_id uuid):
  LANGUAGE sql STABLE
  SECURITY DEFINER
  SET search_path = public

Читает таблицы:
  - app_sections (SELECT: id, code, label, route, is_public, is_active)
  - access_rules (SELECT: target_ref, product_id, tariff_id, is_active,
    grant_target_type)
  - subscriptions_v2 (SELECT: user_id, product_id, tariff_id, status)
  - entitlements (SELECT: user_id, product_id, status)
  - user_roles_v2 (через has_role_v2 для admin bypass)

SECURITY DEFINER обоснование:
  - RLS на access_rules/subscriptions_v2 может ограничить чтение чужих данных
  - RPC вызывается от имени текущего пользователя, но проверяет
    только свои данные (p_user_id = auth.uid())
  - Внутри RPC добавить guard: IF p_user_id != auth.uid()
    AND NOT has_role_v2(auth.uid(), 'admin') THEN RETURN empty

Proof перед внедрением:
  - Вызвать RPC с тестовым user_id → убедиться, что RLS не блокирует
  - Вызвать RPC от non-admin с чужим user_id → пустой результат
```

---

## 10. Final gate — compatibility checklist

```text
Перед переходом к коду (после discovery, перед implementation):

COMPATIBILITY CHECKLIST:
  □ 34 существующих правила: count не изменился
  □ CREATE club rule через UI → успешно сохраняется
  □ CREATE product_access rule через UI → успешно сохраняется
  □ CREATE training_content rule через UI → успешно сохраняется
  □ EDIT существующего правила → форма открывается, сохраняется
  □ section_access selector: при выборе другого типа (club/product_access)
    селектор секций скрывается, форма не ломается
  □ 0 legacy email mappings: count не изменился
  □ getRuntimeSupport для существующих типов: значения не изменились
```

---

## СТРУКТУРНОЕ ТРЕБОВАНИЕ

Следующее сообщение с реализацией должно быть формально разделено на два документа:

1. **Отчёт о Discovery: section_access** — факты, proof, schema, usage, риски
2. **План: безопасное добавление section_access** — DDL, файлы, этапы, DoD

Без смешивания. Переход к коду — только после утверждения обоих документов.
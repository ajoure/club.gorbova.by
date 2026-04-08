# План: безопасное добавление section_access

Дата: 2026-04-08
Зависит от: `docs/section-access/01-discovery-report.md`

---

## 1. DDL

### 1.1. CREATE TABLE app_sections

```sql
CREATE TABLE public.app_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  label text NOT NULL,
  icon text,
  route text UNIQUE NOT NULL,
  is_public boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_app_sections_active ON public.app_sections (is_active, sort_order);
```

### 1.2. RLS для app_sections

```sql
ALTER TABLE public.app_sections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read active or admins read all"
  ON public.app_sections FOR SELECT TO authenticated
  USING (is_active = true OR public.has_role_v2(auth.uid(), 'admin'));

CREATE POLICY "Admins manage sections"
  ON public.app_sections FOR ALL TO authenticated
  USING (public.has_role_v2(auth.uid(), 'admin'))
  WITH CHECK (public.has_role_v2(auth.uid(), 'admin'));
```

### 1.3. Seed (все is_public=true)

| code | label | icon | route | is_public | sort_order |
|------|-------|------|-------|-----------|------------|
| dashboard | Пульс | Activity | /dashboard | true | 0 |
| knowledge | База знаний | BookOpen | /knowledge | true | 1 |
| money | Деньги | Wallet | /money | true | 2 |
| self_development | Саморазвитие | Sparkles | /self-development | true | 3 |
| ai | Нейросеть | Cpu | /ai | true | 4 |
| live | Эфиры | Radio | /live | true | 5 |
| products | Обучение | GraduationCap | /products | true | 6 |
| eisenhower | Матрица продуктивности | LayoutGrid | /tools/eisenhower | true | 7 |

**Правило rollout:** После миграции ни одно поведение пользователя не меняется до первого ручного UPDATE is_public=false.

### 1.4. ALTER CHECK constraint (add-only)

```sql
ALTER TABLE public.access_rules
  DROP CONSTRAINT access_rules_grant_target_type_check;

ALTER TABLE public.access_rules
  ADD CONSTRAINT access_rules_grant_target_type_check
  CHECK (grant_target_type = ANY (ARRAY[
    'entitlement','club','email','product_access','training_content','section_access'
  ]));
```

**SQL-proof после ALTER (обязателен):**
```sql
-- Тест 1: section_access проходит
INSERT INTO access_rules (product_id, grant_target_type, target_ref, target_label)
  VALUES ('<test_product_id>', 'section_access', '<test_section_id>', 'test')
  RETURNING id;
-- Удалить тестовую запись

-- Тест 2: club по-прежнему проходит
INSERT INTO access_rules (product_id, grant_target_type, target_ref, target_label)
  VALUES ('<test_product_id>', 'club', 'test_ref', 'test')
  RETURNING id;
-- Удалить тестовую запись
```

### 1.5. RPC get_user_section_access

```sql
CREATE OR REPLACE FUNCTION public.get_user_section_access(p_user_id uuid DEFAULT NULL)
RETURNS TABLE (
  section_id uuid,
  section_code text,
  section_label text,
  section_route text,
  has_access boolean,
  is_public boolean,
  granted_via_product_id uuid,
  granted_via_product_name text,
  granted_via_tariff_id uuid,
  granted_via_tariff_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_effective_uid uuid;
  v_is_admin boolean;
  v_caller_uid uuid;
BEGIN
  -- Early return: unauthenticated caller
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN
    RETURN; -- empty result set
  END IF;

  -- Auth guard: non-admin always resolves own access
  v_is_admin := public.has_role_v2(v_caller_uid, 'admin');
  IF v_is_admin AND p_user_id IS NOT NULL THEN
    v_effective_uid := p_user_id;
  ELSE
    v_effective_uid := v_caller_uid;
  END IF;

  -- Admin bypass: all sections accessible
  IF public.has_role_v2(v_effective_uid, 'admin') THEN
    RETURN QUERY
      SELECT s.id, s.code, s.label, s.route,
             true::boolean AS has_access,
             s.is_public,
             NULL::uuid, NULL::text, NULL::uuid, NULL::text
      FROM app_sections s
      WHERE s.is_active = true
      ORDER BY s.sort_order;
    RETURN;
  END IF;

  -- Regular user resolution
  RETURN QUERY
  WITH section_rules AS (
    SELECT
      s.id AS sid, s.code, s.label, s.route, s.is_public, s.sort_order,
      ar.product_id AS rule_product_id,
      ar.tariff_id AS rule_tariff_id,
      p.name AS product_name,
      t.name AS tariff_name
    FROM app_sections s
    LEFT JOIN access_rules ar
      ON ar.grant_target_type = 'section_access'
      AND ar.is_active = true
      AND ar.target_ref IS NOT NULL
      AND ar.target_ref ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND ar.target_ref::uuid = s.id
    LEFT JOIN products_v2 p ON p.id = ar.product_id
    LEFT JOIN tariffs t ON t.id = ar.tariff_id
    WHERE s.is_active = true
  ),
  user_subs AS (
    SELECT sub.tariff_id, sub.product_id
    FROM subscriptions_v2 sub
    WHERE sub.user_id = v_effective_uid AND sub.status IN ('active', 'trial')
  ),
  user_ents AS (
    SELECT ent.product_id
    FROM entitlements ent
    WHERE ent.user_id = v_effective_uid AND ent.status = 'active'
  ),
  resolved AS (
    SELECT
      sr.sid, sr.code, sr.label, sr.route, sr.is_public, sr.sort_order,
      sr.rule_product_id, sr.product_name, sr.rule_tariff_id, sr.tariff_name,
      CASE
        WHEN sr.is_public THEN true
        WHEN sr.rule_tariff_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM user_subs us WHERE us.tariff_id = sr.rule_tariff_id)
          THEN true
        WHEN sr.rule_tariff_id IS NULL AND sr.rule_product_id IS NOT NULL
          AND (
            EXISTS (SELECT 1 FROM user_subs us WHERE us.product_id = sr.rule_product_id)
            OR EXISTS (SELECT 1 FROM user_ents ue WHERE ue.product_id = sr.rule_product_id)
          ) THEN true
        ELSE false
      END AS access_granted,
      ROW_NUMBER() OVER (
        PARTITION BY sr.sid
        ORDER BY
          CASE WHEN sr.rule_tariff_id IS NOT NULL THEN 0 ELSE 1 END,
          sr.rule_product_id NULLS LAST
      ) AS rn
    FROM section_rules sr
  )
  SELECT
    r.sid, r.code, r.label, r.route,
    bool_or(r.access_granted) AS has_access,
    r.is_public,
    (ARRAY_AGG(r.rule_product_id ORDER BY r.rn) FILTER (WHERE r.access_granted))[1],
    (ARRAY_AGG(r.product_name ORDER BY r.rn) FILTER (WHERE r.access_granted))[1],
    (ARRAY_AGG(r.rule_tariff_id ORDER BY r.rn) FILTER (WHERE r.access_granted))[1],
    (ARRAY_AGG(r.tariff_name ORDER BY r.rn) FILTER (WHERE r.access_granted))[1]
  FROM resolved r
  GROUP BY r.sid, r.code, r.label, r.route, r.is_public, r.sort_order
  ORDER BY r.sort_order;
END;
$$;
```

**Ключевые решения:**
- LANGUAGE plpgsql (не sql) — для IF-guard и early return
- SECURITY DEFINER — bypass RLS на subscriptions/entitlements
- auth.uid() IS NULL → early return (пустой массив)
- non-admin → auth.uid(), admin → p_user_id
- safe UUID: regex `^[0-9a-f]{8}-...` перед cast
- tariff_id приоритет над product_id

**Читаемые таблицы:** app_sections, access_rules, products_v2, tariffs, subscriptions_v2, entitlements, user_roles_v2 (через has_role_v2)

---

## 2. Файлы изменений

### Этап 1: Инфраструктура (hidden rollout)

| Файл | Действие |
|------|----------|
| SQL migration | CREATE TABLE app_sections + seed + RLS |
| SQL migration | ALTER CHECK constraint (add section_access) |
| SQL migration | CREATE FUNCTION get_user_section_access |
| `src/hooks/useAccessRules.ts` | Добавить `section_access` в GrantTargetType union |
| `src/hooks/useAccessRules.ts` | getRuntimeSupport('section_access') = **"partial"** |
| `src/components/admin/product/ProductAccessRulesTab.tsx` | Добавить section_access в TARGET_TYPE_LABELS, TARGET_TYPE_ICONS, убрать из фильтра скрытия |
| `src/hooks/useAccessRuleSelectors.ts` | Добавить useAvailableSections() — dropdown из app_sections |
| `src/components/admin/product/ProductAccessRulesTab.tsx` | Селектор из app_sections для типа section_access |

### Этап 2: Visible rollout (одна тестовая секция — eisenhower)

| Файл | Действие |
|------|----------|
| `src/hooks/useSectionAccess.ts` | Новый hook — вызывает RPC, кэш queryKey=['section-access', userId], staleTime=60s |
| `src/components/layout/SectionGuard.tsx` | Wrapper: paywall/error overlay |
| `src/components/layout/AppSidebar.tsx` | Lock-иконка для gated (visual only, admin bypass) |
| Route config | SectionGuard обёртка для eisenhower route |

### Этап 2b: Остальные секции (после proof этапа 2)

| Файл | Действие |
|------|----------|
| Route config | SectionGuard для ai, self_development и др. |
| `src/hooks/useAccessRules.ts` | getRuntimeSupport('section_access') = **"full"** |

### Этап 0 (до кода): Документация

| Файл | Действие |
|------|----------|
| `docs/section-access/01-discovery-report.md` | Создан |
| `docs/section-access/02-implementation-plan.md` | Создан |

---

## 3. Scope ограничения (STOP-guards)

**НЕ затрагиваются в этом спринте:**
- rules-retroapply — без изменений
- grant-access-for-order — без изменений
- access-resolver.ts — без изменений
- fulfillment pipeline — без изменений
- subscriptions_v2, entitlements — структура не меняется

**Staged rollout STOP-guards:**
- money и live **ЗАПРЕЩЕНО** включать в этапе 2 (gated mode) — у них уже есть внутренняя логика доступа (buh_business, live_event_access_rules). Включение допустимо только на этапе 3 после отдельного proof совместимости.

---

## 4. Кэширование и инвалидация

```text
useSectionAccess():
  queryKey: ['section-access', userId]
  staleTime: 60_000 (1 мин)
  gcTime: 300_000 (5 мин)

Инвалидация (queryClient.invalidateQueries):
  - после create/edit/deactivate section_access rule
  - после изменения app_sections.is_public
  - после logout/login (onAuthStateChange)
```

---

## 5. CRUD ограничения для AppSectionsAdmin

1. `code` — immutable после создания для всех ролей (disabled в форме редактирования)
2. `route` — immutable после создания для всех ролей (disabled в форме редактирования)
3. `code` + `route` — UNIQUE constraint в DDL + frontend валидация при создании
4. Деактивация секции — проверка на active rules + warning dialog
5. Удаление — запрещено (только деактивация)

---

## 6. Staged rollout — порядок

```text
Этап 1: Инфраструктура
  - Миграции: app_sections + CHECK + RPC
  - UI: section_access в форме правил + селектор секций
  - getRuntimeSupport = "partial"
  → Пользователи НЕ видят изменений

Этап 2: Тестовая секция (eisenhower)
  - STOP-guard: money и live ЗАПРЕЩЕНЫ для gating на этом этапе
  - Создать section_access rule для тестового продукта
  - UPDATE app_sections SET is_public=false WHERE code='eisenhower'
  - Включить SectionGuard + sidebar lock для eisenhower
  - Proof (обязателен перед следующим шагом):
    □ sidebar lock отображается для user без доступа
    □ SectionGuard показывает paywall
    □ direct URL /tools/eisenhower → paywall
    □ admin bypass — секция открывается без rules
    □ rollback: UPDATE is_public=true → секция снова открыта

Этап 3: Остальные секции (по одной, после proof этапа 2)
  - money и live — только после отдельного proof совместимости с page-internal gating
  - getRuntimeSupport = "full" после последней секции
```

---

## 7. Kill-switch

**Источник флага:** таблица `app_settings`, ключ `section_gating_enabled`, значение `{"enabled": true/false}`.

Уже существует в проекте, read-only для authenticated.

```text
Уровень 1 — SQL: UPDATE app_sections SET is_public = true;
Уровень 2 — Kill-switch: UPDATE app_settings SET value='{"enabled":false}' WHERE key='section_gating_enabled';
  → useSectionAccess при enabled=false → все allow
  → Sidebar не рендерит lock-иконки
Уровень 3 — Полный откат (destructive):
  DELETE FROM access_rules WHERE grant_target_type = 'section_access';
  DROP TABLE app_sections;
  DROP FUNCTION get_user_section_access;
```

---

## 8. Compatibility checklist (before code)

```text
□ 34 существующих правила: count не изменился
□ CREATE club rule через UI → сохраняется
□ CREATE product_access rule через UI → сохраняется
□ CREATE training_content rule через UI → сохраняется
□ EDIT существующего правила → форма работает
□ section_access selector не ломает форму для других типов
□ 0 legacy email mappings: count не изменился
□ getRuntimeSupport для существующих типов: значения не изменились
□ UI для типа email по-прежнему отображается/сохраняется как раньше
□ Авто-миграция email → section_access НЕ происходит
□ SQL INSERT для section_access проходит после ALTER CHECK
□ SQL INSERT для club проходит после ALTER CHECK
```

---

## 9. DoD — обязательные proof

### Инфраструктура (этап 1) — доказано SQL/code
1. app_sections содержит 8 seed-записей, все is_public=true
2. CHECK constraint включает 6 типов (включая section_access)
3. INSERT section_access rule проходит
4. INSERT club rule проходит (не сломан ALTER)
5. RPC get_user_section_access возвращает все 8 секций с has_access=true для любого user
6. RPC с auth.uid()=NULL → пустой массив
7. Создание section_access rule через UI — сохраняется с target_ref=UUID
8. Редактирование section_access rule — работает
9. Деактивация rule — is_active=false

### Dry-run proof (5 кейсов)
10. Public section (dashboard): RPC → has_access=true, is_public=true
11. Gated section без rule (eisenhower, is_public=false): RPC → has_access=false
12. Gated section с product-level rule: user с entitlement → has_access=true; без → false
13. Gated section с tariff-level rule: user с subscription → has_access=true; другой тариф → false
14. Admin bypass: admin → has_access=true для всех секций

### Admin и безопасность
15. Admin bypass: admin открывает gated section без rules
16. Sidebar для admin: НЕ показывает lock-иконку
17. Orphan proof: rule с несуществующим UUID → RPC игнорирует, админка показывает warning
18. Orphan rule: список открывается, форма редактирования открывается, deactivate сохраняется без падения selector
19. Malformed target_ref (не UUID): RPC не падает, rule игнорируется, warning в админке

### Существующие страницы — compatibility
20. Money.tsx: открывается как раньше при is_public=true; buh_business tab gating работает
21. LiveEvents.tsx: per-event access не затронут
22. Knowledge/Products: module visibility не изменилась
23. Создание/редактирование club rule — работает
24. Создание/редактирование training_content rule — работает
25. section_access selector не ломает форму для других типов

### Legacy email compatibility
26. Тип email по-прежнему отображается в UI и сохраняется
27. section_access selector не ломает rendering/form state для email

### CRUD immutability
28. code и route не редактируемы после создания секции (form disabled)

### Кэш и fallback
29. Sidebar и SectionGuard используют один queryKey, один TTL
30. RPC ошибка для is_public=false → DENY + error UI (visible rollout)
31. Kill-switch app_settings `section_gating_enabled=false` → все allow

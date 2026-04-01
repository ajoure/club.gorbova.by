

# План: Многостраничный домен — финальная версия с правками безопасности

## Правки к предыдущей версии

### 1. `set_site_home_page()` — авторизация внутри SECURITY DEFINER
```sql
CREATE OR REPLACE FUNCTION set_site_home_page(p_domain TEXT, p_page_id UUID)
RETURNS void LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Авторизация: только admin/super_admin
  IF NOT (
    public.has_role_v2(auth.uid(), 'admin') OR
    public.has_role_v2(auth.uid(), 'super_admin')
  ) THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  UPDATE site_domain_bindings SET is_home = false WHERE domain = p_domain AND is_home = true;
  UPDATE site_domain_bindings SET is_home = true WHERE domain = p_domain AND site_page_id = p_page_id;
END;
$$;
```

### 2. Нормализация домена — hostname only
Запрет path/query/fragment/port. Canonical normalizer:
```typescript
function normalizeDomain(input: string): string {
  let d = input.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, '');  // strip protocol
  d = d.replace(/\/.*$/, '');          // strip path/query/fragment
  d = d.replace(/:[\d]+$/, '');        // strip port
  d = d.replace(/\.+$/, '');           // strip trailing dot
  if (!d) throw new Error("Domain cannot be empty");
  return d;
}
```
Применяется в `bindDomain`, UI input, и SQL cleanup migration.

### 3. `SET search_path = public` на SECURITY DEFINER функции
Уже включён в шаблон выше.

---

## Полный scope

### Шаг 1: SQL миграция

1. Cleanup существующих данных (нормализация доменов: strip protocol, path, port, trailing dot; удаление дублей)
2. DROP unique constraint на `domain`
3. ADD `is_home BOOLEAN NOT NULL DEFAULT false`
4. Backfill: single-binding домены → `is_home = true`
5. New constraints: `UNIQUE(domain, site_page_id)`, partial unique `(domain) WHERE is_home = true`
6. RPC `set_site_home_page` с RBAC-проверкой внутри + `SET search_path = public`

### Шаг 2: `SiteRenderService` — `resolveByDomainAndPath(hostname, path)`

- `/` → binding с `is_home = true` → published page
- `/slug` → все `site_page_id` для домена → match по slug (без lowercase на path — slug уже canonical)
- >1 match → null (404) + console.error
- Старый `resolveByDomain()` → alias для `resolveByDomainAndPath(hostname, '/')`

### Шаг 3: `DomainRouter.tsx` — передача pathname

- `SiteRenderService.resolveByDomainAndPath(hostname, window.location.pathname)`
- Trim trailing `/` (без lowercase — slug уже canonical)

### Шаг 4: `SitePublicationService.bindDomain` — нормализация и is_home

- `normalizeDomain()` (hostname only: strip protocol, path, query, fragment, port, trailing dot)
- Параметр `isHome?: boolean`; auto `true` для первого binding домена
- Смена home: RPC `set_site_home_page`

### Шаг 5: UI — `SiteSettingsPanel`

- Badge «Главная» рядом с home-binding
- Кнопка «Сделать главной» у не-home binding'ов
- Input: автоматический strip protocol/path/port при вводе
- При удалении home: confirm с предупреждением «/ будет отдавать 404»

### Шаг 6: `types.ts` — `is_home: boolean` в `SiteDomainBinding`

### Шаг 7: `useSiteDomainBindings` — `setHome` mutation (вызов RPC)

## Изменяемые файлы

| Файл | Действие |
|---|---|
| SQL миграция | Cleanup, is_home, constraints, RPC с RBAC |
| `SiteRenderService.ts` | `resolveByDomainAndPath()` |
| `DomainRouter.tsx` | Передача pathname |
| `SitePublicationService.ts` | `normalizeDomain()`, isHome, setHome через RPC |
| `useSiteDomainBindings.tsx` | `setHome` mutation |
| `SiteSettingsPanel.tsx` | Badge, кнопка, нормализация ввода |
| `types.ts` | `is_home` в SiteDomainBinding |

## DoD

- Домен привязан к нескольким страницам без ошибок
- `/` → home (is_home=true); без home → 404
- `/slug` → matching page; ambiguous → 404
- `set_site_home_page` проверяет `has_role_v2` внутри функции
- Домен хранится как hostname only (без protocol/path/query/port)
- Старые single-page binding'и → backfill is_home=true → `/` работает
- Удаление home → `/` = 404 (явное поведение)
- Смена home атомарна через RPC


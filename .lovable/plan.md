

# План: Исправление системы доступа к обучающим модулям ✅ ВЫПОЛНЕНО

## Диагностика (подтверждено)

### Корневая причина
RLS-политика на таблице `module_access` требует permission `content.manage`, который **не существует** в базе данных. Существуют только: `content.view`, `content.edit`, `content.publish`.

В результате:
1. Запрос к `module_access` возвращает пустой массив для обычных пользователей
2. Код интерпретирует пустой массив как "модуль публичный"
3. Карточки модулей показываются как доступные
4. Но RLS на `lesson_blocks` правильно блокирует контент
5. Пользователь видит пустую страницу "Раздел пока пуст"

---

## Выполненные исправления

### ✅ Шаг 1: Добавлена RLS политика для чтения module_access

```sql
CREATE POLICY "Authenticated users can read module_access"
ON public.module_access
FOR SELECT
TO authenticated
USING (true);
```

### ✅ Шаг 2: Создан permission content.manage

```sql
INSERT INTO public.permissions (code, name, category)
VALUES ('content.manage', 'Управление контентом', 'content')
ON CONFLICT (code) DO NOTHING;

-- Привязан к ролям admin и super_admin
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.code IN ('admin', 'super_admin')
  AND p.code = 'content.manage'
  AND NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
```

### ✅ Шаг 3: Обновлён useContainerLessons для проверки доступа

**Файл:** `src/hooks/useContainerLessons.ts`

- Добавлена загрузка `module_access` с названиями тарифов
- Добавлена загрузка подписок пользователя
- Реализована логика проверки доступа: админ OR нет ограничений OR пользователь имеет нужный тариф
- Возвращается массив `restrictedTariffs` для отображения в плашке

### ✅ Шаг 4: Исправлено отображение плашки в Knowledge.tsx

**Файл:** `src/pages/Knowledge.tsx`

- Объединены названия тарифов из модулей и контейнеров
- Плашка показывается если есть ограниченный контент
- Передаются все необходимые названия тарифов

---

## Изменённые файлы

| Файл | Изменение |
|------|-----------|
| `src/hooks/useContainerLessons.ts` | Добавлена проверка доступа, возврат restrictedTariffs |
| `src/pages/Knowledge.tsx` | Объединение тарифов, передача в RestrictedAccessBanner |

---

## Ожидаемый результат

После исправлений:
- ✅ Пользователи с FULL/BUSINESS тарифами видят видео-контент
- ✅ Пользователи с CHAT тарифом видят плашку "Контент доступен участникам Клуба" с названиями нужных тарифов
- ✅ Настройки доступа в админ-панели работают корректно
- ✅ Админы сохраняют полный доступ ко всему контенту

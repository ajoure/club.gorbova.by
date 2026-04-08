да, согласен, с учетом правок:

&nbsp;

1. Убери противоречие из плана:  

  - в этом спринте реальный enforcement только для eisenhower;
  - ai, money, live, self_development пока не подключать к SectionGuard;
  - для них оставить только подготовленную инфраструктуру без включения gating.
2. &nbsp;
3. Пункт «Подключение SectionGuard к страницам» перепиши так:  

  - подключить SectionGuard только к /tools/eisenhower;
  - остальные секции переводить по одной отдельным этапом после proof.
4. &nbsp;
5. money и live зафиксируй жёстче:  

  - не просто «запрещено закрывать»,
  - а не трогать их роуты и существующую внутреннюю логику вообще в этом спринте.
6. &nbsp;
7. В useSectionAccess не опирайся на логику «если RPC error, а секция public — allow», если у тебя нет отдельного источника is_public.  
Добавь явно:  

  - либо хук получает app_sections отдельным запросом,
  - либо SectionGuard сам дополнительно читает app_sections по sectionCode,
  - иначе корректный fallback невозможен.
8. &nbsp;
9. Не дублируй admin bypass одновременно в трёх местах без нужды.  
Зафиксируй один контракт:  

  - главный источник истины — RPC;
  - на фронте bypass только как безопасный early shortcut, если роль admin уже точно известна.
10. &nbsp;
11. Kill-switch не хардкодить в коде true/false.  
Вернись к уже согласованной модели:  

  - app_settings.section_gating_enabled,
  - либо другой реальный конфиг проекта,  
  но не ручная правка исходников как основной механизм rollback.
12. &nbsp;
13. Для sidebar уточни поведение:  

  - lock-иконка только для секции, которая реально is_public=false и has_access=false;
  - для admin lock не показывать;
  - sidebar ничего не блокирует, только показывает состояние.
14. &nbsp;
15. Для SectionGuard добавь обязательный UI-контракт:  

  - показывать название секции;
  - если RPC вернул granted_via_tariff_name или granted_via_product_name, выводить это в paywall;
  - при deny не делать redirect.
16. &nbsp;
17. Русификацию бейджей оставь, но не смешивай с enforcement как равнозначные задачи.  
В статусе этапа раздели:  

  - косметика /admin/sections;
  - первый guarded rollout eisenhower.
18. &nbsp;
19. В DoD добавь обязательные proof-пункты:

&nbsp;

&nbsp;

&nbsp;

- eisenhower при is_public=true открывается как раньше;
- eisenhower при is_public=false и без rule даёт deny;
- eisenhower при is_public=false и с rule даёт allow;
- admin открывает eisenhower всегда;
- sidebar показывает lock для обычного пользователя без доступа;
- sidebar не показывает lock для admin.

&nbsp;

&nbsp;

&nbsp;

11. Добавь compatibility-пункт:

&nbsp;

&nbsp;

&nbsp;

- Money.tsx, LiveEvents.tsx, Knowledge.tsx, Learning.tsx в этом спринте не меняют текущее поведение вообще.

&nbsp;

&nbsp;

&nbsp;

12. Для безопасности добавь правило rollout:

&nbsp;

&nbsp;

&nbsp;

- сначала merge инфраструктуры хука и guard,
- потом включение только eisenhower,
- только после фактического proof можно готовить следующий план на ai и другие секции.

&nbsp;

&nbsp;

# План: русификация бейджей + enforcement доступа к секциям

## Проблема

1. Бейджи статуса в `/admin/sections` на английском ("public", "gated", "inactive") — нужно на русском.
2. Переключение `is_public=false` для секции "Нейросеть" не закрывает раздел для учеников — нет enforcement. Sidebar показывает все пункты безусловно, SectionGuard не существует.

## Что будет сделано

### 1. Русификация бейджей в AdminSections

В `src/pages/admin/AdminSections.tsx`:

- "public" → "публичный"
- "gated" → "закрытый"
- "inactive" → "неактивный"

### 2. Хук `useSectionAccess`

Новый файл `src/hooks/useSectionAccess.ts`:

- Вызывает RPC `get_user_section_access` для текущего `auth.uid()`
- queryKey: `['section-access', userId]`, staleTime: 60s
- Возвращает массив секций с `has_access` для каждой
- Admin bypass: если роль admin — все секции `has_access=true`
- При ошибке RPC: для `is_public=true` → allow, для `is_public=false` → deny

### 3. Lock-иконка в пользовательском sidebar

В `src/components/layout/AppSidebar.tsx`:

- Подключить `useSectionAccess`
- Маппинг `mainMenuItems[].key` → `app_sections.code`
- Для gated секций без доступа: показать иконку замка рядом с названием
- Для admin: никаких замков, обычный вид
- Пункт НЕ скрывается, клик по-прежнему ведёт на страницу

### 4. Компонент `SectionGuard`

Новый файл `src/components/layout/SectionGuard.tsx`:

- Обёртка-wrapper, принимает `sectionCode: string`
- Использует тот же `useSectionAccess()` (общий кэш)
- `is_public=true` → пропускает
- `is_public=false` + `has_access=true` → пропускает
- `is_public=false` + `has_access=false` → overlay/paywall ("Доступ ограничен")
- Admin → всегда пропускает
- RPC error + gated → deny + "Не удалось проверить доступ. Обновите страницу."
- Kill-switch (feature flag `SECTION_GATING_ENABLED`): при `false` — всегда пропускает

### 5. Подключение SectionGuard к страницам

Обернуть компоненты страниц для секций, у которых есть запись в `app_sections`:

- `/ai` → SectionGuard code="ai"
- `/money` → SectionGuard code="money"
- `/live` → SectionGuard code="live"
- `/self-development` → SectionGuard code="self_development"
- `/tools/eisenhower` → SectionGuard code="eisenhower"
- `/dashboard`, `/knowledge`, `/products` — тоже обернуть (но они public, guard пропустит)

### 6. Инвалидация кэша

При изменении секции в AdminSections уже инвалидируются `section-access`, `admin-sections`, `access-rule-sections`. После logout/login — React Query сбрасывается автоматически.

## Ограничения

- Первый реальный тест gating — только `eisenhower`
- `money` и `live` запрещено закрывать до отдельного proof
- Создание новых секций через UI не добавляется
- Fulfillment и retroapply не затрагиваются
- Feature flag `SECTION_GATING_ENABLED` — hardcoded `true` в коде, для kill-switch меняется на `false`

## Файлы


| Файл                                     | Действие                        |
| ---------------------------------------- | ------------------------------- |
| `src/pages/admin/AdminSections.tsx`      | Русификация бейджей             |
| `src/hooks/useSectionAccess.ts`          | Новый хук — вызов RPC + кэш     |
| `src/components/layout/SectionGuard.tsx` | Новый компонент — guard/paywall |
| `src/components/layout/AppSidebar.tsx`   | Lock-иконка для gated секций    |
| Страницы секций (AI, Money, Live и т.д.) | Обёртка SectionGuard            |

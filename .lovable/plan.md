## да, согласен, с учетом правок:

1. **Заголовок плана привести к обязательному формату**  
Сейчас указано `## План (v2): ...`. Нужно строго:  
`План: Генерация документов — отдельный домен для Реквизитов v2`
2. **Уточнить, что это UI/navigation refactor, а не новый document generation pipeline**  
Добавить в начало:
  &nbsp;
  Этот план переносит существующий UI реквизитов в отдельный пользовательский раздел и админский домен документов. Новый генератор, новые токены, новые таблицы реквизитов, новые RPC и новые edge-functions не создаются.
  Это важно, потому что master-plan запрещает параллельные generator pipeline, token picker и локальные списки токенов.  
3. `app_sections.sort_order=5` **конфликтует с** `live=5`  
В плане написано: `sort_order=5` ставит между `ai(4)` и `live(5)`. Так не получится, если `live` уже `5`.  
Исправить:
  - либо `sort_order=4.5`, если поле допускает numeric;
  - либо безопаснее: `sort_order=45`, если используется integer-шкала;
  - либо выбрать следующий свободный порядок после read-only проверки существующих `app_sections`.
4. **Миграция** `app_sections` **должна быть add-only, но с update-safe поведением**  
`ON CONFLICT DO NOTHING` безопасен, но если строка уже есть с неправильным `label/route/icon`, она не исправится. Лучше:
  &nbsp;
  ```sql
  ON CONFLICT (code) DO UPDATE
  SET
    label = EXCLUDED.label,
    icon = EXCLUDED.icon,
    route = EXCLUDED.route,
    short_description = EXCLUDED.short_description,
    features_json = EXCLUDED.features_json,
    cta_label = EXCLUDED.cta_label,
    updated_at = now()
  ```
  Но **не менять автоматически** `is_public`, `is_active`, `sort_order`, если админ уже мог их настроить вручную. Это соответствует принципу safe migration и не ломает production-настройки.  
5. **Перед миграцией добавить read-only discovery**  
В план добавить шаг:
  - проверить существующие `app_sections` по `code`, `route`, `sort_order`;
  - проверить, как `AppSidebar` реально фильтрует пункты через `useSectionAccess`;
  - проверить тип поля `sort_order`;
  - проверить, есть ли уже lazy import-паттерн для новых страниц в `App.tsx`.
6. `user_menu_sections` **нельзя просто “НЕ трогаем” без проверки**  
Формулировку заменить на:
  &nbsp;
  `user_menu_sections` не изменяем на execute-этапе, если read-only discovery подтвердит, что клиентский sidebar действительно рендерится из `mainMenuItems` и доступ управляется через `app_sections/useSectionAccess`. Если обнаружится, что `user_menu_sections` влияет на меню/доступы, вынести отдельным mini-patch после discovery.
7. `AdminDocuments.tsx` **— проверить UX верхнеуровневых секций**  
Текущий план верно отмечает риск, но нужно сделать это обязательным пунктом, а не “техническим нюансом”:
  - если `visibleSections.length > 1`, верхний переключатель секций обязан отображаться;
  - если `visibleSections.length === 1`, можно скрывать;
  - активная секция должна корректно fallback’иться, если `initialSection` скрыта.
8. `AdminAI.tsx` **пункт сформулирован противоречиво**  
Сейчас написано: “без изменений”, но далее — “добавим `requisites`”.  
Исправить:
  &nbsp;
  `src/pages/admin/AdminAI.tsx` — точечная правка пропсов: добавить `requisites` в `hiddenSections`. Бизнес-логику не менять.
9. **Добавить audit/proof для миграции**  
Если в проекте принято требовать proof по системным изменениям, добавить:
  - SQL proof: строка `app_sections.code='document_generation'` существует;
  - UI proof: строка видна в `/admin/sections`;
  - audit proof, если текущая архитектура `/admin/sections` пишет изменения в `audit_logs`.
10. **Добавить STOP-guards**  
В план включить:

- STOP, если `AiPageContent` не поддерживает `requisites` как самостоятельную секцию;
- STOP, если `/admin/documents` технически завязан только на `documents` и ломается при двух секциях;
- STOP, если `SectionGuard` не принимает новый `sectionCode` без дополнительной регистрации;
- STOP, если миграция требует изменения RLS/section_access не заявленного в плане;
- STOP, если перенос реквизитов требует изменений в `client_legal_details` / `legal_details_persons`.

11. **DoD расширить проверкой отсутствия дублей**  
Добавить:

- `/ai → Реквизиты` больше недоступны пользователю;
- `/admin/ai → Реквизиты` не отображаются;
- `/admin/documents → Реквизиты` отображаются один раз;
- `/settings/legal-details` и `/settings/user-requisites` не изменились;
- CRUD реквизитов работает с теми же таблицами и хуками, без создания новых сущностей.

12. **Финальный отчет от Lovable должен быть строго на русском языке**  
В план добавить обязательный блок:

План должен быть составлен на русском языке.  
Отчет о выполненной работе должен быть составлен на русском языке.  
Вся переписка, пояснения, diff-summary, proof и результаты должны быть только на русском языке.

Это обязательное правило для планов/отчетов проекта.  

&nbsp;

План (v2): «Генерация документов» — отдельный домен для Реквизитов

### Скоуп изменений

1. **Пользовательский UI** (`/ai`) — оставить только `Gorbova AI`. Вкладку `Реквизиты` (Юрлица/ИП + Физлица) перенести в новый top-level пункт меню `Генерация документов` (`/document-generation`).
2. **Админский UI** — `/admin/ai` оставить как есть (Gorbova AI: Чат, История анализа, Туториалы, Промпты). Вкладку `Реквизиты` дополнительно добавить в существующий админский домен `/admin/documents` (рядом с Плейсхолдерами, Шаблонами, Историей, Исполнителями).
3. **Раздел в `/admin/sections**` — завести новый `app_sections.code = 'document_generation'`, чтобы админ мог управлять видимостью раздела для клиентов (как у `ai`/`knowledge`).

### Файловые правки

#### Frontend (точечно, без правки бизнес-логики)

1. `**src/pages/AI.tsx**` — добавить проп:
  ```tsx
   <AiPageContent mode="user" hiddenSections={["requisites"]} />
  ```
   На `/ai` остаётся только секция `ai` (Gorbova AI). Админ-секция `documents` уже скрыта guard'ом `adminOnly` внутри `AiPageContent` для пользователя — ничего не меняется.
2. **Новый `src/pages/DocumentGeneration.tsx**` — обёртка для пользовательского домена:
  ```tsx
   <DashboardLayout>
     <AiPageContent mode="user" initialSection="requisites" hiddenSections={["ai", "documents"]} />
   </DashboardLayout>
  ```
   Рендерит `requisites` напрямую с табами `Юрлица / ИП` и `Физлица`.
3. `**src/pages/admin/AdminDocuments.tsx**` — расширить видимость, **убрав** `requisites` из скрытых:
  ```tsx
   <AiPageContent mode="admin" initialSection="documents" hiddenSections={["ai"]} />
  ```
   Теперь на `/admin/documents` админ увидит верхнеуровневые секции `Документы` и `Реквизиты` рядом, а внутри `Реквизитов` — табы `Юрлица / ИП` и `Физлица`. Gorbova AI и его подвкладки остаются исключительно на `/admin/ai`.
4. `**src/pages/admin/AdminAI.tsx**` — без изменений (там уже `hiddenSections={["documents"]}`; добавим `requisites`, чтобы Реквизиты не дублировались на `/admin/ai`):
  ```tsx
   <AiPageContent mode="admin" hiddenSections={["documents", "requisites"]} />
  ```
5. `**src/App.tsx**` — добавить роут пользователя:
  ```tsx
   <Route path="/document-generation"
     element={<ProtectedRoute><LazyRoute>
       <SectionGuard sectionCode="document_generation">
         <DocumentGeneration />
       </SectionGuard>
     </LazyRoute></ProtectedRoute>}
   />
  ```
   `SectionGuard` обязателен — иначе админ не сможет управлять видимостью раздела через `/admin/sections`.
6. `**src/components/layout/AppSidebar.tsx**` — добавить новый `MainMenuItem` сразу после `ai`:
  ```ts
   { key: "document_generation", title: "Генерация документов",
     url: "/document-generation", icon: FileSignature }
  ```
   Иконка `FileSignature` из `lucide-react` (документ с подписью — семантически точная, визуально отличается от `FileText` в профиль-меню и от `Cpu` нейросети). Резолв ключа в section code добавим:
   (фактически достаточно того, что `key` совпадает с `app_sections.code`).
7. `**src/components/layout/DashboardBreadcrumbs.tsx**` — добавить запись `"/document-generation": "Генерация документов"`.
8. **Опциональная мелочь в `AiPageContent.tsx**` — при `initialSection`, попавшем в `hiddenSections`, должен срабатывать fallback на первую видимую секцию. Сверяем существующий guard; если его нет — добавляем мини-правку (без изменения логики секций), чтобы в `/admin/ai` с `hiddenSections=["documents","requisites"]` точно подсвечивался `ai`, а на `/document-generation` — `requisites`.

#### Backend (миграции)

9. **Миграция: добавить раздел `document_generation` в `app_sections**`:
  ```sql
   INSERT INTO public.app_sections
     (code, label, icon, route, is_public, sort_order, is_active, short_description, features_json, cta_label)
   VALUES
     ('document_generation', 'Генерация документов', 'FileSignature',
      '/document-generation', false, 5, true,
      'Реквизиты ЮЛ/ИП и физлиц для генерации документов',
      '["Юрлица и ИП", "Физлица", "Подстановка в шаблоны документов"]'::jsonb,
      'Получить доступ')
   ON CONFLICT (code) DO NOTHING;
  ```
   Это автоматически:
  - покажет раздел в `/admin/sections` со всеми toggle'ами публичности и `section_access` правилами;
  - подключит `SectionGuard` на роуте `/document-generation` — пользователи без доступа получат стандартный экран «Раздел недоступен», как у `/ai` и `/knowledge`.
   `sort_order=5` ставит его между `ai`(4) и `live`(5) — при необходимости подгоним.
10. `**user_menu_sections**` — НЕ трогаем (там тоже есть запись `ai` со sort_order=4, но пункт меню рендерится статически из `AppSidebar.tsx`; синхронизация не требуется для рендера сайдбара).

### Что НЕ трогаем

- `AiPageContent.tsx` — бизнес-логика, хуки, реестры, табы внутри `requisites`/`documents`/`ai`. Только пропы и (если необходимо) fallback `initialSection`.
- `useAiEntities`, `useAiPersons`, `EntityTableView/Sheet`, `PersonsTableView/Sheet`, `client_legal_details`, `legal_details_persons`, RLS, RPC, edge-functions, document_templates, plейсхолдеры.
- `/settings/legal-details` и `/settings/user-requisites` (это отдельный профильный раздел) — без изменений.
- `/admin/ai` GorbowAI — без изменений.

### DoD

- **Пользователь** (`/ai`): виден только таб `Gorbova AI`. В сайдбаре между `Нейросеть` и `Эфиры` появился пункт `Генерация документов` с иконкой `FileSignature`. Клик открывает `/document-generation` с табами `Юрлица / ИП` и `Физлица` — CRUD работает идентично прежнему `/ai → Реквизиты`.
- **Админ** (`/admin/ai`): остался полный Gorbova AI (Чат, История анализа, Туториалы, Промпты). На `/admin/documents` появилась дополнительная верхнеуровневая вкладка `Реквизиты` с теми же двумя табами.
- `**/admin/sections**`: появилась строка `document_generation` / `Генерация документов` / `/document-generation` с управляемыми publish/гранулярными правилами доступа (как у `ai`, `knowledge`).
- Хлебная крошка на `/document-generation` показывает «Генерация документов».
- При выключении видимости раздела в `/admin/sections` пользователь без доступа получает стандартный экран «Раздел недоступен», и пункт сайдбара уважает `useSectionAccess` (он у `AppSidebar` уже есть для всех `mainMenuItems`).

### Verify

- Скрин `/ai` (user) — только Gorbova AI.
- Скрин `/document-generation` (user) — Юрлица/ИП + Физлица, открыть существующее юрлицо.
- Скрин `/admin/ai` (admin) — Gorbova AI без Реквизитов и без Документов.
- Скрин `/admin/documents` (admin) — Документы + Реквизиты как два верхнеуровневых таба.
- Скрин `/admin/sections` — новая строка `document_generation`.

### Технические нюансы / риски

- Сейчас на `/admin/documents` верхнеуровневый таб-переключатель секций может быть скрыт, если рассчитан на «одну видимую секцию» — нужно убедиться, что при двух видимых секциях (`documents` + `requisites`) переключатель рендерится. Если рендерится только один — добавить условие `visibleSections.length > 1 ? render : hide` (мелкая UI-правка внутри AiPageContent, без изменения логики).
- Иконка `FileSignature` присутствует в `lucide-react@latest`. Если по версии её нет — заменить на `FileText` / `ScrollText` (выберем при имплементации, сверившись с импортами `lucide-react`).
- `app_sections.code` уникален — миграция идемпотентна (`ON CONFLICT DO NOTHING`).
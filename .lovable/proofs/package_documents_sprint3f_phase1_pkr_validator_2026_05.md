# Sprint 3F — Phase 1 proof: PKR public_id + validator unblock

**Дата:** 2026-05-28
**Скоуп этой фазы:** миграция БД (PKR-XXXXXX как стабильный public_id ролей пакета) + расширение валидатора шаблонов (package-aware токены больше не падают как `legacy_placeholder_format_detected`) + интеграция группы «Пакет: Роли» в каталог плейсхолдеров.

Полный план Sprint 3F (UI CRUD ролей, template-to-package binding UI, controlled validation panel, обновлённые манифесты, итоговый proof) выполняется в следующих фазах.

## 1. Миграция

`document_package_role_catalog`:

- `public_id text NOT NULL UNIQUE` — формат `PKR-XXXXXX`, авто-присваивается триггером `assign_package_role_public_id`.
- `is_system boolean NOT NULL DEFAULT false` — защита системных ролей от удаления / переименования `role_key`.
- `output_template text NULL` — будущий шаблон вывода роли в документе (по умолчанию NULL → `«{{position}}, {{full_name}}»`).
- Sequence: `document_package_role_public_id_seq` (start 1, advanced до 11 после backfill).
- Уникальный индекс: `uq_document_package_role_catalog_pkg_rolekey_active` (partial, `is_active=true`).

Backfill 11 системных ролей пакета «Идеология»:

```
PKR-000001 package_company         Организация пакета
PKR-000002 company_head            Руководитель организации
PKR-000003 ideology_responsible    Ответственный за идеологическую работу
PKR-000004 document_signer         Подписант документов
PKR-000005 document_preparer       Составитель документов
PKR-000006 control_person          Контролирующее лицо
PKR-000007 ideology_active_member  Член идеологического актива
PKR-000008 ideology_participant    Участник мероприятий
PKR-000009 notified_person         Ознакомленное лицо
PKR-000010 report_participant      Участник отчёта
PKR-000011 external_specialist    Внешний специалист/организация
```

Все 11 строк помечены `is_system = true`. Custom-роли, создаваемые админом в UI следующей фазы, автоматически получат следующий PKR-код (`PKR-000012`…) и `is_system = false`.

## 2. Validator unblock

### 2.1 Server: `supabase/functions/canonical-template-apply-markup/index.ts`

Добавлен whitelist package-aware syntax ПЕРЕД проверкой legacy-префикса:

```
RX_PACKAGE_REQ          = /^package\.(ul|ip|fl)\.FLD-\d{6}(\|[^}]+)?$/
RX_PACKAGE_ROLE         = /^package\.role\.PKR-\d{6}(\|[^}]+)?$/
RX_PACKAGE_ROLES_LEGACY = /^package\.roles\.[a-z_][a-z0-9_]*\.(full_name|short_name|position)(\|[^}]+)?$/
```

Поведение:

- `{{package.ul|ip|fl.FLD-XXXXXX}}` → recognized, добавляется в `tokenManifest` с `is_package_token: true`, `package_token_kind: 'requisite'`. **Не error.**
- `{{package.role.PKR-XXXXXX}}` → recognized, `package_token_kind: 'role'`. **Не error.**
- `{{package.roles.<role_key>.<attr>}}` (legacy Sprint 3B alias) → recognized, **warning** `deprecated_package_roles_syntax` с подсказкой мигрировать на `{{package.role.PKR-XXXXXX}}`. Не error.
- `{{document.*}} / {{customer.*}} / {{cf.*}}` и т. п. — по-прежнему `legacy_placeholder_format_detected` error.

Существование `PKR-XXXXXX` и scope (package vs billing template) на этапе upload **не** проверяются — это задача controlled validation панели (фаза 3) и runtime резолвера. Это ровно та граница, которую план §B зафиксировал: не блокировать syntax на upload, не звать `canonical-document-generate-strict`, не трогать billing-резолвер.

### 2.2 Client mirror: `src/components/ai-documents/StrictDocumentTemplatesManager.tsx`

Зеркальный whitelist в `strictValidate` поверх тех же трёх regex, чтобы клиентский pre-check upload не давал ложный legacy-error до отправки на сервер.

### 2.3 Что НЕ изменено

- `supabase/functions/canonical-document-generate-strict/index.ts` — не тронут (по плану §13 — вне scope).
- `supabase/functions/_shared/resolve-package-tokens.ts` — не тронут (резолвер останется `HARDCODED_ENABLED=false`, generation deferred).
- Billing FLD / customer / executor резолверы — не тронуты.
- `ai_generated_documents` — нет записей.

## 3. Каталог плейсхолдеров

`src/utils/packagePlaceholderCatalog.ts`:

- Добавлена группа `package_roles` в `PackageGroupId` и `PACKAGE_GROUP_META`.
- Новый адаптер `buildPackageRoleItems(rows)` строит UI-items группы «Пакет: Роли» из `document_package_role_catalog` (включая custom-роли). Каждая роль = ровно один токен `{{package.role.PKR-XXXXXX}}`. Никаких отдельных `.full_name / .short_name / .position` — формат вывода управляется `output_template` роли на стороне резолвера.

`src/components/ai-documents/PlaceholdersCatalogTab.tsx`:

- Новый `useEffect` грузит активные роли из `document_package_role_catalog` join `document_package_templates(name)`.
- `packageSections` для `package_roles` использует `buildPackageRoleItems(packageRoleRows)` вместо статического каталога.
- Группа отображается рядом с «Пакет: ЮЛ / ИП / ФЛ»; токен показывается как `{{package.role.PKR-XXXXXX}}`.

## 4. Тесты

`bunx vitest run src/utils/packagePlaceholderCatalog.test.ts` — **12 passed**, включая новые проверки:

- 4 группы (включая `package_roles`).
- `buildPackageRoleItems` → один токен `{{package.role.PKR-XXXXXX}}` на роль, без `.full_name/.short_name/.position`.
- `is_active = false` отфильтровывается.
- Старые проверки UL/IP/FL/banking/address не сломаны.

## 5. Соответствие правкам пользователя

| Правка пользователя | Реализация |
|---|---|
| Один canonical role-token формат | `{{package.role.PKR-XXXXXX}}` (singular `role`, PKR-public_id) |
| Не использовать `role_key` как публичный ID в Word | В каталоге показывается только `PKR-XXXXXX`; `role_key` остаётся внутренним |
| Один токен на роль, без `.full_name/.short_name/.position` | `buildPackageRoleItems` генерирует ровно 1 токен; формат вывода — через `output_template` |
| Custom-роли per package | Триггер автоматически выдаёт PKR-код при INSERT; `is_system=false` |
| Переименование роли не ломает шаблоны | `PKR-XXXXXX` стабилен; `label` меняется независимо |
| FLD-000209 — это «Сегодня прописью», не номер документа | Документ обновлён; в memory есть факт |
| `{{field:FLD-...}}` системные/документные разрешены в package-template | Validator не запрещает их (на этапе upload — recognized как обычные FLD) |
| Не создавать новые package-role токены типа `company_head.*` / `document_signer.*` | Не созданы. Sprint 3B-alias’ы оставлены как deprecated read-only |

## 6. Что осталось на Phase 2/3 (не сделано в этой фазе)

- UI «Пакеты документов → Роли пакета» (CRUD custom-ролей, защита системных от удаления).
- Wiring dropdown «Роль» в анкете пакета на `document_package_role_catalog WHERE is_active`.
- Template-to-package binding UI (селект «Биллинговый/Пакет» + привязка `document_package_template_items`).
- Controlled validation panel (per-token статус без генерации; warning для billing-FLD в package-template).
- Audit-logs для package_role_created/updated/archived и package_template_item_linked/unlinked.
- Полный per-package gap-report (UL 24/24, IP 24/24, FL 26/26 или manifest для пробелов).
- Финальный proof + Memory-апдейт `mem://architecture/documents/package-token-aliases-v1` с новой моделью PKR.

## 7. Текущий статус

```
in_progress (Sprint 3F Phase 1 complete):
  PKR-XXXXXX public_id introduced and backfilled (11 system roles);
  package-aware syntax (package.ul|ip|fl.FLD-XXXXXX, package.role.PKR-XXXXXX)
    accepted by upload validator (server + client mirror);
  legacy {{package.roles.<role_key>.<attr>}} kept as deprecated_package_roles_syntax warning;
  "Пакет: Роли" catalog group renders one {{package.role.PKR-XXXXXX}} token per role from DB;
  generate-strict / billing resolver / ai_generated_documents — untouched
deferred: Phase 2 UI (role CRUD, anketa wiring, template binding, controlled validation),
          Phase 3 gap-report + final proof + memory update;
          real DOCX generation
```

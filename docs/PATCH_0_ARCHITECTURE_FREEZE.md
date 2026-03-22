# PATCH 0 — Архитектурный freeze + reuse map

Отчет о выполнении: Документация. Код не менялся.

---

## 1. ЗАЩИЩЁННЫЕ FLOWS (НЕ ТРОГАТЬ)

| Flow | Файлы / Таблицы | Статус |
|---|---|---|
| Billing generation | `supabase/functions/generate-from-template/index.ts` | НЕ ТРОГАТЬ |
| Settings: реквизиты | `src/pages/settings/LegalDetails.tsx`, `src/hooks/useLegalDetails.tsx` | НЕ ТРОГАТЬ |
| Executors | `src/hooks/useLegalDetails.tsx` (useExecutors), `supabase/functions/generate-from-template/` | НЕ ТРОГАТЬ |
| Generated documents | `src/hooks/useGeneratedDocuments.tsx`, таблица `generated_documents` | НЕ ТРОГАТЬ (до PATCH 10.5) |
| MNS pipeline | `supabase/functions/mns-response-generator/`, `src/pages/audits/MnsResponseService.tsx` | НЕ ТРОГАТЬ |
| GRP lookup | `supabase/functions/grp-lookup/`, `src/hooks/useGrpLookup.ts` | REUSE, НЕ МЕНЯТЬ |
| Order documents UI | `src/components/purchases/OrderListItem.tsx`, `src/components/admin/DocumentLogTab.tsx` | НЕ ТРОГАТЬ |

---

## 2. REUSE MATRIX

### 2.1 Компоненты UI (reuse 1:1)

| Компонент | Файл | Reuse в AI-разделе |
|---|---|---|
| `OrganizationDetailsForm` | `src/components/legal-details/OrganizationDetailsForm.tsx` | Да, для CRUD юрлиц/ИП |
| `IndividualDetailsForm` | `src/components/legal-details/IndividualDetailsForm.tsx` | Частично: extract shared fields в `PersonFieldsForm` |
| `GrpConfirmDialog` | `src/components/legal-details/GrpConfirmDialog.tsx` | Да, 1:1 |
| `OrgFormCombobox` | `src/components/legal-details/OrgFormCombobox.tsx` | Да, 1:1 |
| `PayerTypeSelector` | `src/components/legal-details/PayerTypeSelector.tsx` | Да, 1:1 |
| `StructuredAddressBlock` | `src/components/shared/StructuredAddressBlock.tsx` | Да, 1:1 |
| `FieldLabelWithId` | `src/components/legal-details/FieldLabelWithId.tsx` | Да, 1:1 |

### 2.2 Hooks (reuse)

| Hook | Файл | Reuse |
|---|---|---|
| `useLegalDetails` | `src/hooks/useLegalDetails.tsx` | Да, расширить фильтрацией по purpose |
| `useExecutors` | `src/hooks/useLegalDetails.tsx` | НЕ ТРОГАТЬ |
| `useGrpLookup` | `src/hooks/useGrpLookup.ts` | Да, 1:1 |

### 2.3 Библиотеки / сервисы (reuse)

| Сервис | Файл | Reuse |
|---|---|---|
| `GrpAutofillService` | `src/lib/legal-entities/GrpAutofillService.ts` | Да, 1:1 |
| `GrpLookupAdapter` | `src/lib/legal-entities/adapters/GrpLookupAdapter.ts` | Да, 1:1 |
| `LEGAL_DETAILS_FIELD_MAP` | `src/lib/legal-details/fieldMap.ts` | Да, расширить для новых сущностей |
| `token-resolver` | `src/lib/token-resolver.ts` | Да, расширить для persons/links |
| `normalizeAndValidateUnp` | `src/lib/legal-entities/normalizeUnp.ts` | Да, 1:1 |
| `fileExtractor` | `src/utils/fileExtractor.ts` | Да, для AI chat |
| Google Maps adapters | `src/lib/address/` | Да, 1:1 |

### 2.4 Edge functions (reuse)

| Function | Reuse |
|---|---|
| `grp-lookup` | Да, 1:1 |
| `generate-from-template` | Да, расширить (PATCH 11) |
| `mns-response-generator` | НЕ ТРОГАТЬ |

### 2.5 Таблицы (reuse)

| Таблица | Reuse |
|---|---|
| `client_legal_details` | Source of truth, расширить purpose (PATCH 1) |
| `executors` | НЕ ТРОГАТЬ |
| `generated_documents` | Расширить после PATCH 10.5 |
| `document_templates` | Добавить записи для AI шаблонов |
| `fields_registry` | Расширить для новых полей |
| `audit_logs` | Reuse для person/link CUD |

---

## 3. MAPPING: СТАРОЕ → НОВОЕ

| Существующее | Новое в AI-разделе | Связь |
|---|---|---|
| `src/pages/settings/LegalDetails.tsx` | Новая вкладка «Реквизиты» в `/ai` | Параллельно, разные views на ту же таблицу |
| `useLegalDetails` hook | Новые hooks `usePersons`, `useEntityPersonLinks` | useLegalDetails reuse + новые hooks рядом |
| `OrganizationDetailsForm` | Reuse внутри AI-раздела | Импорт без изменений |
| `IndividualDetailsForm` | Извлечь `PersonFieldsForm` | Shared fields, оригинал не меняется |
| `generate-from-template` | Тот же, + `mode=ai_document` | Обратно совместим |

---

## 4. НОВЫЕ КОМПОНЕНТЫ (будут созданы)

| Компонент | PATCH | Назначение |
|---|---|---|
| `src/components/ai-requisites/RequisitesEntitiesList.tsx` | 5 | Список юрлиц/ИП |
| `src/components/ai-requisites/PersonsList.tsx` | 6 | Список физлиц |
| `src/components/ai-requisites/PersonForm.tsx` | 6 | Форма физлица |
| `src/components/ai-requisites/PersonFieldsForm.tsx` | 6 | Shared fields (extracted) |
| `src/components/ai-requisites/EntityPersonLinksBlock.tsx` | 7 | Связи в карточке юрлица |
| `src/components/ai-requisites/LinkEditor.tsx` | 7 | Редактор связи |
| `src/components/ai-requisites/DuplicateWarningDialog.tsx` | 3 | Предупреждение дублей |

---

## 5. НОВЫЕ HOOKS (будут созданы)

| Hook | PATCH | Назначение |
|---|---|---|
| `src/hooks/usePersons.tsx` | 6 | CRUD физлиц |
| `src/hooks/useEntityPersonLinks.tsx` | 7 | CRUD связей |
| `src/hooks/useEntityDuplicateCheck.tsx` | 3 | Антидубль юрлиц по УНП |
| `src/hooks/usePersonDuplicateCheck.tsx` | 3 | Антидубль физлиц |
| `src/hooks/useAiChat.tsx` | 8 | AI чат streaming |

---

## 6. НОВЫЕ ТАБЛИЦЫ (будут созданы в PATCH 2)

| Таблица | Назначение |
|---|---|
| `legal_details_persons` | Карточки физлиц |
| `legal_details_roles_catalog` | Справочник типов связей |
| `legal_details_positions_catalog` | Справочник должностей |
| `legal_details_entity_person_links` | Связи entity↔person |
| `ai_chat_messages` | История AI-чата |

---

## 7. НОВЫЕ EDGE FUNCTIONS (будут созданы)

| Function | PATCH | Назначение |
|---|---|---|
| `gorbova-ai-chat` | 8 | SSE streaming AI чат |

---

## 8. ADD-ONLY SCOPE

- Все новые файлы создаются в `src/components/ai-requisites/` и `src/hooks/`
- Существующие компоненты в `src/components/legal-details/` импортируются, не копируются
- `src/pages/AI.tsx` расширяется add-only (новый Section type, новые tabs)
- `supabase/functions/generate-from-template/index.ts` расширяется add-only (новый mode)
- Billing вызовы без `mode` = текущее поведение без изменений

---

## 9. ТЕКУЩАЯ СТРУКТУРА /ai (до изменений)

```
type Section = "ai" | "documents"
SubTab = "chat" | "tutorials" | "prompts" | "accountant" | "manager" | "audit" | "templates"
```

После PATCH 4:
```
type Section = "ai" | "documents" | "requisites"
SubTab += "entities" | "persons"
```

---

## DoD PATCH 0

- [x] Reuse matrix задокументирована
- [x] Защищённые flows перечислены
- [x] Mapping старое → новое зафиксирован
- [x] Add-only scope определён
- [x] Новые компоненты / hooks / tables / edge functions запланированы
- [x] Код не менялся

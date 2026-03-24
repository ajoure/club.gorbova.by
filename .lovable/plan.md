# да, согласен, с учетом правок:

&nbsp;

1. **charter_source_type расширить.**
  Сейчас есть только upload | text | manual. Нужно сразу add-only поддержать минимум:
  &nbsp;
  - upload_docx
  - upload_pdf
  - upload_image
  - text
  - manual
    И отдельно хранить charter_extraction_status. Это упростит дальнейший Sprint 4 и не потребует потом ломать схему.
  &nbsp;
2. **corporate_draft_sessions добавить поле для явной фиксации правовой базы расчета.**
  Нужны add-only поля вроде:
  &nbsp;
  - rules_basis = charter_confirmed | law_default | mixed
  - blocking_errors jsonb default '[]'
  - non_blocking_warnings jsonb default '[]'
    Сейчас warnings есть, но лучше сразу разделить блокирующие и неблокирующие проверки, потому что это понадобится на preview и на финальной генерации.
  &nbsp;
3. **В Step 3 отдельно выделить блок “лицо, имеющее право на участие” vs “представитель”.**
  Не смешивать участника и представителя в одной сущности без явной модели полномочий. Для собрания закон отдельно завязывает участие на лицах, имеющих право на участие, а регистрация представителей требует подтверждения полномочий. Это уже видно и в ваших шаблонах извещения/регистрации.   
4. **В Rule Engine сразу зафиксировать сроки по общему правилу закона, если устав не подтвержден.**
  Как минимум:
  &nbsp;
  - годовое собрание — не позднее 31 марта следующего года;
  - извещение — не менее чем за 30 дней;
  - доступ к документам — не менее чем за 20 дней.
    Это должно работать как law_default, пока нет подтвержденных правил устава.     
  &nbsp;
5. **В package manifest сразу разделить документы на:**
  &nbsp;
  - system_generated
  - externally_provided
  - conditional_generated
    Это важно, потому что часть материалов система не создает сама, а только учитывает: годовая отчетность, аудиторское заключение, заключение ревизора и т.п. И это уже отражено в ваших текущих шаблонах протокола/извещения как внешние приложения, а не как самостоятельные документы генерации.   
  &nbsp;
6. **В manifest constants сразу убрать жесткую обязательность board / auditor / amendments.**
  Оставлять их только как conditional templates. Это уже правильно заложено, но нужно прямо запретить трактовать их как always-on, потому что ваши текущие заготовки извещения и протокола как раз этим страдают.   
7. **Для procedure_mode добавить manual override с audit reason, но только если нет подтвержденного состава участников.**
  Базово вы правильно считаете режим по подтвержденному составу участников. Но в реальном intake до заполнения состава может понадобиться временный manual mode selection. Он не должен быть silent — только с логированием причины и последующей перепроверкой.
8. **В DoD добавить proof по naming rules.**
  Нужно отдельно проверить, что в UI и будущих документах используется:
  &nbsp;
  - участники, а не учредители;
  - решение единственного участника, а не протокол/собрание.
    Это критично, потому что текущие пользовательские шаблоны как раз содержат неверную терминологию.     
  &nbsp;
9. **В мосте к Sprint 2 добавить еще один обязательный шаблон:**
  &nbsp;
  - corp_participants_decision_notice_change_agenda / уведомление об изменении повестки дня
    Не обязательно в MVP генерации, но как обязательный backlog item внутри corporate manifest roadmap. Это логично, если после первичного извещения повестка меняется.
  &nbsp;
10. **В PATCH 1 зафиксировать документарные constraints для будущих шаблонов как отдельный markdown/spec файл, а не только constants.**
  То есть помимо TS constants нужен явный documentation artifact с правилами оформления:

&nbsp;

&nbsp;

&nbsp;

- реквизиты документа;
- вид документа;
- дата / номер / место;
- протокол / приказ / решение;
- поля страницы и базовые требования Инструкции по делопроизводству.
  Это избавит от потерь при переходе к Sprint 2. Основание — Инструкция по делопроизводству и ваш master-plan. 

&nbsp;

&nbsp;

В таком виде план уже можно брать как **PATCH 1 / Sprint 1**. Следующий правильный шаг после его фиксации — отдельно оформить **Sprint 2: полный пакет корпоративных шаблонов и правила их применения**.

&nbsp;

PATCH 1 — Корпоративные документы: Intake + Draft + Rule Layer

## Scope

Add-only расширение модуля «Нейросеть → Документы». Существующие flows не затрагиваются. Никаких миграций на существующие таблицы.

---

## 1. Миграция: таблица `corporate_draft_sessions`

```sql
-- public_id sequence
INSERT INTO public.public_id_sequences (entity_type, prefix, last_value)
VALUES ('corporate_draft', 'CDS', 0) ON CONFLICT DO NOTHING;

CREATE TABLE public.corporate_draft_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text UNIQUE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  legal_details_id uuid REFERENCES public.client_legal_details(id),
  
  report_year integer NOT NULL DEFAULT (EXTRACT(YEAR FROM now()) - 1)::int,
  procedure_mode text NOT NULL DEFAULT 'annual_meeting'
    CHECK (procedure_mode IN ('annual_meeting', 'sole_participant_decision')),
  
  -- Charter
  charter_source_type text CHECK (charter_source_type IN ('upload', 'text', 'manual')),
  charter_file_path text,
  charter_raw_text text,
  extracted_charter_rules jsonb DEFAULT '{}',
  confirmed_charter_rules jsonb DEFAULT '{}',
  charter_confirmed_at timestamptz,
  charter_confirmed_by text, -- 'ai_extraction' | 'manual'
  
  -- Corporate params (structured JSONB — see types below)
  corporate_params jsonb DEFAULT '{}',
  
  -- Package manifest (calculated by rule engine)
  package_manifest jsonb DEFAULT '{}',
  
  warnings jsonb DEFAULT '[]',
  
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','charter_pending','params_pending',
                      'preview','confirmed','generating','generated','cancelled')),
  
  metadata jsonb DEFAULT '{}',
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- public_id trigger (BEFORE INSERT)
CREATE TRIGGER trg_corporate_draft_public_id
  BEFORE INSERT ON public.corporate_draft_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_public_id('corporate_draft');

ALTER TABLE public.corporate_draft_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner full access" ON public.corporate_draft_sessions
  FOR ALL TO authenticated
  USING (profile_id IN (SELECT id FROM profiles WHERE user_id = auth.uid()))
  WITH CHECK (profile_id IN (SELECT id FROM profiles WHERE user_id = auth.uid()));

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.corporate_draft_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
```

Storage bucket `charter-documents` (private, owner-only RLS).

---

## 2. Types — `src/lib/corporate/corporateTypes.ts`

Полные TypeScript интерфейсы:

**CorporateParams** — включая **блок участников с долями/голосами/представителями**:

```typescript
interface Participant {
  person_id?: string;        // FK legal_details_persons
  entity_id?: string;        // FK client_legal_details (если участник — юрлицо)
  type: 'individual' | 'legal_entity';
  name: string;
  share_percent: number;
  vote_count: number;
  representative?: { name: string; basis: string };
  attendance: 'present' | 'absent' | 'absentee_vote';
}
```

**CharterRules** — подтверждённые правила устава:

```typescript
interface CharterRules {
  convening_authority: 'director' | 'board' | 'participants';
  notice_days_min: number;
  notice_method: string;
  quorum_percent: number;
  has_board: boolean;
  has_auditor: boolean;
  has_audit_commission: boolean;
  allowed_meeting_formats: ('in_person' | 'absentee' | 'mixed')[];
  allowed_voting_forms: ('open' | 'secret')[];
  special_rules?: string;
}
```

**PackageManifestItem**:

```typescript
interface PackageManifestItem {
  template_code: string;
  title: string;
  included: boolean;
  reason: string;
  legal_basis: 'law_default' | 'charter_confirmed' | 'user_selected';
  required_data: string[];
  missing_data: string[];
}
```

`procedure_mode` рассчитывается из **подтверждённого списка участников** (`corporate_params.participants`), а не из `entity_person_links`.

---

## 3. Rule Engine — `src/lib/corporate/corporateRuleEngine.ts`

Pure functions (shared-ready для будущего серверного использования):

- `determineProcedureMode(participants: Participant[]): ProcedureMode` — по количеству участников в подтверждённом составе
- `calculateQuorum(participants, charterRules): QuorumResult` — расчёт кворума по долям/голосам
- `calculatePackageManifest(mode, charterRules, params): PackageManifestItem[]` — включение/исключение документов с `legal_basis`
- `validateSession(session): ValidationResult` — blocking/warning checks (сроки, кворум, конфликты)

Обязательные правила:

- 1 участник (по подтверждённому составу) → `sole_participant_decision`
- `!has_board` → исключить board-документы (`legal_basis: 'charter_confirmed'`)
- `!has_auditor && !has_audit_commission` → исключить auditor-документы
- Нет charter данных → warning + `legal_basis: 'law_default'`
- Нарушение сроков → blocking warning
- Нет кворума → blocking warning

---

## 4. Hook — `src/hooks/useCorporateDraftSession.ts`

- `createSession(profileId, legalDetailsId, reportYear)` — с `created_by`
- `updateSession(id, patch)` — debounced auto-save, с `updated_by`
- `deleteSession(id)`
- `useActiveSessions(profileId)` — list non-cancelled
- `useSession(id)` — single with full data
- Audit logging на критичные действия (создание, подтверждение charter, смена mode, подтверждение пакета) через `audit_logs`

---

## 5. Corporate Wizard — `src/components/corporate/CorporateWizard.tsx`

5-step Sheet wizard:


| Step | Компонент                   | Содержание                                                                                                                                                                                                                                |
| ---- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `CorporateStep1Company.tsx` | Выбор юрлица (reuse `useAiEntities`), год, показ карточки общества. **Не** auto-detect participantCount из links                                                                                                                          |
| 2    | `CharterIntakeStep.tsx`     | 3 табa: Upload (DOCX/PDF/image → `fileExtractor`), Text (textarea), Manual (structured form). Manual = first-class flow с явной отметкой «данные подтверждены пользователем, не извлечены из устава». Confirmation UI для каждого правила |
| 3    | `CorporateStep3Params.tsx`  | **Состав участников** (отдельный блок с типом, долей, голосами, представителем, присутствием). Параметры процедуры (дата/время/место/формат/голосование). Повестка (add/remove items). Кандидаты. Председатель/секретарь                  |
| 4    | `CorporateStep4Preview.tsx` | Manifest с inclusion/exclusion + `legal_basis` + `reason`. Warnings. Missing data. Кворум. «Что система создаст / что только учитывает»                                                                                                   |
| 5    | `CorporateStep5Confirm.tsx` | Summary. Кнопка «Подтвердить» (сохраняет status=`confirmed`). Генерация DOCX — Sprint 3                                                                                                                                                   |


---

## 6. Entry Point — `AiDocumentsGenerateView.tsx`

Новая секция **«Корпоративные документы»** перед «Пакеты документов»:

- Карточка «Годовое собрание ООО/ОДО» с иконкой Building2, badge «Новое»
- Кнопка «Начать» → открывает CorporateWizard
- Терминология: **участники** (не учредители), **решение единственного участника** (не протокол)

---

## 7. Audit

Логирование в `audit_logs` (best-effort, non-blocking — паттерн из `useGrpRefresh`):

- `corporate_draft.created`
- `corporate_draft.charter_confirmed` (с `charter_confirmed_by`)
- `corporate_draft.mode_changed`
- `corporate_draft.package_confirmed`

---

## 8. Мост к Sprint 2

В `corporateRuleEngine.ts` зафиксировать полный manifest обязательных шаблонов как constants:

```typescript
const ANNUAL_MEETING_TEMPLATES = [
  { code: 'corp_order_meeting', title: 'Решение/приказ о проведении годового собрания' },
  { code: 'corp_notice', title: 'Извещение участнику' },
  { code: 'corp_notice_journal', title: 'Журнал направления извещений' },
  { code: 'corp_review_list', title: 'Перечень документов для ознакомления' },
  { code: 'corp_draft_decisions', title: 'Проекты решений по вопросам повестки' },
  { code: 'corp_registration_list', title: 'Список зарегистрированных лиц' },
  { code: 'corp_ballot', title: 'Бюллетень/карточка голосования' },
  { code: 'corp_protocol', title: 'Протокол годового собрания' },
  { code: 'corp_notification_decisions', title: 'Уведомление о принятых решениях' },
];

const SOLE_PARTICIPANT_TEMPLATES = [
  { code: 'corp_sole_decision', title: 'Решение единственного участника' },
  { code: 'corp_sole_appendices', title: 'Приложения к решению' },
];

const CONDITIONAL_TEMPLATES = [
  { code: 'corp_board_candidates', title: 'Сведения о кандидатах в совет директоров', condition: 'has_board' },
  // ... auditor, charter amendments etc.
];
```

Также зафиксировать constraints для будущих DOCX-шаблонов (реквизиты документа, поля страницы, правила оформления) как documentation constants в `corporateTypes.ts`.

---

## Полный список файлов

### Новые


| Файл                                                 | Назначение                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------ |
| `src/lib/corporate/corporateTypes.ts`                | Types: CorporateParams, CharterRules, PackageManifest, Participant |
| `src/lib/corporate/corporateRuleEngine.ts`           | Rule engine + template manifest constants                          |
| `src/hooks/useCorporateDraftSession.ts`              | CRUD hook + audit logging                                          |
| `src/components/corporate/CorporateWizard.tsx`       | 5-step wizard shell                                                |
| `src/components/corporate/CorporateStep1Company.tsx` | Step 1: company + year                                             |
| `src/components/corporate/CharterIntakeStep.tsx`     | Step 2: charter (upload/text/manual) + confirmation                |
| `src/components/corporate/CorporateStep3Params.tsx`  | Step 3: participants + params + agenda                             |
| `src/components/corporate/CorporateStep4Preview.tsx` | Step 4: manifest preview + warnings                                |
| `src/components/corporate/CorporateStep5Confirm.tsx` | Step 5: summary + confirm                                          |


### Изменяемые


| Файл                                                      | Что                                       |
| --------------------------------------------------------- | ----------------------------------------- |
| `src/components/ai-documents/AiDocumentsGenerateView.tsx` | Добавить секцию «Корпоративные документы» |


### Миграции

- `corporate_draft_sessions` table + RLS + triggers + public_id
- `charter-documents` storage bucket + RLS

## Что НЕ меняется

- `GenerateAiDocumentDialog` / `GenerateAiDocumentPackageDialog`
- Edge functions `ai-generate-document` / `ai-generate-document-package`
- `document_templates` / `document_package_templates`
- `fields_registry` / `tokenRegistry`
- Billing / MNS / protected flows

## GAP на следующие спринты


| GAP                                   | Спринт |
| ------------------------------------- | ------ |
| DOCX шаблоны корпоративных документов | 2      |
| Arrays/loops в token builder          | 3      |
| Генерация DOCX из corporate wizard    | 3      |
| AI extraction из устава               | 4      |
| Audit trail расширенный               | 5      |


## DoD

- Таблица `corporate_draft_sessions` с public_id, RLS, created_by/updated_by
- Storage bucket `charter-documents`
- Corporate wizard 5 шагов доступен из «Создать документ»
- Состав участников с долями/голосами/представителями
- procedure_mode рассчитывается из подтверждённого состава участников
- Charter intake: upload/text/manual как равноправные modes
- Rule engine с legal_basis для каждого документа
- Кворум рассчитывается по долям/голосам
- Preview с inclusion/exclusion/reason/legal_basis
- Audit logging критичных действий
- Manifest Sprint 2 шаблонов зафиксирован в constants
- Existing flows не сломаны, build clean
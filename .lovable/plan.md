# да, согласен, с учетом правок:

&nbsp;

1. **В Fix #2 серверный manifest должен быть 1:1 совместим с фронтовым rule layer.**
  Не просто “похожа логика”, а один и тот же набор правил включения/исключения документов. Если выносите в _shared/corporate-manifest.ts, нужно явно потребовать:
  &nbsp;
  - одинаковые conditions,
  - одинаковые required_data,
  - одинаковые legal_basis,
  - одинаковый порядок документов.
    Нельзя допустить расхождение между preview на фронте и generation на сервере.
  &nbsp;
2. **В Fix #3 lookup по person_id нужно сделать не только для chair/secretary/participants, но и для кандидатов, если там уже есть ссылки.**
  Иначе часть payload будет правильно собираться из слоя B, а часть останется на name из draft session.
  Правило должно быть единым:
  person_id -> lookup из B, fallback на name только если ссылка отсутствует.
3. **В Fix #5 snapshot нужно хранить минимально достаточный, но воспроизводимый.**
  Поддерживаю отказ от полного хранения arrays с ПД, но в DoD надо добавить:
  &nbsp;
  - список использованных scalar keys,
  - список использованных array keys,
  - длины массивов,
  - boolean flags,
  - procedure_mode,
  - report_year,
  - refs (person_id, legal_details_id, corporate_draft_session_id),
  - manifest_snapshot,
  - runtime_status/template code на момент генерации.
    То есть snapshot должен позволять понять, **что и почему отрендерилось**, даже без хранения всех персональных данных повторно.
  &nbsp;
4. **Fix #6 сформулировать аккуратнее: не активировать даже scalar-only шаблоны “по умолчанию”, если они входят в единый corporate flow и требуют server proof.**
  Лучше записать:
  &nbsp;
  - допускается partial activation только там, где есть фактический proof render/storage/DB;
  - без proof статус не менять, даже если шаблон кажется scalar-only.
  &nbsp;
5. **В документации по Fix #7 отдельно добавить раздел “Server SoT vs Draft JSON”.**
  Нужно явно зафиксировать:
  &nbsp;
  - сохранённый package_manifest в session — это draft/debug artifact;
  - source of truth для generation — server-side recalculated manifest;
  - draft session не является окончательным источником template eligibility.
  &nbsp;
6. **В DoD добавить proof, что server-side pre-flight реально блокирует generation при битом template state.**
  Нужен хотя бы один негативный сценарий:
  &nbsp;
  - inactive template / missing template_path / missing storage file
  - generation не стартует
  - session не уходит в generated
  - status корректно остаётся/возвращается в confirmed
  &nbsp;
7. **Зафиксировать, что _shared/corporate-manifest.ts — pure/shared module без UI-зависимостей.**
  Чтобы потом его можно было использовать и в edge, и потенциально в фронте без дублирования логики.

&nbsp;

&nbsp;

В таком виде патч корректный и его можно брать в работу.

&nbsp;

PATCH S3-FIX-1 — Корректирующий патч Sprint 3

## Выявленные проблемы и исправления

### 1. Status flow: `generating` ставится до server-side pre-flight

**Текущий код** (строка 295): edge function ставит `generating` сразу после проверки `status === 'confirmed'`, ДО pre-flight.

**Исправление**: перенести `status='generating'` на строку после успешного `serverSidePreFlight()` (после строки 310), перед циклом генерации. Если pre-flight вернул 0 eligible — откат в `confirmed` без промежуточного `generating`.

### 2. Сервер использует `session.package_manifest` вместо пересчёта

**Текущий код** (строка 300): `const manifest = session.package_manifest as ManifestItem[]` — берёт сохранённый манифест.

**Исправление**: импортировать `calculatePackageManifest` logic server-side (inline pure function, т.к. edge function не может импортировать из `src/`). Пересобирать manifest из `corporate_params` + `confirmed_charter_rules` + `procedure_mode` + `rules_basis` на сервере перед pre-flight. Логику `calculatePackageManifest` вынести в `_shared/corporate-manifest.ts` как переиспользуемый модуль.

### 3. Chair/secretary/participants берут `name` из params, а не lookup по person_id из слоя B

**Текущий код**:

- Строка 102: `chair.name` из `corporate_params`
- Строка 125: `p.name` из `corporate_params.participants[]`

**Факт**: Step 3 уже сохраняет `person_id` для chair, secretary и каждого participant. Но edge function читает `name` из draft session вместо lookup.

**Исправление**: в edge function добавить batch-fetch `legal_details_persons` по всем `person_id` из params (chair, secretary, participants). Строить `full_name` из слоя B. Fallback на `params.*.name` только если `person_id` отсутствует (ручной ввод без привязки).

### 4. `vote_count` vs `votes_count` — несогласованность canonical key

**Текущий код**:

- `corporateTypes.ts` → `Participant.vote_count`
- `CorporateStep3Params.tsx` → `vote_count`
- Edge function payload → `votes_count` (строка 127)
- `tokenRegistry.ts` → `votes_count` в примере

**Исправление**: registry item_schema — SoT. Ключ в payload = `votes_count`. Маппинг в edge function уже правильный (`votes_count: p.vote_count`). Нужно: добавить комментарий в edge function, объясняющий маппинг; убедиться что DOCX шаблоны используют `votes_count`. Тип `Participant` в types оставить как есть (это internal model key, не payload key).

### 5. Snapshot недостаточно полный (слой F)

**Текущий код** (строки 460-464): фильтруются только non-empty scalar keys. Нет arrays, нет boolean flags, нет manifest_snapshot per-document.

**Исправление**: в snapshot per-document включить:

- Использованные scalar fields (уже есть)
- Использованные array keys + длины массивов (не сами данные — чтобы не дублировать ПД)
- Boolean flags
- `procedure_mode`, `report_year`
- Ссылки на person_id для chair/secretary (не ФИО — это из слоя B)

### 6. Runtime activation (Этап 6) — не выполнен

Это требует реального тестирования с шаблонами. В рамках этого патча: обновить `corporateTemplateSpec.ts` для тех шаблонов, которые используют только scalar tokens (без loops) — они могут быть переведены в `active` сразу. Для loop-dependent шаблонов — нужен proof после deploy.

### 7. Документация не обновлена

Обновить `docs/corporate-templates-rules.md` с:

- Generation flow
- 6-слойная SoT модель
- Per-packet scope ограничение
- Token compatibility
- Proof no second token system section

---

## Файлы


| Файл                                                        | Изменение                                                                               |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `supabase/functions/ai-generate-corporate-package/index.ts` | Fix #1 (status flow), #2 (server manifest recalc), #3 (person_id lookup), #5 (snapshot) |
| `supabase/functions/_shared/corporate-manifest.ts` (NEW)    | Server-side manifest calculation (pure function extracted from rule engine)             |
| `docs/corporate-templates-rules.md`                         | Fix #7 — full update                                                                    |
| `src/lib/corporate/corporateTemplateSpec.ts`                | Fix #6 — partial activation where provable                                              |


## Не изменяется

- `CorporateStep5Confirm.tsx` — frontend корректен (не ставит status)
- `CorporateWizard.tsx` — frontend корректен
- `corporateTypes.ts` — `vote_count` internal model key остаётся
- `_shared/docx-helpers.ts` — без изменений
- Миграция — не нужна

## DoD патча

1. `generating` ставится только после server pre-flight OK
2. Manifest пересчитывается на сервере из params/rules, а не из сохранённого JSON
3. Chair/secretary/participants ФИО берётся из `legal_details_persons` по `person_id`, fallback на `name` только при отсутствии person_id
4. `votes_count` единый canonical key в payload (маппинг из `vote_count` задокументирован)
5. Snapshot включает array summary + boolean flags + person_id refs
6. Документация обновлена
7. Build clean
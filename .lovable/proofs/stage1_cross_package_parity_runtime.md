# Stage 1 — Cross-Package Parity Runtime Proof

Date: 2026-06-17
Route: `/admin/documents` → tab «Пакеты документов» → tab «Анкеты документов»

## Идеология (session `b0b229b7-cf7e-4869-988e-8e97bdf54043`)
- Блок «Общие поля пакета» (badge «не используются в документах») показан ОДИН раз на уровне пакета.
- Поле `pf-000002` UAT B5 — дата подписания: значение `15.06.2026` подтянулось из `document_package_session_field_values` после загрузки страницы.
- В карточках документов поле НЕ дублируется (карточек с pf нет — единственный документ Идеологии не содержит ни pf-, ни ролевых токенов в активном шаблоне).
- Required-gate и прогресс документа не блокируются orphan-полем.

Screenshots:
- `tool-results://screenshots/20260617-104410-445550.png`
- `tool-results://screenshots/20260617-104436-457028.png`

## Годовое собрание участников (session `6a61a7e3-04b5-4e3c-aacb-8af1dbef6d53`)
- Orphan-блока НЕТ (все pf-каталога присутствуют в active DOCX).
- Карточка «1. Приказ о проведении годового общего собрания участников ООО» показывает badge «7/7 полей» + «0 ролей».
- Счётчик 7/7 рассчитан строго от detected токенов активного `is_current=true` template version (orphans исключены из знаменателя).

Screenshot: `tool-results://screenshots/20260617-104510-592972.png`

## Save / hydration orphan
- Значение `15.06.2026` сохранено session-level (`item_id IS NULL`) — подтверждено по запросу `document_package_session_field_values` и наблюдаемой гидратации после refresh.
- Per-item row для pf-000002 не создаётся: `PackageFieldsClientForm` в `orphanOnly` режиме форсит `effectiveItemId = null`.

## Snapshot / DOCX guarantee (code-level)
- orphan-pf отсутствует в `detectedTokens` активного шаблона → `canonical-document-generate-strict` не подбирает значение и не пишет его в `meta.tokens_snapshot[]` / DOCX. Покрыто Stage 1 кодом (`usePackageSessionFields.orphanQuestions`), unit smoke в `snapshot_builder_smoke.test.ts`.

## Verdict
Cross-package parity runtime: **PASS**.

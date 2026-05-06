# Canonical DOCX Generation — Roadmap

Status: Sprint 1 implemented (feature-flag OFF). Last update: 2026-05-06.

## Что делаем сейчас (Sprint 1 — MVP)
- Канонический deterministic DOCX-pipeline (Docxtemplater) в `_shared/document-render.ts`.
- Реестр токенов `document_token_registry` (system resolver-keys + ссылки на `fields_registry` для `legal_details.*`).
- Версионирование шаблонов: `document_template_versions` (фиксирует storage_path, токены, sha256).
- Snapshot/source_trace в `ai_generated_documents` (поля уже были; добавлены `context_type`, `context_id`, `idempotency_key UNIQUE`, `template_version_id`).
- Превью-сессии: `document_generation_sessions` (TTL 24h).
- Edge function `canonical-document-generate` (modes: preview / generate), RBAC = admin/super_admin.
- UI MVP: `CanonicalActGenerator` под вкладкой «Документы → Акты (canonical)».
- Feature flag `app_settings.documents_canonical_generation_enabled` (default `false`).

## Что НЕ делаем сейчас
- Не трогаем legacy: `ai-generate-document`, `generate-from-template`, `generate-invoice-act`, `generate-document-pdf`, `document-auto-generate`, `generated_documents`.
- Не включаем production auto-generation по оплате (требует отдельного подтверждения).
- Не отправляем email/Telegram автоматически.
- Не вводим `current_version_id NOT NULL` (nullable, мягкая миграция).
- Не меняем `orders_v2`.
- PDF-экспорт — отложен (только DOCX в Sprint 1).
- Не создаём дублирующих storage bucket (используем существующие `documents-templates` и `documents`).

## Целевая архитектура (финал)
```
[Admin UI: загрузка DOCX]
        │ парсинг {{токенов}} → сравнение с registry
        ▼
[document_template_versions]  ◄── snapshot DOCX + tokens
        │
        ▼
[Token Registry]   resolver-keys (system) + field_id (custom)
        │
        ▼
[Generation Session]  ── preview ──► UI: missing/unmapped/values
        │
        ▼ (validate, idempotency_key)
[Renderer: Docxtemplater]
        │
        ▼
[ai_generated_documents] (snapshot + source_trace + warnings)
        │
        ▼
[Storage: documents/canonical/{profile_id}/{number}.docx]
        │
        ▼ (optional, Sprint 3+)
[Email / Telegram / Cabinet / Google Drive sync]
```

## Roadmap
- **Sprint 1 (DONE)** — pipeline core + registry + UI MVP, gated.
- **Sprint 2** — token sidebar в редакторе шаблона, валидация при загрузке, `deal.amount_words` (русский propisью), парсер unmapped tokens с auto-suggest registry entry.
- **Sprint 3** — auto-generation по `payment_succeeded` (включаем флаг в prod), `document_generation_rules` биндится к каноническому resolver, idempotency через `idempotency_key`.
- **Sprint 4** — отправка клиенту (email/Telegram/cabinet) + сохранение в личном кабинете, ONLYOFFICE preview.
- **Sprint 5** — Google Drive export/sync (опционально).
- **Sprint 6** — корпоративные пакеты (multiple acts/contracts), loops в шаблонах.

## Жёсткие правила (canon)
- **Один renderer**: `_shared/document-render.ts`. Параллельные генераторы — запрещены.
- **Registry-first**: новые токены добавляются в `document_token_registry`, иначе — unmapped (рендерятся пустыми + warning).
- **Snapshot/source_trace mandatory**: каждая ai_generated_documents row содержит resolved_tokens, template_version_id, resolver_version, idempotency_key.
- **Feature flag mandatory**: production-генерация только при `documents_canonical_generation_enabled = true`.
- **Add-only**: legacy таблицы и функции не модифицируются и не удаляются до Sprint 4.
- **Idempotency**: ключ для order context = `service_act:{order_id}:{template_version_id}`.

## Legacy flows (нельзя ломать)
- `ai-generate-document` — UI «Документы → Создать документ» (юзер-генерация).
- `generate-from-template` — старый контрактный pipeline.
- `document-auto-generate` — старый авто-флоу для GorbovaAI годовых отчётов.
- `generate-invoice-act`, `generate-document-pdf` — счета/PDF (deprecated, но live).
- `generated_documents` (legacy таблица) — read-only для исторических записей.

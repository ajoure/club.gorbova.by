# Регламенты бухгалтерии — deployment manifest

## Scope

New `accounting_regulations` chat scenario, `ai_accounting_regulations` private
section, editable `access_rules` for the existing 5 CB20 and 8 CB21 tariffs.
Runtime authorization uses `resolveSectionAccess`, never product IDs or AI full
tier. Existing free chat and other scenario grants remain unchanged. Uploads are
not enabled. Uses existing Gemini Pro / Lovable gateway and prompt quotas.

UI: short guide, examples, 6000-character brief, questions, full draft/revisions,
history/resume, local Word edits and download. Local Word edits are explicitly
not saved to conversation history. AI drafts require human approval. The initial
brief is preserved beyond the 10-message rolling window; subsequent replies
recap agreed facts. No promise of unlimited context or legally approved text.

## Managed production apply (Lovable Cloud only)

1. Confirm exact merged SHA and free canonical chat. No code/commit authorship.
2. Read-only preflight: scenario/section absent, tariffs 5+8, existing rules
   unchanged. Any unexpected count or source drift: STOP.
3. Use canonical Cloud SQL editor to apply exact GitHub migration
   `20261002135930_cb_accounting_regulations.sql`. Run an atomic dry-run with
   ROLLBACK; expect 1 section, 1 prompt, 13 rules, then all 0 after rollback.
   Apply atomically with original-version journal record; do not create duplicate
   migration files. Read back 1/1/13, route/private flag and original old counts.
4. Deploy `gorbova-ai-chat`, `ai-access-status`. Shared release digest changed;
   deploy `sales-runtime-worker`, `sales-runtime-control`, `telegram-webhook`,
   `telegram-media-worker` unchanged except bundled shared code. Probe release
   markers without sending messages or running jobs.
5. Anonymous calls: 401. Read-only rule checks for active purchaser, no product,
   expired access. Synthetic operator `--self` smoke is allowed; no impersonation
   or new accounts. Operator bypass is NOT purchaser E2E proof.
6. Publish only after checks PASS. Production desktop/mobile screenshots and
   actual guide → questions → complete draft → revision → Word download → history
   resume. Record exact SHA, URL, viewport and evidence separately.

## Rollback

Disable only new prompt and section and the exact 13 new section rules. Preserve
history, existing sections/rules and tariffs. Redeploy previous versions if
needed. No destructive cleanup or unrelated production writes.

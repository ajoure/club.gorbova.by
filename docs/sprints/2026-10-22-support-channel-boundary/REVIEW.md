# Consolidated plan-only review (2026-10-22)

Reviewed HEAD 6581aed895f2e8dd14d2d9db99dadcc1271c4e32 via full diff attachment:
128258 bytes, 1963 lines, 25 files, SHA256
53fb84cf1925c4956178d8c76e4f84c936bc4db9d163b90a896ea64382536a51.
Lovable checked resultant blob fingerprints and current schema metadata only.
No production mutations/deploy/Publish. PR650 remains DRAFT.

Blocking findings to resolve before merge/deploy:

- F1: separate Edge GETs are not CAS. Pin recipient/incoming/assignment in an
  authorization protocol; cover assignment and profile races, not just state/INSERT.
- F2: outbound storage path and reply-to ID need server scope/ownership checks
  before privileged download or Telegram call.
- F3: legacy reaction SELECT RLS excludes section-based staff. Add scoped reaction
  reads and tests as authenticated without legacy admin; do not widen global RLS.
- F4: get_media_urls handles 20 IDs but UI records 200 as requested. Batch to 20,
  mark only returned IDs complete, retain/retry errors and partial results.
- F5: resolve must atomically finish the matching scoped assignments; otherwise
  a later question inherits an assignment that cannot be transferred.
- F6: assignment notifier links to combined UI/direct Telegram and selects any
  primary bot. Fix the existing notifier for support mode; future deployment
  plan must explicitly include this second function (not silently deploy it).
- F7: web eligibility must require bridge_enabled IS FALSE, not IS NOT TRUE;
  NULL configuration is unknown and must fail closed.
- F8: legacy unread is not proof of explicit resolution. Store/validate a separate
  observed resolution boundary for web close, invalidate on new incoming, and
  preserve explicit state across intermediate replies.
- F9: successful, fresh scoped history is required for send/reaction/state/assign;
  an error during refresh must not permit action using old cached history.

Schema confirmations: four configured bots active; new support DDL not installed.
Assignment source-message FK exists and PostgREST relation name is correct.
audit_logs.entity_id is TEXT; align synthetic fixture with production.

Follow-up review is limited to these findings and any new dependency they reveal.
No real messages, reactions, assignments, read flags, closes or payments as smoke.
Ready-media URL endpoint writes audit: do not use it as a read-only production smoke.

## F1/F2 metadata clarification (read-only, 12:22 UTC)

Current telegram_messages trigger chain does not update profiles. Incoming changes
NEW.requires_reply; broadcast capture writes broadcast tables without downstream
profile triggers; sales capture excludes non-Business. Outgoing sent_by_admin FK
may take KEY SHARE on the employee profile. Profile linking BEFORE UPDATE may
merge/delete an archived profile, so do not assume a simple recipient row lock.
Avoid a dialog advisory -> profile row / profile row -> dialog advisory cycle.

Storage objects has owner_id TEXT (authoritative candidate), deprecated owner UUID,
id UUID, bucket_id/name TEXT, version TEXT, updated_at, archived_at,
is_delete_marker and is_versioned. Active bucket/name uniqueness excludes archived
rows. Upload policies permit staff INSERT/UPDATE without an owner predicate; JWT
readability is not ownership proof. Verify actor owner_id and object identity/version
before privileged download and before using downloaded bytes. Nullable owner must
fail closed; do not fall back to deprecated owner. No client/file rows were read.

F6 future deployment explicitly includes contact-center-assignment-notify as the
second function, after code/tests/review. No deployment authorization is actionable
until all findings are addressed and exact merged SHA is verified.

## Local remediation for bounded follow-up review

F1/F2: service-only begin/finish claims, atomic pinned recipient/actor/incoming,
profile try-advisory guard, assignment lease guard including DELETE, no ambiguous
send retry. Fetch is 25s maximum inside 90s authorization. Quote scope validated
inside CAS; Storage owner_id, outbound prefix, identity/version checked before
and after privileged download. No network I/O before scope validation. New
incoming after authorization preserves unread, never implicitly resolves.

F3–F9 implemented locally as detailed in SPRINT; not yet approved/deployed.
Real PG tests cover both assignment/profile/CAS orderings; PGlite tests enforce
section-based reaction reads without legacy RLS, explicit web resolution marker,
NULL bridge exclusion, send nonce/unknown result, quote and upload ownership.
React integration covers cached history with failed refresh blocking sends.

Known operational limit: unknown sending claim requires delivery reconciliation
before any later send for the same dialog; timeout does not prove non-delivery.
Only service_role can finish/reconcile, after external/history evidence. No
customer body/file is stored in claims. Additive installation alone sends nothing.

## Bounded follow-up at HEAD 7dd16e9d (12:47 UTC)

Diff completeness confirmed (33 blobs, 189509 bytes); F2/F3/F4/F5/F7/F8 PASS.
Remaining F1/F6/F9 dependencies: legacy voice cleanup outside send gate; direct
assignment row -> advisory inversion vs resolve; service claims read-back ACL
and idempotent finish; notifier must derive support routing if hint omitted;
web history freshness must protect send/state actions too. No production writes.

Remediation: support voice delivery preserved with explicit format warning,
no support cleanup/delete; assignment BEFORE trigger uses try-advisory fail/retry
rather than waiting with a row lock. Deterministic real PG regression holds row
and advisory in opposite sessions then exercises direct UPDATE and DELETE.
Service gets SELECT + RLS policy for claims; writes only via service finish RPC,
which accepts identical confirmed result idempotently (lost response read-back).
Notifier derives exact support bot from server metadata, regardless of omitted
hint, and content query repeats scope filters. Web child reports successful
fresh history; parent state actions and child send block on mount/fetch/error.
Actual web workspace regression covers cached initial data and failed refresh.
Storage additionally rejects URL-ambiguous percent/query/fragment/backslash paths.
These changes require bounded verification of the remaining findings only.

## Narrow verification at HEAD 390f7391 (12:59 UTC)

F1 voice/SQL try-lock, claims ACL/idempotent finish and F9 PASS. Two remaining
facts: interactive psql stdin needed a trailing newline before awaiting marker;
service bot disabled/unavailable with no hint could still enter legacy fallback.
Corrected stdin framing and added a 20s process deadline. Notification routing
now rejects ALL pure bot sources lacking active+support_enabled configuration,
including missing bot, disabled bot and mislabeled Business metadata; only an
explicit Business source can take the existing non-support operator path.
Regression covers each refusal without hint. No production action performed.

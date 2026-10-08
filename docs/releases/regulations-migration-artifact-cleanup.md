# PR609 managed migration artifact cleanup

## Applied backend change

Merged source: 95dbacd06cedd382832e43ebef416d4fcb3a9806.
Managed Lovable migration applied on 2026-10-08 at 14:23:54.527 UTC.
The canonical SQL remains supabase/migrations/20261008121522_regulations_managed_cohort_access.sql.
The tool copy differs only by its missing terminal newline.
Database journal: drizzle.__drizzle_migrations id 2, SHA256
3cfd49fd115e2e15fe3a8984b2108b19cf2593c386cd424bd8ad4225efb2c575.
Exactly one entry belongs to this change; id 1 belongs to the prior PR596.
No entry was written to supabase_migrations.schema_migrations by this tool.

Function definition MD5 changed from e9417f737dc24c452c0f7e492f9edcb9
to 9909a153d6b8ce3d1f537732c16a059a. Only the reviewed product predicate
changed. Owner, EXECUTE ACL, STABLE, SECURITY DEFINER and search_path stayed
unchanged. Aggregate before/after eligible sets have symmetric difference zero
for all four services: regulations 64, acts 64, bank 64, classifier 183.
Production set comparison repeats the function branches; direct RPC execution
was unavailable to the read role. It is not represented as purchaser UI proof.
The 45 PostgreSQL synthetic cases and ACL/idempotency/drift guards passed again.

## Corrective source-only scope

The managed tool unexpectedly scaffolded package dependencies, config and a
blank schema; its agent accidentally committed two temporary inspection files.
This PR restores package.json and bun.lock byte-for-byte to the reviewed source
and removes only those accidental root/config/schema files. These changes do
not alter production database state, data, rules, users or payments.

Keep the tool SQL, filesystem journal and empty snapshot together. The snapshot
is required to keep journal metadata consistent; it defines no application
tables. Future managed-tool runs may scaffold config/dependencies again and
must receive a scoped preflight instead of silently expanding source changes.

Generated .vite-cache-v5 noise is unchanged by this PR and is a noncritical
follow-up. No frontend code changes, function deployment or Publish required.
Published UI/Word acceptance remains the PR608 release, not this backend SHA.
No notification has been created or sent; draft text/audience need human approval.

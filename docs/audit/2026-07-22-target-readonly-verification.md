# Read-only verification of the legacy target

Date: 2026-07-22  
Target: user-owned Supabase `club.gorbova.by` (`ypwsuumurrtkxatoyqhk`)

## Scope

This was a read-only inventory. No SQL DDL/DML, migration, function deployment,
secret, authentication, Storage, or project-setting change was made.

## Confirmed state

| Check | Result |
| --- | ---: |
| Project state | `ACTIVE_HEALTHY` |
| Postgres major version | 17 |
| Tables in `public` | 100 |
| `public` tables without RLS | 78 |
| Storage buckets | 0 |
| Storage objects | 0 |
| Auth users | 1 |
| Deployed Edge Functions | 100 |
| Current local function directories from GitHub `main` | 337 (including `_shared`) |

## Decision

The target is an outdated, partially populated copy rather than a safe base for
an in-place upgrade. It must not be treated as a source of truth and must not
receive a mass `db push`, an RLS-only patch, or function deployment before the
source snapshot, a clean migration plan, and a repeatable test environment are
available.

The RLS finding is deliberately not remediated here. Enabling RLS without the
required policies would break current access paths, while permissive policies
would preserve the security issue. The policies must be rebuilt and tested as
part of the isolated migration, not patched into this legacy copy.

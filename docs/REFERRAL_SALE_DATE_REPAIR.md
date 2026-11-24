# Historical referral sale date repair

The internal `referral-sale-date-repair` endpoint invokes only the guarded
`referral_retime_historical_sales` RPC. Deploy after the corresponding managed
migration. It accepts the exact managed service key using the shared constant-time
authentication helper; `verify_jwt=false` supports current non-JWT managed API keys.
No authenticated-user or anonymous access is accepted. No credential is returned
or logged. The server-side Supabase client supplies the genuine service identity.

POST accepts only `p_operation_key`, `p_items`, `p_expected_balances`, and boolean
`p_dry_run` (defaults to true). The database validates the frozen cohort, payment
evidence, balances, holds, previous ledger state, and native maturation results.
The adapter neither constructs ledger entries nor invokes product, payout or
notification workers. It calls the RPC once and never retries.

For an uncertain transport result, inspect attribution audit metadata and the
operation key independently before further action. A successful response must
still be independently checked against balances, dates, ledger and exclusions.
Do not use a real financial write as a smoke test. Customer-specific request
bodies and before/after artifacts belong only in the private operational folder.

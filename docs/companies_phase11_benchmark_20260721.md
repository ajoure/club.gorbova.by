# Companies Phase 11 — authenticated UI benchmark

Статус: read-only benchmark завершён в Lovable Preview; production не
публиковался, CRM/Supabase данные не изменялись.

## Окружение

- target: `http://localhost:8080/admin/companies` внутри managed Lovable Preview
- authenticated session: admin user
- viewport: `1280×1800`
- Preview SHA: `b26b4c1064bdbf92c2d8d3a6286a08b9c65edab6`
- method: Playwright + headless Chromium; `performance.perf_counter()` до
  появления целевого DOM-узла и `networkidle`
- repetitions: 10 (one cold sample + nine warm samples)

## Results

| Operation | Samples (ms) | Warm p50 | Warm p95 | All p95 | Target | Result |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Search (`Фармакон`) | 71.8, 51.8, 54.1, 49.8, 61.4, 52.9, 62.8, 51.2, 47.7, 56.9 | 52.9 | 62.8 | 71.8 | ≤500 | PASS |
| Company card (`d9ad08a3-bc36-4a37-be16-7f8a5d2f5bc0`) | 2770.8, 181.4, 60.8, 96.2, 65.6, 70.3, 77.4, 98.9, 61.3, 78.8 | 77.4 | 181.4 | 2770.8 | ≤1500 | warm PASS |

The 2770.8 ms card sample includes the complete cold SPA/auth/list startup;
it is not an isolated `CompanyDetailsSheet` latency. Warm card latency meets
the Phase 11 target.

## Explicit limitations

- A server-only `search_companies` p95 without React Query cache requires
  service-role `pg_stat_statements`, unavailable to the read-only sandbox.
- Production RUM is not enabled in Preview.
- A rotating-company-ID sample was not run; the card sample uses one existing
  company and is intentionally reported as warm UI latency.

For a reproducible run with an available authenticated session, use
`npm run companies:benchmark` as documented in the cutover runbook.

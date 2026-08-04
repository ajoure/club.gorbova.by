# Alternate `a.` access contour

## Purpose

Provide a narrow, opt-in route through the existing Hoster.by VPS for a small
team whose network cannot reliably reach the Lovable edge. Canonical domains,
DNS and normal Belarus traffic remain unchanged.

## Host map

| Alternate host | Canonical upstream |
| --- | --- |
| `a.gorbova.by` | `gorbova.by` |
| `a.club.gorbova.by` | `club.gorbova.by` |
| `a.cb.gorbova.by` | `cb.gorbova.by` |
| `a.cons.gorbova.by` | `cons.gorbova.by` |
| `a.consultation.gorbova.by` | `consultation.gorbova.by` |
| `a.zg.gorbova.by` | `zg.gorbova.by` |
| `a.calendar.club.gorbova.by` | `calendar.club.gorbova.by` |

`access.gorbova.by` and `pdf.gorbova.by` are infrastructure endpoints and are
explicitly excluded. There is no broad wildcard DNS record.

## Safe release order

1. Merge a clean, reviewed GitHub PR.
2. In Lovable Cloud, synchronize the exact merged SHA; do not regenerate code.
3. Deploy every changed Edge Function and every function that bundles the
   changed `_shared` payment helpers.
4. Add Supabase Auth redirect allow-list entries for each exact host with a
   wildcard path, for example `https://a.club.gorbova.by/**`. Do not add a
   wildcard hostname.
5. Publish the UI from the same SHA.
6. Add seven exact Hoster.by A records to `178.172.173.1`, TTL 600.
7. Back up the VPS Caddyfile, include
   `ops/caddy/gorbova-access-aliases.Caddyfile`, run `caddy validate`, then
   reload Caddy. Roll back the include immediately if validation fails.
8. Verify DNS, TLS, canonical routing, CORS, auth/OTP, test checkout return,
   account and admin pages. Capture desktop and mobile screenshots.

DNS/Caddy activation is deliberately last: an alternate address must not be
public while its application and Edge Function release is still incomplete.

## Production verification

- Canonical domains still resolve directly to their existing target.
- Every alternate host resolves only to `178.172.173.1` and presents a valid
  certificate for that exact hostname.
- `X-Robots-Tag: noindex, nofollow, noarchive` is present and the application
  also injects the equivalent robots meta tag.
- Absolute internal links remain in the `a.` contour; external links and the
  infrastructure hosts are not rewritten.
- Domain-based site builder lookup uses the canonical hostname.
- OTP email links, bePaid/Stripe success and cancel returns preserve the exact
  safe alternate origin.
- No live payment is used. Use the existing authorized simulated test-payment
  path and verify that the order, payment and entitlement records reconcile.
- Run desktop and mobile smoke checks for public, auth, account and admin
  surfaces; verify there is no horizontal overflow or clipped text.

## Adding a future site

Do not use `*.gorbova.by`. Add one exact `a.<canonical-host>` DNS record, one
explicit Caddy block with the canonical Host/SNI, one exact Supabase redirect
entry, and one desktop/mobile acceptance check. The application helper already
supports eligible exact `a.*.gorbova.by` hostnames without another UI patch.

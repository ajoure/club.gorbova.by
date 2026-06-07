# План: Phase 8 — Receipts / Documents (+ 2 hotfix)

Статус (актуальный, после approve):

1. **Hotfix-1** — Stripe currency = валюта offer + fallback на `offer.amount` → **CODE COMPLETE**.
   Proof: `.lovable/proofs/hotfix_stripe_currency_v1.md`. Ждёт runtime smoke.
2. **Hotfix-2** — bePaid 404 в cancel/replace = success → **CODE COMPLETE**.
   Proof: `.lovable/proofs/hotfix_bepaid_cancel_404_v1.md`. Ждёт runtime smoke.
3. **Phase 8-A Discovery** — read-only inventory документов/чеков → next step.
4. **Phase 8-B…F** — НЕ начинать без отдельного approve после Discovery.

---

## Жёсткие границы (по revised approve)

- Whitelist валют Stripe в проекте: BYN / USD / EUR / PLN. Только.
- Никакого currency conversion / FX rates.
- Phase 8: storage copy НЕ делать. Provider-native external URLs только.
- ЭСЧФ, налоговые документы, PDF generator — **out of scope** навсегда.
- Новых edge function под Phase 8 сейчас не создавать. Backfill — отдельной фазой, по результатам Discovery; предпочесть report-only через SQL/proof.
- GRANT новой таблицы (если будет): без DELETE для `authenticated`.
- Memory `mem://commercial-logic/subscriptions/safe-replacement-flow` дополнить после Hotfix-2 smoke PASS.

---

## Что выполняется в этой итерации

- ✅ Hotfix-1 (код) — выполнено.
- ✅ Hotfix-2 (код) — выполнено.
- ⏭ Phase 8-A Discovery — следующий шаг после твоего approve Hotfix-1/2.

После Phase 8-A — отдельное решение по Phase 8-B (новая таблица vs reuse / нужна ли миграция / где UI блок документов).



## Plan is finalized — ready for implementation

The plan has been thoroughly reviewed across multiple iterations. No further design changes needed.

**Scope**: Single file — `src/components/shared/HtmlIframePreview.tsx`

**Key changes**:
1. Add `allow-scripts` to sandbox policy (documented as intentional for admin content)
2. Inject resize script in `buildSrcdoc()` with staged height sync + `beforeunload` cleanup
3. Replace fixed 500px with `useState(minHeight)` + message listener with full validation chain
4. Reset height on empty `html`, clamp on `minHeight` change

**Post-implementation verification**:
- Single HTML block auto-resizes
- Multiple HTML blocks on one page are independent
- Rapid clear → paste cycles converge to correct height

Approving this plan will proceed to implementation.


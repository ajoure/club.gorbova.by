

# Evaluation: Plan is ready — two small risks to address during implementation

The plan is architecturally correct. The three-branch approach (already processed / full document / fragment) properly covers all input types.

**Two risks worth calling out:**

1. **Marker collision**: `data-resize-injected` is generic enough that admin-pasted HTML could theoretically contain it. Use a more specific marker like `data-lovable-resize-v1` to virtually eliminate false positives.

2. **Duplicate `<base>` tags**: The plan says "inject `<base target="_blank">` before `</head>` if not already present" — good, but the check must be case-insensitive and handle `<base` with other attributes (e.g. `<base href="...">`). If a `<base>` already exists without `target="_blank"`, the safest behavior is to leave it alone rather than inject a second `<base>` (browsers only honor the first one).

**Nothing else is missing.** The scope, security boundary, component logic preservation, and verify checklist are all correct. Ready for implementation.


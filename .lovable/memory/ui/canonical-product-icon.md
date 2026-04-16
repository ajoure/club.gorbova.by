---
name: Canonical Product Icon
description: Layers (lucide-react) with text-indigo-500 is the canonical product icon across the system. Package is forbidden for product contexts.
type: design
---
Canonical product icon: `Layers` from lucide-react, colored `text-indigo-500`.
Replaced `Package` in all product-context files. `Package` is only kept for document-package semantics (AI docs, installments).
In `useAdminMenuSettings.tsx`, backward compat alias `Package: Layers` exists for DB records storing "Package" as icon key.

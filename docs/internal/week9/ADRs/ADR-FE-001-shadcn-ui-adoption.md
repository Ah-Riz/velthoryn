# ADR-FE-001: shadcn/ui Component Library Adoption

**Status:** Active
**Date:** 2026-06-14
**Owner:** Geral (Frontend)

## Context

The Week 6–7 frontend used raw Tailwind CSS utilities for all interactive
components. This produced three problems: (1) accessibility attributes were
inconsistent — `WrapSolModal` lacked a focus trap and `CancelConfirmDialog`
had no `aria-labelledby`; (2) modal overlay CSS was duplicated between
components; (3) colour values were hardcoded in class strings with no unified
dark-mode token layer.

## Decision

Migrate to shadcn/ui (`components.json`) as the primitive layer. Added
`Card`, `Badge`, `Dialog`, `Button`, `Input`, and `Label` primitives.
`TokenPickerModal` and `WrapSolModal` upgraded to `shadcn/ui Dialog` for
focus trapping, `aria-modal="true"`, and escape-key dismiss. Campaign detail
page rewritten with a Card-based 6-metric grid.

E2E selectors migrated from brittle CSS class selectors (`.modal-overlay`)
to ARIA role-based selectors (`role=dialog`, `role=button[name="Cancel"]`).

## Consequences

**Positive**
- Consistent ARIA accessibility for all interactive overlays without manual
  attribute management.
- Dark mode CSS variables unified in `globals.css` (105-line block: background,
  foreground, card, popover, primary, secondary, muted, accent, destructive,
  border, input, ring tokens).
- E2E test resilience improved — ARIA selectors survive component refactors.

**Negative / trade-offs**
- Bundle size increased; acceptable given tree-shakeable primitives.
- shadcn/ui `Dialog` requires Radix UI as a peer dependency.

## References

- Commits: `e1ec4b8`, `07213ca`
- `apps/web/src/components/ui/` — shadcn/ui primitives
- `apps/web/src/app/globals.css` — CSS custom property block

# ADR-FE-001: shadcn/ui Component Library Adoption

**Status:** Accepted

## Context

The Week 6-7 frontend used raw Tailwind CSS utilities for all interactive components. This produced three problems:

1. Accessibility attributes were inconsistent -- `WrapSolModal` lacked a focus trap and `CancelConfirmDialog` had no `aria-labelledby`.
2. Modal overlay CSS was duplicated between components.
3. Colour values were hardcoded in class strings with no unified dark-mode token layer.

## Decision

Migrate to shadcn/ui (`components.json`) as the primitive layer. Added `Card`, `Badge`, `Dialog`, `Button`, `Input`, and `Label` primitives. `TokenPickerModal` and `WrapSolModal` upgraded to shadcn/ui Dialog for focus trapping, `aria-modal="true"`, and escape-key dismiss. Campaign detail page rewritten with a Card-based 6-metric grid.

E2E selectors migrated from brittle CSS class selectors (`.modal-overlay`) to ARIA role-based selectors (`role=dialog`, `role=button[name="Cancel"]`).

## Consequences

**Positive:**
- Consistent ARIA accessibility for all interactive overlays without manual attribute management.
- Dark mode CSS variables unified in `globals.css` (105-line block covering background, foreground, card, popover, primary, secondary, muted, accent, destructive, border, input, ring tokens).
- E2E test resilience improved -- ARIA selectors survive component refactors.

**Negative:**
- Bundle size increased; acceptable given tree-shakeable primitives.
- shadcn/ui `Dialog` requires Radix UI as a peer dependency.

## Alternatives Considered

- **Continue with raw Tailwind:** No added dependency but accessibility and dark mode remain manual and inconsistent.
- **Headless UI (Tailwind Labs):** Similar accessibility benefits but less ecosystem adoption in the React/Next.js community compared to shadcn/ui.
- **Material UI / Chakra UI:** Full component libraries with larger bundle sizes and opinionated styling that conflicts with the existing Tailwind setup.

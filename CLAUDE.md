# Project Conventions for Claude Code

> Append the section below to your project's existing `CLAUDE.md`, or use this file as a starting point.

## Spec-Driven Development

This project uses a spec-driven workflow inspired by Kiro, with two layers of context:

- **Steering** (`.claude/steering/*.md`) — project-wide context. Loaded broadly. Describes the product, the tech stack, and the project structure. Evolves slowly.
- **Specs** (`.claude/specs/<slug>/*.md`) — per-feature context. Each spec is a folder containing `requirements.md`, `design.md`, `tasks.md`, and (after implementation) `verification.md`.

Steering describes the codebase. Specs describe specific changes to it. They do not overlap.

### Pipeline

1. **Once per project:** `/spec-steering` → produces `product.md`, `tech.md`, `structure.md`. Refresh when reality changes.
2. **Once per feature:**
   - `/spec-init` → user reviews `requirements.md` → approves
   - `/spec-design` → user reviews `design.md` → approves
   - `/spec-tasks` → user reviews `tasks.md` → approves
   - `/spec-implement` → executes one task at a time, stopping after each
   - `/spec-verify` → traces implementation back to spec, produces `verification.md`

### Rules

1. **Before any non-trivial feature, check `.claude/specs/`.** If no relevant spec exists, propose `/spec-init` first. The `spec-gate` hook will inject this reminder when your prompt looks like a feature request — treat it as authoritative.
2. **Trivial changes are exempt.** Bug fixes, typos, single-line tweaks, config updates, and exploratory spikes do not need a spec. The `/spec-init` skill will push back if you try to use it for something tiny.
3. **Phases run with explicit approval gates.** Do not chain phases automatically. The pause is the whole point.
4. **Strict separation: requirements are functional, design is technical.** `requirements.md` describes user-visible behavior — never files, classes, or libraries. `design.md` describes the implementation — files, classes, libraries, schemas. Cross-contamination is a smell.
5. **Specs are version-controlled and persistent.** Commit `.claude/specs/` and `.claude/steering/` to git. Do not gitignore them. After a feature ships, you may move its folder to `.claude/specs/done/<slug>/` to keep the active list tidy, but **do not delete it** — it remains the source of truth for *why* the feature exists when someone needs to maintain it later.
6. **Specs are living documents.** When requirements change mid-implementation, update `requirements.md` first, then propagate to `design.md` and `tasks.md` with user approval before resuming code changes.
7. **A green task list is not a satisfied spec.** Run `/spec-verify` after the last task. The agent will frequently mark tasks `[x]` while quietly missing requirements; verification is the only reliable check.

### When the spec and the code disagree

- Code wrong, spec right → fix the code (new task in `tasks.md`).
- Spec wrong, code right → propose a spec amendment, get user approval, update the spec.
- Both wrong → stop and discuss with the user before either is changed.

Never silently reconcile a divergence by editing one to match the other.

### When NOT to use this workflow

- One-off scripts, tutorials, or learning experiments.
- Bug fixes where the cause and fix are both already understood.
- Spikes — exploratory code where the goal is to learn, not to ship.
- Features so small that writing the spec takes longer than writing the code.

If you find yourself producing 16 acceptance criteria for a one-line change, the workflow is wrong for the task — not the other way around.

# Vesting UX & Production Hardening — Requirements

**Phase:** F4 (Vesting UX) + P2 (Production Hardening)
**Depends on:** `bulk-send` (F1.2 schedule math), `production-security-ops` (P0 + P1)
**Estimate:** 8 days (3 days F4 + 5 days P2)
**Priority:** Lower than F1-F3; ships incrementally

---

## Overview

The Vesting UX phase adds schedule simulation and template presets to give creators and beneficiaries transparent, month-by-month visibility into how tokens unlock over time before and after a campaign is created. The Production Hardening phase prepares the system for sustained production use by adding error monitoring, API versioning, database migration discipline, backup procedures, load testing, and a smart-contract guard against Token-2022 mints.

---

## User Stories

### Theme 1: Schedule Simulation

#### US-1.1 — Simulate a vesting schedule before creating a campaign

**As a** Creator, **I want** to preview a month-by-month breakdown of how my tokens will vest given a set of schedule parameters, **so that** I can confirm the unlock timeline matches my intent before committing tokens on-chain.

- **GIVEN** I have chosen an amount, release type, start time, cliff time, and end time
- **WHEN** I request a schedule simulation
- **THEN** the system returns a list of monthly entries, each showing the date, the amount vesting that month, the cumulative vested amount, and the percentage of total supply vested
- **AND** the cumulative amount in the final entry equals the total amount I specified
- **AND** all numeric values are returned as strings to avoid precision loss

#### US-1.2 — Simulate a cliff schedule

**As a** Creator, **I want** to simulate a cliff vesting schedule, **so that** I can see that no tokens vest before the cliff date and the full amount vests at the cliff.

- **GIVEN** I specify a cliff release type with a start time and cliff time
- **WHEN** I request a schedule simulation
- **THEN** every monthly entry before the cliff date shows zero vested and zero cumulative
- **AND** every monthly entry at or after the cliff date shows the full amount as vested and cumulative

#### US-1.3 — Simulate a linear schedule

**As a** Creator, **I want** to simulate a linear vesting schedule, **so that** I can see progressive monthly unlock from the cliff date to the end date.

- **GIVEN** I specify a linear release type with start, cliff, and end times spanning one year
- **WHEN** I request a schedule simulation
- **THEN** the first monthly entry after the cliff date shows a non-zero vested amount
- **AND** each subsequent month shows an increasing cumulative amount
- **AND** the final entry shows the full total amount vested
- **AND** percentage values are accurate within 0.01% of the expected value

#### US-1.4 — Simulate a milestone schedule

**As a** Creator, **I want** to simulate a milestone vesting schedule, **so that** I can see that no tokens are time-vested before the cliff and the full amount becomes available after the cliff (with creator-controlled release).

- **GIVEN** I specify a milestone release type with a start time and cliff time
- **WHEN** I request a schedule simulation
- **THEN** every monthly entry before the cliff date shows zero vested
- **AND** every monthly entry at or after the cliff date shows the full amount as vested
- **AND** the simulation indicates that actual disbursement requires the creator to release each milestone

#### US-1.5 — Reject invalid simulation parameters

**As a** Creator, **I want** to receive clear errors when I submit invalid schedule parameters, **so that** I can correct my input before trying again.

- **GIVEN** I submit a simulation request with a start time that is after the end time
- **WHEN** the system validates my request
- **THEN** the system returns a 400 error with a descriptive message indicating the time range is invalid

- **GIVEN** I submit a simulation request with a zero amount
- **WHEN** the system validates my request
- **THEN** the system returns a 400 error with a descriptive message indicating the amount must be positive

---

### Theme 2: Schedule Template Presets

#### US-2.1 — Browse predefined schedule templates

**As a** Creator, **I want** to see a list of predefined vesting schedule templates, **so that** I can quickly select a common configuration without manually entering every parameter.

- **GIVEN** the template list is available
- **WHEN** I request the schedule templates
- **THEN** the system returns at least four templates: a four-year linear with one-year cliff, a two-year linear, a one-year cliff, and a four-milestone schedule
- **AND** each template includes a unique identifier, a human-readable name, a description, a release type, and the schedule parameters

#### US-2.2 — Understand what a template does before selecting it

**As a** Creator, **I want** each template to include a plain-language description, **so that** I understand the vesting behavior without needing to interpret raw parameters.

- **GIVEN** I am viewing the template list
- **WHEN** I read the description of the four-year linear with one-year cliff template
- **THEN** the description explains that 25% unlocks after one year followed by monthly unlock over three years

---

### Theme 3: Error Monitoring

#### US-3.1 — Automatically capture unhandled API errors

**As an** Admin, **I want** all unhandled exceptions in API routes to be automatically captured and reported to an error monitoring service, **so that** I am alerted to production issues without manually checking logs.

- **GIVEN** the error monitoring integration is active in the production environment
- **WHEN** an API route throws an unhandled exception
- **THEN** the exception is captured by the monitoring service with its stack trace
- **AND** the error event includes the environment name (production, preview, or development)

#### US-3.2 — Capture failed RPC calls

**As an** Admin, **I want** failed Solana RPC calls to be reported to the error monitoring service, **so that** I can detect connectivity or node issues affecting the application.

- **GIVEN** the error monitoring integration is active
- **WHEN** an RPC call to the Solana cluster fails
- **THEN** the failure is reported to the monitoring service with context about which RPC method was called

---

### Theme 4: API Versioning

#### US-4.1 — Identify the API version in every response

**As a** Creator or Beneficiary, **I want** every API response to indicate which version of the API served it, **so that** I can programmatically detect breaking changes.

- **GIVEN** I make any API request to the application
- **WHEN** the response is returned
- **THEN** the response includes an HTTP header indicating the API version number
- **AND** the version number is a constant (1) for all current routes

---

### Theme 5: Database Migration Strategy

#### US-5.1 — Apply database changes through explicit migration files

**As an** Admin, **I want** database schema changes to be applied through explicit, reviewable migration files rather than automatic schema diffs, **so that** I have an auditable history of every database change and the ability to plan rollbacks.

- **GIVEN** a developer has modified the database schema in code
- **WHEN** the change is ready for deployment
- **THEN** a migration file is generated capturing the exact SQL to apply
- **AND** the migration file is committed to version control and reviewed before deployment
- **AND** running the migration command on a fresh database applies all migrations in sequential order and produces the expected schema

---

### Theme 6: Backup and Restore

#### US-6.1 — Recover data from a point-in-time backup

**As an** Admin, **I want** the database to support point-in-time recovery, **so that** I can restore data to a specific moment if corruption or accidental deletion occurs.

- **GIVEN** point-in-time recovery is enabled on the database
- **WHEN** data loss or corruption is detected
- **THEN** I can restore the database to its state at any point within the retention window
- **AND** the restore procedure is documented with step-by-step instructions

#### US-6.2 — Verify backups are working

**As an** Admin, **I want** a regular verification that backups are completing successfully, **so that** I am not caught without a valid backup when I need one.

- **GIVEN** backups are scheduled to run periodically
- **WHEN** a backup verification check runs
- **THEN** the check confirms that the latest backup exists and the row counts in critical tables match expected values

---

### Theme 7: Load Testing

#### US-7.1 — Confirm the API handles expected production traffic

**As an** Admin, **I want** to know that the API can sustain at least 100 requests per second on read endpoints and 10 requests per second on write endpoints without degraded performance, **so that** the system remains responsive under normal load.

- **GIVEN** load test scripts are configured against a running instance of the application
- **WHEN** a load test runs simulating 100 RPS on GET endpoints with a ramp-up period
- **THEN** the 95th-percentile response latency remains below 500 milliseconds
- **AND** the error rate remains below 1%
- **AND** the test produces a report showing p50, p95, and p99 latencies and total error count

---

### Theme 8: Token-2022 Mint Guard

#### US-8.1 — Reject Token-2022 mints at campaign creation

**As a** Creator, **I want** the smart contract to reject Token-2022 mints when I create a campaign or stream, **so that** I am protected from silent transfer fee deduction issues that Token-2022 introduces.

- **GIVEN** I attempt to create a campaign using a mint that was created by the Token-2022 program
- **WHEN** the transaction is submitted
- **THEN** the transaction fails with a clear error indicating that Token-2022 mints are not supported

#### US-8.2 — Accept classic SPL Token mints without change

**As a** Creator, **I want** campaigns and streams using classic SPL Token mints to continue working exactly as before, **so that** the Token-2022 guard does not affect existing functionality.

- **GIVEN** I attempt to create a campaign using a mint that was created by the classic SPL Token program
- **WHEN** the transaction is submitted
- **THEN** the transaction succeeds normally with no change in behavior

---

## Non-Functional Requirements

- **Incremental delivery:** F4 and P2 items are lower priority than F1-F3 and may ship independently. Each item in this spec must be deployable without requiring other items in this spec to be complete.
- **No database writes for simulation:** The schedule simulation endpoint must be a pure computation with no database reads or writes, ensuring it adds zero load to the database and is safe to call at high frequency.
- **Static data for templates:** The schedule templates endpoint must return predefined static data without any database query, ensuring consistent low-latency responses.
- **Environment separation:** The error monitoring integration must tag events by environment (production, preview, development) so that production errors are never mixed with development noise.
- **No breaking changes from API versioning:** Adding the version header must not change the behavior or response shape of any existing endpoint. Current routes continue to serve the same responses with an additional header.
- **Backward-compatible migrations:** The switch from schema-diff push to explicit migrations must not alter the current database state. All existing migrations must replay cleanly on a fresh database.
- **Load test reproducibility:** Load test scripts must be deterministic and runnable by any developer with a single command against a local or staging environment, producing a structured report.
- **SC test stability:** The Token-2022 guard must not break any of the existing 86 smart-contract tests. The test suite must grow by exactly one new test (87/87 passing).

---

## Dependencies

- **F1.2 (TS schedule math):** The simulation endpoint depends on the TypeScript schedule math library that mirrors the Rust schedule logic. This library must produce identical results to the on-chain vesting calculations for the simulation to be meaningful.
- **P0 (Security Gate):** Rate limiting and authentication middleware must be in place before the simulation endpoint is publicly available, since it is a POST route that accepts arbitrary input.
- **P1 (Operational Baseline):** Structured logging and error classification should be in place before Sentry integration so that captured errors carry consistent context.

---

## Out of Scope

- Milestone release via API (triggering `set_milestone_released` on-chain). This is covered in F3.
- Campaign-level release type enforcement (rejecting mixed release types in one campaign). This is a policy decision deferred to product confirmation.
- Performance monitoring and tracing beyond error capture (e.g., Sentry APM, custom metrics endpoint). This is a future hardening iteration.
- DeFi composability, Squads multisig integration, Pinocchio optimization, proptest, cargo-fuzz, or DAO governance. These are Phase 2-3 items.
- Front-end dashboard UI changes. This spec covers the API and backend capabilities only; front-end consumption is a separate concern.

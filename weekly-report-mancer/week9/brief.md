Week 9:
Technical Documentation — Instruction reference (every instruction with parameters, behavior, error codes), integration guide with code examples, 3+ architecture decision records (why Anchor over Native, why this account structure, etc.)

Documentation
Signal
Due 2026-06-20
Your Role

There are 2 developers per team. You share the same codebase and deliver the same product together. The weekly task describes what your dev pair must deliver, not what one person does alone. How you split the work is your decision.

Each developer submits their own weekly report. In your report, you must clearly state:
- What YOU specifically built or contributed this week
- How you and your partner split the work
- Your individual blockers and insights

The reviewer scores each developer individually based on their actual contribution visible through git commits, PRs, and what you describe in your report. If one developer does all the work and the other contributes nothing, the scores will reflect that.

Task Brief
— Technical Documentation
Context

Your product works. Your BD team has users. Your Marketing team has content. But if another developer wanted to integrate with your protocol or a new team member joined — could they figure it out without asking you? Good documentation is what separates a side project from a real product.

What Needs to Happen

Write documentation that lets someone who has never seen your code understand, use, and integrate with your protocol.

Acceptance Criteria

Instruction reference: every program instruction documented with parameters, expected behavior, error codes, and example usage
Integration guide: step-by-step for another developer to create a stream using your program (with actual code snippets that work)
Architecture decision records: at least 3 decisions you made and why
Setup guide updated: README from Week 3 is current and accurate for the final codebase
Your Marketing teammate has reviewed the integration guide for clarity
Resources

Your full codebase
Good examples: Anchor docs, Solana cookbook, any well-documented open source project
How to Submit

Submit a PR if docs are in the repo (recommended), or a Google Doc link. Example PR: https://github.com/mancer-s1-team-2/token-distribution/pull/14. In your report, describe what YOU documented and any feedback from teammates.

🎯
KPI:
A developer who has never seen your code can integrate with your program using only the docs.

Deliverable — Link to code or deployed URL
GitHub PR, repo link, or deployed URL
Status — What works and what doesn't
What's functional, what's incomplete, test results...
Blockers — What's stuck or what you need
Technical blockers, dependencies on teammates, questions...
Metrics — Quantifiable progress
Tests passing, coverage %, transaction speed, lines of code...
You'll be scored on:

Documentation Depth (15 pts)
Integration Guide (15 pts)
Decision Records (10 pts)
Professional Quality (5 pts)
Insight (5 pts)
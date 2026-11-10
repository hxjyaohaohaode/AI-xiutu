# Development contract

This is a real application baseline. Keep visible functionality and verification claims consistent with the implementation.

- Read README.md, docs/DESIGN.md and the module's README/API contract before changes.
- Keep branding and policies in configuration. Do not scatter product names, plan prices or model identifiers through components.
- The browser is not a permission, price, quota or ownership authority. Every object lookup/mutation must be scoped in the API.
- Operations permission does not grant private project, image, discussion or recipe read access.
- Preserve immutable sources/revisions and the shared versioned recipe format. A save uses expectedVersion. Never silently replace a concurrent version.
- Negative, neutral and positive editor values need meaningful documented semantics. Unimplemented person/skin detectors stay unavailable.
- Preview and export must use the same reference engine, coordinate conventions and algorithm version. Capability limits must be shown before decoding/charging.
- No simulated SMS, fixed OTP, production mock AI, hardcoded admin password, fake usage or fake payment success. Inject doubles only in tests.
- External AI input must be frozen, moderated and bound to its hash. Model output is untrusted. Suggestions stay candidates. The user explicitly requested three execution modes: suggest, preview-confirm (default), and budgeted auto. Only a current explicit server-side grant can authorize automatic actions; version, lease, scope, revocation and cost checks remain mandatory.
- Preserve the existing frontend visual/layout direction unless the user explicitly requests redesign. Prioritize real algorithms, interactions and cross-feature correctness. Treat pixel tests, visual review and paid-model acceptance as separate evidence.
- Never automatically retry a billable request with an unknown result. Preserve holds and dispatch evidence; require reconciliation.
- Do not log secrets, OTPs, phone numbers, private prompts or image contents. Never put credentials or private user photographs in Git.
- Migrations are append-only after publication. API, worker and schema changes ship together.
- Run npm run typecheck, npm test with TEST_DATABASE_URL, and npm run build. Restricted environments can run npm run test:lite; disclose its single-backend concurrency limitations.
- For UI changes, inspect desktop, tablet, narrow phone and landscape states in a browser. Record screenshots, overflow and interaction results; a successful build is not a visual check.
- Do not add arbitrary proxy URL endpoints or expose provider credentials to browser code.

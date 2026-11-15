# Refine history tab layout and tab bar scrolling

- [x] 1. `how` over the affected subsystem (`src/history.ts`, `src/main.ts`, `src/style.css`, `tests/app.spec.ts`, `tests/fix-1.spec.ts`).
- [x] 2. `architect` for parallel design exploration.
  - skip: Focused UI layout and styling adjustment specified directly by the user across `src/history.ts` and `src/style.css`.
- [x] 3. Write the throughput checkpoint as four todo items.
  - Blocking first steps. Inspect live DOM computed styles and screenshots at `http://127.0.0.1:5173/` to verify why `.tabs` scrolled, why `.view-switch` stretched, and how `參與記錄` rendered.
  - Independent workstreams. `n/a: tightly coupled DOM structure in src/history.ts and styles in src/style.css`.
  - Shared mutable state. `n/a: single checkout without Git worktrees per user rules; one writer updates src/history.ts, src/style.css, and tests/fix-1.spec.ts`.
  - Smallest safe decomposition. One pass updating `src/history.ts`, `src/style.css`, and `tests/fix-1.spec.ts`, then verifying with `pnpm run check` and live browser screenshots.
- [ ] 4. Implement the unscrollable tab row, ungrouped `參與記錄` with all numbers at the start, rounded icon list/table toggle at top-left, smaller `課後追蹤` heading, and borderless/unpadded `參與記錄`.
- [ ] 5. Verify on the matching surface with `pnpm run check` and live Playwright browser screenshots.
- [ ] 6. Rebase into small, ordered commits. Stack follow-ups.
  - skip: User forbids initializing Git, branches, worktrees, or commits in this workspace.
- [ ] 7. If the design is contested, `interrogate` before shipping.
  - skip: User gave direct visual layout specifications.
- [ ] 8. Run **Opening a PR**.
  - skip: No Git repository or PR workflow authorized.

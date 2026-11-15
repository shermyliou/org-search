# Apply docs/fix-1.md

- [x] Ground: read docs/fix-1.md, source, package scripts, data and existing tests.
- [ ] Sketch: compare inline rendering against focused history/guide modules.
- [ ] Agree: proceed with the smallest design meeting the requested behavior.
- [ ] Implement: inline editing, compact notes, reference-based history, sourced questions.
- [ ] Scrap: n/a unless implementation contradicts the design.
- [ ] Frame, Fan out, Cross-judge, Pick, Graft, Verify: bounded history/guide owners compare designs before implementing; root reviews integration.
- [x] Blocking first steps. Read source/data and existing components first.
- [x] Independent workstreams. History and guide own distinct new files; root owns main.ts, notes.ts, CSS and tests.
- [x] Shared mutable state. Each file has one writer; browser storage uses existing Web Locks pattern.
- [x] Smallest safe decomposition. Reuse existing HTML/CSS, icons, Zod and Playwright; no new packages or data pipeline changes.
- [ ] Verify on the matching surface with project check scripts and actual browser screenshots.
- [ ] Review final changes against every item in fix-1.md.

skip: branches, worktrees, commits and PR creation are forbidden by the user's Git instruction. This workspace has no Git repository. Delegates have exclusive file ownership instead.
skip: deployment is outside this local source-edit request.

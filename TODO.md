# To do

Follow-ups for 40K Reminders. Tick items off or delete them as they are done.

## Feedback from testers

- [ ] Collect what friends report and turn each issue into an item here or a GitHub issue.
- [ ] Spot-check reported rules with `yarn data:wh40k11e:reminders --faction <ID> --detachment "<name>" --unit "<name>"` and fix them in the review file (see CONTRIBUTING.md section 7).

## Print sheet

- [ ] Print a real sheet from Chrome, Safari, and Firefox and compare. Page numbers in the footer only appear in Chrome and Edge.
- [ ] Check the compact rule lists on screen (only print was checked), including on a phone.
- [ ] Decide whether to strip Core Rules cross-references such as "(20.04)" in Deep Strike from rule text.

## Unused files still to judge

- [ ] Wahapedia test fixtures that may be unused: `Faction_ability_subtypes.csv`, `Warscrolls_RoRfactions.csv`, `Warscrolls_organisation.csv`. The adapter test reads the whole folder, so check before removing.
- [ ] Leftover dark-theme styles (`ReminderTags-Dark`, `NoteBorder-Dark`, and similar) that nothing uses.
- [ ] Army of Renown and seasonal props in `homeHeader` that 40K never uses.
- [ ] `public/rollback-service-worker.js`, the AoS offline-cache escape hatch. Removing it means updating `vite.config.mts` and `pwaBuild.test.ts`.
- [ ] Rename `src/tests/aos4/`, which now tests shared code the 40K pipeline uses.
- [ ] Rewrite `docs/pwa.md` for 40K; it still mostly describes AoS hosting and accounts.

## Data

- [ ] Rule timing overrides rest on Wahapedia text except for the Core Rules and four faction packs. Revisit them as more official Games Workshop PDFs are added.
- [ ] Back up `.cache/wh40k11e/` after any data refresh (CONTRIBUTING.md section 5).

## Upstream (AoS Reminders)

- Reviewed through `6ab87e1e` (2026-10-01). Brought over automatic update installs (`34df2f5d`) and bolder tag outlines (from `6f77e318`); the rest was AoS data, accounts, or features this fork removed.
- [ ] Next time: `git fetch upstream && git log --oneline 6ab87e1e..upstream/master`, and cherry-pick only shared code. Never merge, which would bring back the AoS app.

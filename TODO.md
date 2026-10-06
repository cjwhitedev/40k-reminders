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

- [ ] Set up the `DATA_ARCHIVE_PASSPHRASE` secret (CONTRIBUTING.md section 8, one-time setup), then run **Fetch rules sources** once to learn whether GitHub's network can reach Wahapedia. If it cannot, the watch workflow fails the same way and the handoff doc stays the way to fetch.
- [ ] Delete the retired `40k-11e-port` branch on GitHub once `master` is pushed.
- [ ] Rule timing overrides rest on Wahapedia text except for the Core Rules and four faction packs. Revisit them as more official Games Workshop PDFs are added.
- [ ] Back up `.cache/wh40k11e/` after any data refresh (CONTRIBUTING.md section 5).

## Upstream (AoS Reminders)

- [ ] Check for new upstream commits now and then; the routine is CONTRIBUTING.md section 10.

Review log:

- 2026-10-01, through `6ab87e1e`: brought over automatic update installs (`34df2f5d`) and bolder tag outlines (from `6f77e318`).
- 2026-10-05, through `9ac93ac1`: brought over the unused stats-page style removal (from `000c5d3d`); the rest was AoS data, accounts, and subscribe-page work. Recorded both reviews with `git merge -s ours 9ac93ac1`, so GitHub's "behind" count now only counts unreviewed commits.

# To do

Follow-ups for 40K Reminders. Tick items off or delete them as they are done.

## Feedback from testers

- [ ] Collect what friends report and turn each issue into an item here or a GitHub issue. Drop screenshots in `input/` (never committed). Timing suggestions filed from the app are worked through with `yarn data:decide --issues`.
- [ ] Spot-check reported rules with `yarn data:reminders --faction <ID> --detachment "<name>" --unit "<name>"` and fix them in the review file (see CONTRIBUTING.md section 7).
- [ ] 2026-10-16 second round (ArbitraryNerd), after the refresh lands:
  - [ ] Detachment picker should be multi-select: armies now take up to three detachments. Show each detachment's detachment points (Wahapedia's `Detachments.csv` has a `dp` column, and `Detachments_chapter_dp.csv` per-Chapter costs).
  - [ ] Still no Deathwatch units under the Chapter filter (see Data below); recheck after the refresh, which brings the new Deathwatch detachments.

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

- [ ] Deathwatch shows only one unit under the Chapter filter: its other datasheets come from GW's 10th-edition Deathwatch pack, which the review excludes as previous-edition. Revisit when an 11th-edition Deathwatch pack is published.
- [ ] Decide whether other factions want a sub-faction filter (`subFactionKeywords` in the review file): Aeldari (Ynnari, Harlequins), and the Chaos god legions' daemon allies.
- [ ] Since the 2026-10-19 refresh (`2939c0a5`), relink the Chapter filter's army rules: the old Blood Angels, Dark Angels and Deathwatch rules are gone, and the new codex adds The Ravenwing, The Deathwing, Kill Team and Curse of the Wulfen.
- [ ] Check that GitHub emails you for issues assigned to you (**Settings > Notifications**), so the weekly **Rules data sources changed** issue reaches your inbox.
- [ ] Rule timing overrides rest on Wahapedia text except for the Core Rules and four faction packs. Revisit them as more official Games Workshop PDFs are added.
- [ ] Back up `.cache/wh40k11e/` after any data refresh (CONTRIBUTING.md section 5).

## Upstream (AoS Reminders)

- [ ] Check for new upstream commits now and then; the routine is CONTRIBUTING.md section 10.

Review log:

- 2026-10-01, through `6ab87e1e`: brought over automatic update installs (`34df2f5d`) and bolder tag outlines (from `6f77e318`).
- 2026-10-05, through `9ac93ac1`: brought over the unused stats-page style removal (from `000c5d3d`); the rest was AoS data, accounts, and subscribe-page work. Recorded both reviews with `git merge -s ours 9ac93ac1`, so GitHub's "behind" count now only counts unreviewed commits.

# Contributing to 40K Reminders

This guide covers running, maintaining, and updating the project without an AI assistant. Every command below is a normal `yarn` script; nothing depends on an agent.

## 1. Set up

You need Git, [nvm](https://github.com/nvm-sh/nvm) (or Node 22 some other way), and Yarn Classic.

```bash
git clone https://github.com/cjwhitedev/40k-reminders.git
cd 40k-reminders
nvm install        # reads .nvmrc (Node 22.23.2)
nvm use
corepack enable    # or: npm install --global yarn@1.22.22
yarn install --frozen-lockfile
```

Yarn does not come with Node, so `yarn: command not found` means the `corepack enable` (or `npm install --global yarn@1.22.22`) line was skipped. Use `yarn` rather than `npm install` here: npm writes a `package-lock.json` and resolves different versions than `yarn.lock`.

If `yarn` complains that a module needs a different Node version, you are on the wrong Node. Run `nvm use` in that terminal first.

## 2. Run the site locally

```bash
yarn start          # development server at http://localhost:5173
```

To try the production build, including offline support:

```bash
yarn build
yarn preview        # serves dist/ at http://localhost:4173
```

The army you build is saved in your browser's local storage under `wh40k-reminders:wh40k11e:army:v1`. Use **Clear Army** or delete that key to start fresh.

## 3. Check your work

Run these before every commit, in this order. The build comes before the tests because `src/tests/pwaBuild.test.ts` reads the built service worker in `dist/`.

```bash
yarn lint
yarn tsc --noEmit
yarn build
yarn test --run
```

`yarn prepush` runs all four. A pre-commit hook formats staged files with Prettier. Run `yarn format` to format everything.

## 4. Release (deploy the live site)

The live site is <https://cjwhitedev.github.io/40k-reminders/>.

All work happens on `master`, and every push to `master` deploys. `.github/workflows/pages.yml` lints, builds, and tests the push, then publishes the site for the `/40k-reminders/` path only if all of that passed. Watch it under the repository's **Actions** tab.

1. Run the section 3 checks (`yarn prepush` runs them all).
2. Commit, then `git push origin master`.

To try a risky change before it goes live, push it to a branch instead. `.github/workflows/nodejs.yml` checks every other branch and every pull request; merging into `master` deploys it.

You can also redeploy without a code change: **Actions > Deploy to GitHub Pages > Run workflow**.

First-time setup only: in the repository's **Settings > Pages**, set **Source** to **GitHub Actions**.

If a release breaks the site, revert the bad commit on `master` (`git revert <sha>`, then push). That redeploys the previous version.

## 5. How the rules data works

The site never downloads rules while it runs. It loads one checked-in file, `src/wh40k11e/generated/runtime.json`, which is built by this pipeline:

1. **Acquire.** Download source files into the ignored `.cache/wh40k11e/` folder: Wahapedia's CSV exports, the BSData catalogues pinned to one commit, and official Games Workshop PDFs. Each download is checksummed in a `candidate-manifest.json`.
2. **Review.** The review file in `data/wh40k11e/reviews/` (the one named in `data/wh40k11e/pipeline.json`) is the human-reviewed decision file. It pins the exact checksums of the sources it was written against and records every judgment call: which records to exclude, the timing of rules the parser cannot read, rules that are not reminders, and each faction's Army Faction keywords.
3. **Build rules.** The pipeline decodes and links the sources, applies the review, and parses each rule's timing. The parsers in `src/wh40k11e/normalize/` read about 98% of rules from their wording alone; the review file holds a decision for the rest.
4. **Generate.** The result is validated and written to `runtime.json`.

Every timing or "not a reminder" decision records a fingerprint (the source row's checksum) of the rule it was made against. If Wahapedia later rewords that rule, the review blocks until someone looks at the decision again, so an old decision never silently applies to new text.

Which review file and source folders the commands read is set in `data/wh40k11e/pipeline.json`; `yarn data:update` rewrites it. Every data command also accepts `--review`, `--wahapedia-candidate`, `--bsdata-candidate`, and `--official-candidate` to point elsewhere.

### Keep a backup of the source cache

`.cache/wh40k11e/` is not in git, and Wahapedia changes its exports over time, so the exact files the current runtime was built from may not be downloadable again. After any data refresh, archive the folder somewhere safe:

```bash
tar -czf wh40k11e-cache-$(date +%Y-%m-%d).tgz .cache/wh40k11e
```

Set `WH40K_CACHE_BACKUP_DIR` (for example in your shell profile) and `yarn data:update` writes that archive there by itself. To restore on a new machine, extract the archive in the repository root.

## 6. Data commands

| Command | What it does |
| --- | --- |
| `yarn data:update` | The whole refresh in one go; see section 8. |
| `yarn data:decide` | Prompts for every rule that needs a decision (unreadable timing, or reworded since it was decided), saves each answer to the review file, and rewrites `runtime.json` once every rule is decided. |
| `yarn data:decide --rule "<name or ID>"` | Decides one rule again. A name offers every rule with that name; an ID (from **Copy rule ID** in a reminder's ⋯ menu) offers that rule and its identical copies on other datasheets. |
| `yarn data:decide --issues` | Goes through the open `timing-suggestion` issues on GitHub: each rule with the tester's pick and reason, their pick as the Enter default. The commit closes the issues whose rule changed. |
| `yarn data:decide --stamp` | Adds fingerprints to decisions that have none, against the current sources. Use after editing the review file by hand. |
| `yarn data:candidate ...` | Downloads sources into a new folder under `.cache/`. Never overwrites a folder. |
| `yarn data:review` | Applies the review file and reports any problems. Status must be `reviewed`, not `blocked`. |
| `yarn data:rules --output <new-file>` | Builds every rule and fails if any matched-play rule has no timing. |
| `yarn data:reminders --faction AC --detachment "Shield Host" --unit "Custodian Guard"` | Prints one army's reminders. Good for spot checks. |
| `yarn data:generate` | Checks that `runtime.json` matches the sources and review. |
| `yarn data:generate:write` | Rewrites `runtime.json`. Commit the result. |
| `yarn data:compare` | Cross-checks Wahapedia datasheets against BSData. |
| `yarn data:check-exports` | Confirms the downloaded CSVs match Wahapedia's published export list. |
| `yarn data:watch --candidate <dir>` | Says whether Wahapedia has changed since the review, from a fetched `Last_update.csv`. The weekly workflow runs it. |

Faction IDs (`AC`, `SM`, `CSM`, ...) are Wahapedia's; the full list is in `runtime.json` under `catalog.factions`.

## 7. Fix a wrong or missing rule

Most reports are one of these. In every case, the fix goes in the review file, never `runtime.json`.

Players report timing with **Suggest a timing change** in a reminder's ⋯ menu, which opens a `timing-suggestion` issue. Run `yarn data:decide --issues` to go through all the open ones. Each prompt shows the issue, who opened it, why, and its link, and Enter takes the tester's pick when it is one of the listed timings. Check their reason against the rule text or the Core Rules first; if they are wrong, press `k` to keep the current timing. At the end it lists the issues that changed nothing, to reply to and close on GitHub. The commit says "Fixes #n" for the rest, so pushing closes them. `data:update` mentions any open suggestions when it finishes.

1. Reproduce it, if you need to: `yarn data:reminders --faction <ID> --detachment "<name>" --unit "<name>"`.
2. **Wrong timing, or should not be a reminder** (army-building rules, designer's notes): in the app, open the reminder's ⋯ menu and choose **Copy rule ID**, then run `yarn data:decide --rule "<rule ID>"` and answer the prompt (see section 8 for the keys). A rule name works too, but offers every rule with that name. It saves the decision, with its fingerprint, to the review file.
3. **Rule from another army showing up:** check `armyFactionKeywords` for the faction in the review file. Rules that say "If your Army Faction is X" only appear for armies whose keywords include X. Edit by hand.
4. When you finish, `decide` rewrites `runtime.json`, runs the checks in section 3, and offers to commit the review file and `runtime.json` (only those) and push them, with Enter for yes. After a hand edit instead, run `yarn data:generate:write` and the checks yourself.
5. If you commit by hand, commit the review file and `runtime.json` together, saying in the message which rule changed and why.

The Chapter filter for Space Marines comes from `subFactionKeywords` in the review file: a faction ID, a label, and the faction keywords (as Wahapedia prints them on datasheets) that split its units into groups. Units carrying none of them are offered for every group. To give another faction a filter, add an entry; `yarn data:review` reports any keyword no datasheet of that faction carries.

You can still edit `timingOverrides` or `ignoredRules` by hand (copy the shape of an existing entry); run `yarn data:decide --stamp` afterwards to fingerprint the new entry.

If the parser misreads a common phrasing, the better fix is in `src/wh40k11e/normalize/ability.ts` or `when.ts`, with a test in `src/tests/wh40k11e/`. When `decide` keeps suggesting the same answer for the same wording, that wording is a good candidate.

## 8. Refresh the rules data (new codex, balance update)

The step-by-step checklist, with every prompt and what to do when something stops, is [docs/refreshing-rules-data.md](docs/refreshing-rules-data.md). In short:

`.github/workflows/data-watch.yml` checks Wahapedia every Monday. When its exports have moved on from the ones the review was written against, it opens a **Rules data sources changed** issue assigned to the repository owner, which GitHub emails to you. (Check that **Settings > Notifications** on GitHub emails you for issues you are assigned.) To check now: **Actions > Watch rules sources for changes > Run workflow**.

To refresh, on any machine that can reach Wahapedia:

```bash
git checkout master
yarn data:update
```

Every prompt has a default that is normally right, so pressing Enter throughout usually completes a refresh; read the rules as they go by. The steps:

1. **Checks git**: must be on `master`. Offers to pull newer commits (then restarts with the new code), and to continue, start over or quit an unfinished refresh.
2. **Downloads** Wahapedia's exports (pausing a second between files). It reuses the official PDFs unless `data/wh40k11e/official-urls.json` changed (add new PDF links there first), and stops with "Nothing to do" if Wahapedia and the PDFs are unchanged and the updater has not improved since the rules file was built. When only the updater improved (a pull brought parser fixes), it rebuilds the rules file from the same sources instead, with a "Rebuild the rules file with the improved updater" commit. It then takes BSData's latest commit for the cross-check.
3. **Starts a new review**: a dated copy of the review file bound to the new checksums, with every earlier decision carried over, and `data/wh40k11e/pipeline.json` pointed at it.
4. **Reviews.** When Wahapedia renumbers a rule, it moves the decision to the rule's new ID by name, and asks you to confirm it again with the rest. It offers to drop decisions for rules that are really gone, listing them by name. It offers to update exclusion counts that changed because Wahapedia fixed its data, and asks for the Army Faction keywords of any new faction. Anything else the review reports needs a hand edit; it waits while you make it, then checks again. Then it prompts for each rule that needs a decision:
   - rules the parsers cannot read, with a **suggested** answer from an earlier same-named rule or the wording (always active when the wording names no time);
   - rules reworded since they were decided, showing the text the decision was made against. Rules that changed only in spacing or capital letters are listed first and kept with one Enter.

   For each, press **Enter** to accept the suggestion (or keep the old decision), or choose **t** timed (pick a numbered timing, several numbers such as `5 7` for more than one phase, or type the timing the way a WHEN: line reads, such as `start of your Command phase` or `before the battle: Deploy Armies step`, joining several with "or"), **r** reaction, **p** always active, **n** not a reminder, **s** skip, **q** save and quit. An answer covers every copy of the same rule on other datasheets or factions. Every answer is saved as you go.
5. **Generates** `runtime.json`.
6. **Reports what changed** by faction, and saves the list and a ready commit message under `.cache/wh40k11e/reports/`.
7. **Runs the checks** from section 3.
8. **Waits while you spot-check** the listed armies with `yarn start`, backs up the cache if `WH40K_CACHE_BACKUP_DIR` is set, and offers to **commit** and **push**. GitHub then builds and publishes the site, and you can close the issue.

If you quit or a step fails, fix what it says and run the command again; it offers to continue the unfinished refresh (`--no-fetch` goes straight there). `--force` refreshes even when nothing changed, and `--no-commit` stops before committing.

If no machine you have can reach Wahapedia, [docs/data/wh40k11e-wahapedia-handoff.md](docs/data/wh40k11e-wahapedia-handoff.md) describes fetching on someone else's network and carrying the files back.

## 9. Dependencies

`yarn up` upgrades interactively. Upgrade one package family at a time and run the section 3 checks after each. Keep rules-data changes and dependency upgrades in separate commits.

If TypeScript suddenly reports JSX errors in files you did not touch after switching branches, delete `node_modules` and reinstall; see `docs/solutions/workflow-learnings/stale-nested-types-react-after-package-track.md`.

### Icons and social preview

The favicon, app icons, and the social preview image in `public/` are generated from the SVG sources in `brand/`. Edit the SVGs (any vector editor, or by hand), then run `yarn brand:icons` to rewrite every PNG, `favicon.ico`, and `public/favicon.svg`. Commit `brand/` and `public/` together. Never edit the PNGs directly; the next run overwrites them.

## 10. Keep up with AoS Reminders

This repo is a fork of [daviseford/aos-reminders](https://github.com/daviseford/aos-reminders), set up as the `upstream` remote (`git remote add upstream https://github.com/daviseford/aos-reminders.git` on a new clone). Most of Davis's work is Age of Sigmar data or features this fork removed, so it is reviewed commit by commit and never merged normally. GitHub's "commits behind" count on the repo page shows how many of his commits are still unreviewed.

1. **List the new commits:**

   ```bash
   git fetch upstream
   git log --oneline --reverse HEAD..upstream/master
   ```

2. **See which files each one touches that still exist here.** Anything under AoS data, accounts, subscriptions, roster import, cloud saves, or PDF export is gone from this fork and can be skipped.

   ```bash
   git diff-tree --no-commit-id -r --name-only <sha> | while read f; do [ -e "$f" ] && echo "$f"; done
   ```

3. **Bring over what is useful** with `git cherry-pick -n <sha>`, or for part of a commit, `git show <sha> -- <file> | git apply --3way`. Resolve conflicts in favour of this fork, run the section 3 checks, and commit with Davis as the author: `git commit --author="$(git log -1 --format='%an <%ae>' <sha>)"`. Say in the message which upstream commit it came from and what was adapted.
4. **Mark everything reviewed** by merging the last commit you looked at with the `ours` strategy. It records Davis's commits as merged without changing a single file, which brings the "behind" count to zero:

   ```bash
   git merge -s ours <last-reviewed-sha> -m "Mark upstream AoS Reminders reviewed through <last-reviewed-sha>"
   git diff --name-only HEAD^1 HEAD    # must print nothing
   ```

5. **Push** (section 4), and add a line to the upstream log in `TODO.md`.

Never use the **Sync fork** button on GitHub. "Update branch" attempts a real merge that would bring the AoS app back, and "Discard commits" resets this fork to Davis's repo, deleting all 40K work.

## 11. Ground rules

- Never offer anything AoS Reminders charges for: accounts, saved armies, share links, dark theme.
- Keep the credit to Davis E. Ford and AoS Reminders, and the "Powered by Wahapedia" attribution.
- Never commit raw source files; they stay in `.cache/`.
- Games Workshop publications outrank Wahapedia and BSData. Record every judgment call in the review file with a reason.

## Reporting issues

Open an issue at <https://github.com/cjwhitedev/40k-reminders/issues>. For a rules problem, include the faction, detachment or unit, and the rule name.

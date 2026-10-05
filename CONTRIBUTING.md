# Contributing to 40K Reminders

This guide covers running, maintaining, and updating the project without an AI assistant. Every command below is a normal `yarn` script; nothing depends on an agent.

## 1. Set up

You need Git, [nvm](https://github.com/nvm-sh/nvm) (or Node 22 some other way), and Yarn Classic.

```bash
git clone https://github.com/cjwhitedev/40k-reminders.git
cd 40k-reminders
nvm install        # reads .nvmrc (Node 22.23.2)
nvm use
npm install --global yarn@1.22.22
yarn install --frozen-lockfile
```

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

1. Do your work on a branch and push it. CI (`.github/workflows/nodejs.yml`) lints, builds, and tests it.
2. Open a pull request into `master` and merge it once CI is green.
3. The merge runs `.github/workflows/pages.yml`, which tests again, builds the site for the `/40k-reminders/` path, and publishes it. Watch it under the repository's **Actions** tab.

You can also redeploy without a code change: **Actions > Deploy to GitHub Pages > Run workflow**.

First-time setup only: in the repository's **Settings > Pages**, set **Source** to **GitHub Actions**.

If a release breaks the site, revert the bad commit on `master` (`git revert <sha>`, then push). That redeploys the previous version.

## 5. How the rules data works

The site never downloads rules while it runs. It loads one checked-in file, `src/wh40k11e/generated/runtime.json`, which is built by this pipeline:

1. **Acquire.** Download source files into the ignored `.cache/wh40k11e/` folder: Wahapedia's CSV exports, the BSData catalogues pinned to one commit, and official Games Workshop PDFs. Each download is checksummed in a `candidate-manifest.json`.
2. **Review.** `data/wh40k11e/reviews/sources-2026-09-30.json` is the human-reviewed decision file. It pins the exact checksums of the sources it was written against and records every judgment call: which records to exclude, the timing of rules the parser cannot read, rules that are not reminders, and each faction's Army Faction keywords.
3. **Build rules.** The pipeline decodes and links the sources, applies the review, and parses each rule's timing.
4. **Generate.** The result is validated and written to `runtime.json`.

Which source folders the commands read is set in `WH40K_DEFAULT_PIPELINE_OPTIONS` in `src/wh40k11e/data/pipeline.ts`. Every data command also accepts `--review`, `--wahapedia-candidate`, `--bsdata-candidate`, and `--official-candidate` to point elsewhere.

### Keep a backup of the source cache

`.cache/wh40k11e/` is not in git, and Wahapedia changes its exports over time, so the exact files the current runtime was built from may not be downloadable again. After any data refresh, archive the folder somewhere safe:

```bash
tar -czf wh40k11e-cache-$(date +%Y-%m-%d).tgz .cache/wh40k11e
```

To restore on a new machine, extract the archive in the repository root.

## 6. Data commands

| Command | What it does |
| --- | --- |
| `yarn data:wh40k11e:candidate ...` | Downloads sources into a new folder under `.cache/`. Never overwrites a folder. |
| `yarn data:wh40k11e:review` | Applies the review file and reports any problems. Status must be `reviewed`, not `blocked`. |
| `yarn data:wh40k11e:rules --output <new-file>` | Builds every rule and fails if any matched-play rule has no timing. |
| `yarn data:wh40k11e:reminders --faction AC --detachment "Shield Host" --unit "Custodian Guard"` | Prints one army's reminders. Good for spot checks. |
| `yarn data:wh40k11e:generate` | Checks that `runtime.json` matches the sources and review. |
| `yarn data:wh40k11e:generate:write` | Rewrites `runtime.json`. Commit the result. |
| `yarn data:wh40k11e:compare` | Cross-checks Wahapedia datasheets against BSData. |
| `yarn data:wh40k11e:check-exports` | Confirms the downloaded CSVs match Wahapedia's published export list. |

Faction IDs (`AC`, `SM`, `CSM`, ...) are Wahapedia's; the full list is in `runtime.json` under `catalog.factions`.

## 7. Fix a wrong or missing rule

Most reports are one of these. In every case, edit the review file, never `runtime.json`.

1. Reproduce it: `yarn data:wh40k11e:reminders --faction <ID> --detachment "<name>" --unit "<name>"`.
2. Find the rule's `sourceRecordId` in `src/wh40k11e/generated/runtime.json` (search for its name).
3. Make the fix in `data/wh40k11e/reviews/sources-2026-09-30.json`:
   - **Wrong timing:** add or edit an entry in `timingOverrides` with `kind` (`timed`, `reaction`, or `passive`), the `windows` for timed rules, and a `reason` quoting the rule text. Copy the shape of an existing entry.
   - **Should not be a reminder** (army-building rules, designer's notes): add the ID to an `ignoredRules` entry with a reason.
   - **Rule from another army showing up:** check `armyFactionKeywords` for the faction. Rules that say "If your Army Faction is X" only appear for armies whose keywords include X.
4. Run `yarn data:wh40k11e:review`, then `yarn data:wh40k11e:generate:write`, then the checks in section 3.
5. Commit the review file and `runtime.json` together, saying in the message which rule changed and why.

If the parser itself misreads a common phrasing, the fix belongs in `src/wh40k11e/normalize/ability.ts` or `when.ts`, with a test in `src/tests/wh40k11e/`.

## 8. Refresh the rules data (new codex, balance update)

1. **Download new sources** into a new folder. For example, the Wahapedia exports:

   ```bash
   yarn data:wh40k11e:candidate \
     --wahapedia-urls-file data/wh40k11e/wahapedia-export-urls.json \
     --pause-ms 1000 \
     --output .cache/wh40k11e/candidates/wahapedia-exports-<date>
   ```

   Official PDFs use `--official-urls-file data/wh40k11e/official-urls.json` (add new PDF links to that list first). BSData uses `--bsdata-ref <40-character commit> --bsdata-paths-file data/wh40k11e/bsdata-paths.json`.

   Wahapedia blocks some networks. If yours is blocked, follow [docs/data/wh40k11e-wahapedia-handoff.md](docs/data/wh40k11e-wahapedia-handoff.md) to fetch on another network and carry the files back.

2. **Copy the review file** to a new dated name, update its `revision`, and update its `inputs` section with the new checksums. Each checksum is in the new folder's `candidate-manifest.json`.
3. **Point the pipeline at the new inputs** by updating `WH40K_DEFAULT_PIPELINE_OPTIONS` in `src/wh40k11e/data/pipeline.ts`.
4. **Run `yarn data:wh40k11e:review`** and work through every reported problem until the status is `reviewed`. New errors usually mean new or renamed records that need an exclusion or decision.
5. **Run `yarn data:wh40k11e:rules --output .cache/wh40k11e/rules/<date>.json`** and give every rule it lists a `timingOverrides` or `ignoredRules` decision.
6. **Run `yarn data:wh40k11e:generate:write`**, the checks in section 3, and spot-check a few armies in the browser.
7. **Commit** the review file, `pipeline.ts`, any URL-list changes, and `runtime.json`. Back up the cache (section 5).

## 9. Dependencies

`yarn up` upgrades interactively. Upgrade one package family at a time and run the section 3 checks after each. Keep rules-data changes and dependency upgrades in separate commits.

If TypeScript suddenly reports JSX errors in files you did not touch after switching branches, delete `node_modules` and reinstall; see `docs/solutions/workflow-learnings/stale-nested-types-react-after-package-track.md`.

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

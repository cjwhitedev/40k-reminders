---
name: refresh-rules-data
description: 'Run, debug, or improve the 40K Reminders rules-data refresh (yarn data:update). Use when Wahapedia publishes new rules or codexes, when the weekly "Rules data sources changed" issue opens, when the owner pastes updater output or reports a wrong prompt default, when a timing decision in data/wh40k11e/reviews needs changing, or when changing the WHEN/ability timing parsers.'
---

# Refreshing rules data and improving the updater

## The goal

The owner runs one command on a machine that can reach Wahapedia and presses Enter at every prompt:

```bash
git checkout master
yarn data:update
```

Every improvement to the updater aims at one thing: the Enter default at each prompt should be the right answer. When the owner reports a wrong default, do not just fix that one decision. Fix the logic that produced it (the parser or the suggestion), add a test, check nothing else in the committed rules file moved, and push. The owner keeps going on the other machine and pulls the fix on the next run.

The checklist a human follows is [docs/refreshing-rules-data.md](../../../docs/refreshing-rules-data.md); the background is CONTRIBUTING.md sections 5 to 8.

## Machines and how the owner works

- The owner's main Mac cannot reach `wahapedia.ru` (the network blocks it). A second Linux machine (`abc@webtop`, repo at `~/projects/40k-reminders`) can, and that is where refreshes run.
- A weekly GitHub workflow (`.github/workflows/data-watch.yml`) opens a **Rules data sources changed** issue assigned to the owner when Wahapedia's `Last_update.csv` moves.
- The owner shares terminal output by pasting it, and screenshots or files by dropping them in `input/`. macOS screenshot names contain a narrow no-break space before "PM", so copy them to `/tmp` with a glob before opening them. Never commit, move, or delete anything in `input/`.
- To see what Wahapedia currently publishes from a blocked machine, ask the owner to bundle the latest download on the other machine and drop it in `input/`:

  ```bash
  cd ~/projects/40k-reminders
  c=$(ls -dt .cache/wh40k11e/candidates/*wahapedia-exports* | head -1)
  node -e 'for (const a of require(process.argv[1]).artifacts) console.log(".cache/wh40k11e/artifacts/"+a.checksum)' "$PWD/$c/candidate-manifest.json" > /tmp/wahapedia-files.txt
  tar -czf ~/wahapedia-$(date +%F).tgz -T /tmp/wahapedia-files.txt "$c"
  ```

  Unpack it from the repo root with `tar xzf input/wahapedia-*.tgz`; it lands in `.cache/` as a ready candidate. Downloads are stored by checksum under `.cache/wh40k11e/artifacts/`, and a candidate folder only holds `candidate-manifest.json` and `candidate-provenance.json` naming them.

## What `yarn data:update` does

`src/wh40k11e/data/updateCommand.ts`, steps printed as `━━ N. … ━━`:

1. **Git.** Must be on `master`. Offers to pull (then reinstalls and re-runs itself), and to continue / start over / quit an unfinished refresh (files under `data/wh40k11e/` and `src/wh40k11e/generated/`). Start over restores those files and re-runs itself, because `pipeline.json` was read at startup.
2. **Download.** Wahapedia exports, official PDFs (reused unless `data/wh40k11e/official-urls.json` changed), BSData's latest commit. "Nothing to do" if Wahapedia and the PDFs are unchanged, unless the updater improved since the rules file was built: then it rebuilds from the same sources (`updaterImproved`) and carries on from step 4. This is how a parser fix reaches the app without new Wahapedia data.
3. **New review.** Copies the review file to `data/wh40k11e/reviews/sources-<date>.json` bound to the new checksums and points `data/wh40k11e/pipeline.json` at it.
4. **Review** (`settleReview`). In order: relink decisions for renumbered rules by name, then offer to drop decisions for rules that are gone, update link-disposition counts, ask for a new faction's Army Faction keywords, then ask each fix from `reviewFixes.ts`. Then the decision prompts (`decideWh40kPending` → `runWh40kDecisionSession`). Only findings with no automatic answer ask for a hand edit.
5. **Generate** `src/wh40k11e/generated/runtime.json`.
6. **Report** what changed per faction to `.cache/wh40k11e/reports/`, with a ready commit message.
7. **Checks**: `yarn prepush` (lint, types, build, tests).
8. **Spot-check, commit, push.** If the push is refused because GitHub moved on, it rebases and pushes again.

`yarn data:update` flags: `--no-fetch` (resume at step 4), `--force`, `--no-commit`, `--skip-git-check`, `--wahapedia-candidate <dir>`.

## Where things live

| File | What it decides |
| --- | --- |
| `src/wh40k11e/normalize/when.ts` | Stratagem WHEN clauses. Strict official grammar first, then a lenient pass for the codex spellings ("Your Movement/Charge phase", a trigger without a comma, ", or the Fight phase,", phase lists, the Reinforcements step). |
| `src/wh40k11e/normalize/ability.ts` | Prose abilities, enhancements, detachment rules: strips the "X model only." line, "(Once per battle)" limits and leading conditions, then classifies the opening as timed, reaction, passive, or unclassified. Unclassified rules become prompts. |
| `src/wh40k11e/data/decisions.ts` | `suggestWh40kDecision` (the Enter default for a new rule), `hintWh40kPhase`, adding/removing decisions, relinking renumbered rules, disposition counts. |
| `src/wh40k11e/data/decideSession.ts` | The prompt loop: grouping identical rules into one prompt, `retimed` (a reworded rule's default), the numbered timing menu `COMMON_TIMINGS`. |
| `src/wh40k11e/data/decideCommand.ts` | `yarn data:decide`, and the bulk keep for rules that changed only in spacing or capitals. |
| `src/wh40k11e/data/reviewFixes.ts` | One-question fixes for review findings (unpublished rows, decoder warnings, new source kinds, duplicate decisions, moved PDF quotes, dropped factions or Chapters). |
| `src/wh40k11e/data/review.ts` | Applies the review file and raises findings (`Wh40kReviewFindingCode`). |
| `src/wh40k11e/data/rules.ts` | Builds rules; a review timing override always beats the parser. |
| `data/wh40k11e/reviews/*.json` | Every human decision, with a reason, a fingerprint (record checksum) and the rule name per record. |

## Invariants to keep

- A decision in the review file always wins over the parser, so parser changes can only move rules that had no decision (unresolved ones). After any parser change run `yarn data:generate`; if it reports a difference, run `generate:write`, diff the rules before and after, and make sure every change is an unresolved rule gaining a correct timing. Commit the regenerated `runtime.json` with the change. If the sources `pipeline.json` names are not on this machine (they live in the ignored `.cache/` of whichever machine ran the refresh), say so: the owner runs `yarn data:generate:write` on that machine and pushes.
- `yarn data:update` and `yarn data:decide` both end by running the checks and offering to commit only `data/wh40k11e` and `runtime.json` and push (`gitSteps.ts`).
- Every decision keeps `fingerprints` and `names`. Use the helpers in `decisions.ts`, never hand-written entries; after a hand edit run `yarn data:decide --stamp`.
- Keep the strict WHEN grammar untouched; add new spellings to the lenient pass so every clause that parsed before parses the same way.
- Tests that pick real units, detachments or rules from the generated catalog must use ones that survive a codex change or a review decision (for example `/^Custodian Guard(?: Sodality)?$/` and the "Lions of the Emperor" detachment), or a refresh or `data:decide` fails at the checks. A test once required the "Space Marine Chapters" army rule, which broke when it was marked not a reminder.
- Do not trim `git status --porcelain` output: a leading space is part of the status code.
- vite-node sets `NODE_ENV=development` and `VITE_*`; child processes get them stripped (`childEnv`) so `vite build` works.
- Sort with `compareCodeUnits`, never `localeCompare`. The TS target forbids iterating a `Set`, `Map`, or `matchAll` directly.

## Testing a refresh without Wahapedia access

Replay in a throwaway clone so the working copy is untouched:

```bash
rm -rf /tmp/wt40k && git clone -q . /tmp/wt40k && cd /tmp/wt40k
ln -s "$OLDPWD/node_modules" node_modules && echo node_modules >> .git/info/exclude
mkdir -p .cache && ln -s "$OLDPWD/.cache/wh40k11e" .cache/wh40k11e
# copy in any uncommitted files under test, then commit them in the clone
yes '' | head -300 | yarn -s data:update --skip-git-check --no-commit --wahapedia-candidate .cache/wh40k11e/candidates/<candidate>
```

`yes ''` presses Enter at every prompt; a good run ends with all tests passing and "Not committed". To see every prompt and its default without a terminal, write a small `vite-node` script that builds `buildWh40kDecisionContext` from `runWh40kSourcePipeline(WH40K_DEFAULT_PIPELINE_OPTIONS)` and calls `runWh40kDecisionSession` with an `io` that records `print` and answers `''` to `ask`. To judge a suggestion change, backtest `suggestWh40kDecision` against every existing decision in the review file and compare kinds. Delete the clone and any `.cache/wh40k11e/candidates/<date>-bsdata` it downloaded afterwards.

Reading the official Core Rules: the PDF is in the official candidate (`node -p 'require("./data/wh40k11e/pipeline.json").officialCandidate'`, then its `candidate-manifest.json`). `extractGamesWorkshopPdfText` in `src/aos4/data/gamesWorkshop/pdfText.ts` returns `document.pages[].text`; it needs the artifact's real `checksum`.

## Rules knowledge gathered so far

- Core Rules 18.03: units disembark only in the active player's Movement phase; the exception is an emergency disembark when a transport is destroyed (any phase). Disembarking rules default to your Movement phase.
- Combat Doctrines are picked at the start of your Command phase, so "select a doctrine one additional time" rules default there.
- "At the end of a phase in which this model is destroyed" is a reaction (a trigger), not a window.
- "In a turn this unit remained stationary/made a normal move, ..." and "Attacks allocated to this model have -1 D" are always active.
- Core Rules 24.04 and 10.05: [ASSAULT] lets a unit that advanced use assault shooting, a shooting type of the Shooting phase. A rule whose whole effect is granting [ASSAULT] is timed in your Shooting phase; a rule that also grants something else (Move, re-rolls, [LETHAL HITS]) stays always active so its other effect is not buried.
- Fight-phase rules are usually either player's turn ("the Fight phase").
- On 2026-10-16 Wahapedia switched Space Marines and Custodes to their new codexes: chapter detachments and the old Blood Angels, Dark Angels and Deathwatch army rules went away, Custodian Guard became Custodian Guard Sodality, and Horus Heresy-era tanks left the Chaos legions. The Chapter filter's `armyRules` (in the review's `subFactionKeywords`) need relinking to the new rules (The Ravenwing, The Deathwing, Kill Team, Curse of the Wulfen); see TODO.md.
- Tester feedback still open (TODO.md): reactions that name a phase belong in that phase, multi-select detachments with detachment points, Army rules then Detachment rules first in each section.

## Setting up a machine

Node 22 from `.nvmrc` (`nvm install && nvm use`), Yarn 1.22.22 (`corepack enable` or `npm install --global yarn@1.22.22`), then `yarn install --frozen-lockfile`. Never run `npm install`: `package.json` refuses npm on purpose (`engines.npm`), because npm rewrites `yarn.lock` in a format Yarn cannot read. The fix if it happened: `git restore yarn.lock && rm -rf node_modules && yarn install --frozen-lockfile`.

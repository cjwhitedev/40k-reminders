# Refreshing the rules data

A checklist for updating 40K Reminders when Games Workshop or Wahapedia publish new rules. It is one command; this page is what to expect while it runs. The background, and every command it uses, is in [CONTRIBUTING.md](../CONTRIBUTING.md) sections 5 to 8.

## When to do it

- **The email.** Every Monday a GitHub workflow checks Wahapedia. When it has changed since the data was last reviewed, GitHub opens a **Rules data sources changed** issue assigned to you and emails you about it. To check by hand: **Actions > Watch rules sources for changes > Run workflow**.
- **A new official PDF** (faction pack, errata): add its link to `data/wh40k11e/official-urls.json` first, then refresh.
- **A rule is wrong** but nothing new was published: you do not need a refresh. Use `yarn data:wh40k11e:decide --rule "<rule name>"` (CONTRIBUTING.md section 7).

## Before you start

- A machine that can reach `wahapedia.ru` (it blocks some networks).
- About 20 minutes, more if many rules changed.
- Optional: `export WH40K_CACHE_BACKUP_DIR=/path/to/backups` so the downloaded sources are backed up for you.

### First time on a machine

The project needs Node 22 (pinned in `.nvmrc`) and Yarn Classic. Yarn does not come with Node; `yarn: command not found` means this step was skipped.

```bash
# Node, through nvm (https://github.com/nvm-sh/nvm) if the machine does not have Node 22
nvm install          # run in the repository folder; reads .nvmrc
nvm use

# Yarn: either of these
corepack enable                       # uses the Yarn version package.json names
npm install --global yarn@1.22.22     # if corepack is missing or not allowed

yarn --version       # should print 1.22.22
yarn install --frozen-lockfile        # in the repository folder; the update command reinstalls after it pulls
```

Use `yarn`, never `npm install`, in this repository: npm writes a `package-lock.json` and installs different versions than the committed `yarn.lock`.

## Run it

```bash
cd 40k-reminders
nvm use
yarn data:update
```

## What it asks you

Every question has a default, shown in capitals or after `[Enter]`, and the defaults are the usual answer, so pressing Enter at each prompt is normally all it takes. Read the rule prompts as they go by and type a different answer when the default is wrong.

| Step | What happens | What you do |
| --- | --- | --- |
| 1. Checks git | Must be on `master`. If GitHub has newer commits it offers to pull them (and reinstall), then restarts itself with the new code. If an earlier refresh was left unfinished it asks whether to continue it, start over (which discards it), or quit. | Enter. |
| 2. Downloads | Fetches Wahapedia's exports, a second apart. Reuses the official PDFs unless their list changed. Stops with **Nothing to do** if nothing changed. | Nothing. |
| 3. New review | Starts a dated review file bound to the new downloads; every earlier decision carries over. | Nothing. |
| 4. Reviews | Moves decisions for renumbered rules to their new IDs by name. Lists by name any decisions whose rule is really gone and asks before dropping them. Asks before updating exclusion counts that changed, and asks for a new faction's Army Faction keywords. It also offers a fix, default first, for the other things a new export can bring: rows pointing at records Wahapedia does not publish (leave them out), new decoder warnings (accept), datasheets from a new kind of source (leave out, current, or Legends), a rule decided twice (keep one), quotes from an updated official PDF (drop the quote), and a faction or Chapter keyword Wahapedia dropped (remove it). Then prompts for each rule that needs a decision (below). | Enter, reading each rule as it goes by. Only a finding the updater has no answer for asks you to edit the review file; see the last rows below. |
| 5. Generates | Rewrites `src/wh40k11e/generated/runtime.json`. | Nothing. |
| 6. Reports | Lists what changed per faction and writes a commit message under `.cache/wh40k11e/reports/`. | Note which armies changed. |
| 7. Checks | Lint, types, build, tests. | If they fail, fix them and resume (below). |
| 8. Spot-check, commit and push | Waits while you look at the site, backs up the sources, then offers to commit and to push. | Run `yarn start` in another terminal, check a few changed armies, then Enter, Enter, Enter. |

### Deciding a rule

Each prompt shows the rule's name, where it comes from, and its text. Rules come up for one of two reasons:

- **Needs a timing**: the parser cannot tell when the rule happens. The suggested answer comes from an earlier rule of the same name or from the wording; when nothing in the wording names a time, it suggests always active.
- **Its text changed since it was decided**: Wahapedia reworded a rule that already had a decision. The old text is shown under the new one. Enter keeps the decision, unless the new wording names a different time (then Enter takes that) or the rule lost its text (then Enter drops it).

Before the prompts start, rules whose wording changed only in spacing or capital letters are listed with their decisions, and one Enter keeps them all. When the same rule (same name and wording) is on several datasheets or factions, the prompt lists where else it appears and your answer covers every copy.

| Key | Meaning |
| --- | --- |
| Enter | The answer shown after `[Enter]`: the suggestion, or keeping the existing decision. |
| `t` | Timed. Pick a numbered timing, press Enter for the one shown (the suggestion, or the phase the wording points at), or type one the way a WHEN: line reads, such as `end of your opponent's Charge phase` or `before the battle: Deploy Armies step`. |
| `r` | Reaction: happens in response to something (each time, when, after). You are asked what triggers it. |
| `p` | Always active. |
| `n` | Not a reminder: army building, a Designer's Note, framing text, or something else with your reason. |
| `s` | Skip for now. |
| `q` | Save and quit. |

Every answer is saved as soon as you give it, with the opening of the rule's text as its reason in the review file.

## Finish

The command offers to push at the end; GitHub then builds and publishes the site. Close the **Rules data sources changed** issue.

## If something stops it

| What you see | What to do |
| --- | --- |
| `Switch to master first`, `Commit or stash these changes first` | Do that, then run the command again. |
| `yarn: command not found` | Yarn is not installed on this machine; see **First time on a machine** above. |
| `npm error code EBADENGINE` | `npm install` was run. This project refuses npm on purpose; use `yarn install --frozen-lockfile`. |
| `Invalid value type` in `yarn.lock` during `yarn install` | Something other than Yarn (an older checkout's `npm install`) rewrote `yarn.lock`. Run `git restore yarn.lock && rm -rf node_modules && yarn install --frozen-lockfile`. |
| A download error such as `Request timed out` | Wahapedia is unreachable from this network. Nothing was changed. Try another network, or see [docs/data/wh40k11e-wahapedia-handoff.md](data/wh40k11e-wahapedia-handoff.md). |
| You quit, skipped rules, or the checks failed | Fix what it says, then run `yarn data:update` again and press Enter to continue (or `--no-fetch`, which goes straight to step 4). |
| You want to refresh even though nothing changed | `yarn data:update --force` |
| You want to stop before committing | `yarn data:update --no-commit`; the commit message is still written under `.cache/wh40k11e/reports/`. |
| `FINDING decoder-error` | Wahapedia changed the layout of an export (a renamed or missing column, a new file). The parser in `src/wh40k11e/data/wahapedia/` needs a code change before the refresh can go on. |
| Any other `FINDING` it cannot fix | Open the review file it names (`data/wh40k11e/reviews/`), find the entry the message names, and fix or remove it; `CONTRIBUTING.md` section 8 describes each section of the file. Press Enter to re-check. |

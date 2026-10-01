# 40K 11th Edition: fetching Wahapedia on another network

Wahapedia blocks the network the main development machine is on. These steps fetch the Wahapedia
sources on a machine that can reach it, then carry the result back as one archive.

The fetch only saves source files to the ignored `.cache/` tree and writes a checksum manifest. It
does not change accepted data, generated files, or the app. Raw Wahapedia pages and exports must
never be committed; move them only as the archive described below.

## 1. Get the repository

You need Git, [nvm](https://github.com/nvm-sh/nvm), and a network that can reach `wahapedia.ru`.
The steps use a macOS or Linux shell. On Windows, use WSL or Git Bash.

```bash
git clone https://github.com/cjwhitedev/40k-reminders.git
cd 40k-reminders
git checkout 40k-11e-port
```

If you already have a clone:

```bash
cd 40k-reminders
git fetch origin
git checkout 40k-11e-port
git pull
```

## 2. Install the toolchain

The repository pins Node `22.23.2` in `.nvmrc` and uses Yarn Classic with a committed lockfile.

```bash
nvm install
nvm use
npm install --global yarn@1.22.22
yarn install --frozen-lockfile
```

Confirm the 40K data code works before touching the network:

```bash
yarn vitest run src/tests/wh40k11e
```

All tests should pass.

## 3. Check that Wahapedia allows it

Open <https://wahapedia.ru/robots.txt> and make sure `/wh40k11ed/` is not disallowed. The commands
below wait one second between requests.

## 4. Fetch the rules pages

This fetches the two pages in `data/wh40k11e/wahapedia-urls.json`: the core rules page and the data
export page.

```bash
yarn data:wh40k11e:candidate \
  --wahapedia-urls-file data/wh40k11e/wahapedia-urls.json \
  --pause-ms 1000 \
  --output .cache/wh40k11e/candidates/wahapedia-pages
```

A successful run ends with `40K candidate manifest: .../candidate-manifest.json`.

If the run fails, it saves nothing: the output directory is only written after every URL
succeeds. Read the error line:

- `returned HTTP 404`: that URL does not exist. Find the right address in a browser, fix it in
  `data/wh40k11e/wahapedia-urls.json`, and rerun with a new `--output` directory.
- `returned HTTP 403`: Wahapedia blocked this network too. Try another network.
- `Received text/... from`: the page returned an unexpected file type. Copy the whole error line
  for the report in step 7.

Every rerun needs a new `--output` directory, because the command never overwrites one.

## 5. Check and fetch the CSV exports

AoS Reminders uses Wahapedia's CSV exports as its main secondary dataset, so 40K should too.
`data/wh40k11e/wahapedia-export-urls.json` lists the export files **guessed** from Wahapedia's
10th-edition naming. They have not been confirmed for 11th Edition.

1. Open <https://wahapedia.ru/wh40k11ed/the-rules/data-export/> in a browser.
2. Compare the CSV file names it lists with `data/wh40k11e/wahapedia-export-urls.json`. Add any
   missing files and remove any that don't exist. Keep the `https://wahapedia.ru/wh40k11ed/` prefix
   unless the page shows a different one.
3. Fetch them:

```bash
yarn data:wh40k11e:candidate \
  --wahapedia-urls-file data/wh40k11e/wahapedia-export-urls.json \
  --pause-ms 1000 \
  --output .cache/wh40k11e/candidates/wahapedia-exports
```

Failures read the same way as in step 4. A 404 here usually means one guessed file name is wrong.

If the data export page doesn't exist or lists no CSV files, skip this step and say so in the report.

## 6. Package the results

This archives each successful candidate directory together with the cached source files its
manifest points to. Run it from the repository root.

```bash
rm -f /tmp/wh40k11e-files.txt
for name in wahapedia-pages wahapedia-exports; do
  dir=".cache/wh40k11e/candidates/$name"
  [ -f "$dir/candidate-manifest.json" ] || continue
  echo "$dir" >> /tmp/wh40k11e-files.txt
  node -e 'const m=require(process.argv[1]);for(const a of m.artifacts)console.log(".cache/wh40k11e/artifacts/"+a.checksum)' \
    "./$dir/candidate-manifest.json" >> /tmp/wh40k11e-files.txt
done
tar -czf wh40k11e-wahapedia.tgz -T /tmp/wh40k11e-files.txt
rm /tmp/wh40k11e-files.txt
tar -tzf wh40k11e-wahapedia.tgz | grep candidate-manifest.json
```

The last command should print one `candidate-manifest.json` line per candidate directory that was
packaged. If it prints nothing, the archive is incomplete; report it rather than sending it.

If neither step 4 nor step 5 succeeded, there is nothing to package. Go straight to step 7.

## 7. Bring the files back

1. Copy `wh40k11e-wahapedia.tgz` to the main development machine (AirDrop, USB drive, or a cloud
   folder). Don't commit it or attach it to a GitHub issue; it contains raw Wahapedia content.
2. On the development machine, put it in
   `40k-reminders/.cache/wh40k11e/incoming/wh40k11e-wahapedia.tgz`.
3. Tell the assistant in chat that the archive is there. Include:
   - which steps succeeded
   - any error lines, copied in full
   - any URL changes you made to the two JSON lists
   - the CSV file names shown on the data export page, if step 5 was skipped or failed

Commit any URL list corrections to the `40k-11e-port` branch, or paste them in chat.

## 8. Unpacking on the development machine

The assistant runs this; it's recorded here for reference. Replaying offline re-checks the SHA-256
of every file against the manifest, so a damaged or altered archive fails instead of loading.

```bash
tar -xzf .cache/wh40k11e/incoming/wh40k11e-wahapedia.tgz
yarn data:wh40k11e:candidate \
  --wahapedia-urls-file data/wh40k11e/wahapedia-urls.json \
  --accepted-manifest .cache/wh40k11e/candidates/wahapedia-pages/candidate-manifest.json \
  --offline \
  --output .cache/wh40k11e/candidates/wahapedia-pages-replay
```

## Follow-up: fetch the export specification

The data export page doesn't list its CSV files directly. It links to a spreadsheet,
`Export Data Specs.xlsx`, whose English sheet links every published export. The first handoff
fetched 19 CSV files using guessed names; this follow-up fetches the spreadsheet so the command can
confirm those 19 are exactly the published set. This is the same check AoS Reminders runs for its
own exports.

On the machine that can reach Wahapedia, in the same clone that ran steps 4 and 5:

```bash
git pull
yarn install --frozen-lockfile
yarn data:wh40k11e:candidate \
  --wahapedia-url 'https://wahapedia.ru/wh40k11ed/Export%20Data%20Specs.xlsx?v=20260817b' \
  --output .cache/wh40k11e/candidates/wahapedia-spec
yarn data:wh40k11e:check-exports \
  --spec-candidate .cache/wh40k11e/candidates/wahapedia-spec \
  --exports-candidate .cache/wh40k11e/candidates/wahapedia-exports
```

If the fetch returns `HTTP 404`, the spreadsheet link has changed. Open the data export page,
copy the link behind the word "here" in the "WHERE?" paragraph, and use that URL instead.

The check ends with one of two results:

- `Candidate CSV exports match the published specification.` Nothing more is needed.
- A list of `missing from candidate` or `not in specification` URLs. Correct
  `data/wh40k11e/wahapedia-export-urls.json` to match, then rerun step 5 with a new `--output`
  directory and rerun the check against it.

Either way, package and send the results as in steps 6 and 7, with `wahapedia-spec` added to the
candidate names in the step 6 loop (and the new exports directory, if you reran step 5). Include
the check's output in your chat message.

## Status: rule timing (2026-10-01)

`yarn data:wh40k11e:rules` gives every matched-play rule a timing, and exits non-zero if any
matched-play rule is left without one. Of 6,050 matched-play rules, 5,943 take their timing from
printed text and 107 from reviewed `timingOverrides` in
`data/wh40k11e/reviews/sources-2026-09-30.json`. The 17 unresolved rules that remain belong to
other game modes.

The review excludes 86 records through `ignoredRules`: core move and shoot types; stratagem copies
from the previous edition, Boarding Actions, Challenger and unscoped New Orders; 8 Designer's Notes;
15 army-building rules; and 5 records with no playable rule of their own.

Apart from the 14 core-ability overrides, every override rests on Wahapedia text, because official
evidence is pinned only for the Core Rules and four faction packs. Each override quotes the
Wahapedia text it relies on. Revisit them when more official documents are pinned.

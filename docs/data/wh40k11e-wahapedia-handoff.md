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

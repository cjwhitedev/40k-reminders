# 40K Reminders

Never forget your Warhammer 40,000 rules again. 40K Reminders turns your army into a list of every rule it gives you, grouped by the moment it comes up in the game.

**Live site:** <https://cjwhitedev.github.io/40k-reminders/>

> **This project was built with AI.**
>
> **Most of the 40K-specific code, data tooling, and this README were written by GitHub Copilot, an AI coding assistant, running in agent mode in VS Code on the Claude Opus 5.5 model.** A human (me, the repo owner) directed the work, made the product and rules decisions, and reviewed the results in the browser. The original AoS Reminders code it is built on was written by Davis E. Ford and the AoS Reminders contributors.
>
> A note from Copilot: rule timings were classified from source text by code I wrote, plus about two hundred hand-reviewed decisions recorded in `data/wh40k11e/reviews/`. I can make mistakes. Treat the reminders as an aid, check anything that matters against your codex, and open an issue if a rule looks wrong.

## Built on AoS Reminders

This project is a fork of [AoS Reminders](https://github.com/daviseford/aos-reminders) by [Davis E. Ford](https://daviseford.com), the Age of Sigmar reminders app at [aosreminders.com](https://aosreminders.com). The army builder, the reminder cards, notes, hiding, drag-to-reorder, the offline support, and much of the source-handling code underneath come from years of his work. This fork retools them for Warhammer 40,000.

If you play Age of Sigmar, use the original. If this site helps your games, consider [supporting AoS Reminders](https://aosreminders.com/subscribe).

40K Reminders deliberately does not offer anything AoS Reminders charges for: there are no accounts, saved armies, share links, or dark theme here. Account links on this site forward to aosreminders.com.

## What it does

1. Pick your faction, detachment, enhancements, and units.
2. Every rule your army has is listed under the moment it applies: before the battle, the start and end of a battle round, each phase of the turn, reactions to your opponent, and rules that are always active.
3. Switch to **Play** at the table. Hide the rules you already know, add notes, and drag reminders into your own order. Your army is saved in your browser.

It covers Warhammer 40,000 eleventh edition matched play. Boarding Actions detachments are not offered. Legends units are listed under their own heading.

## Sources

Games Workshop publications are the authority. Most rules text comes from Wahapedia's eleventh edition data export, cross-checked against the BSData catalogues and corrected against official Games Workshop documents as they are added. Where sources disagree, the official document wins.

- [Official Warhammer 40,000 downloads](https://www.warhammer-community.com/en-gb/downloads/warhammer-40000/)
- [Wahapedia 40K data export](https://wahapedia.ru/wh40k11ed/the-rules/data-export/) - rules data. Powered by Wahapedia
- [BSData wh40k-11e](https://github.com/BSData/wh40k-11e)

The site ships a checked-in rules file (`src/wh40k11e/generated/runtime.json`) and never fetches rules data at runtime. Raw source files are not committed.

## Development

Use Node `22.23.2` (see `.nvmrc`) and Yarn Classic.

```bash
nvm use
yarn install --frozen-lockfile
yarn start
```

Vite serves the app at `http://localhost:5173`.

Checks, in the order CI runs them (build before test, because the PWA tests read `dist/`):

```bash
yarn lint
yarn tsc --noEmit
yarn build
yarn test --run
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to update the rules data, fix a rule, and release.

## Deployment

Pushing to `master` runs [.github/workflows/pages.yml](.github/workflows/pages.yml), which lints, tests, builds the site for `/<repo>/`, and publishes it to GitHub Pages. It can also be run by hand from the Actions tab. In the repository settings, Pages must be set to deploy from **GitHub Actions**.

## Project layout

- `src/wh40k11e/` - the 40K rules pipeline, army selection, reminder projection, and view models
- `src/wh40k11e/generated/runtime.json` - the rules file the site loads (generated, never hand-edited)
- `data/wh40k11e/` - source URL lists, the faction map, and the reviewed source decisions
- `src/aos4/` - source acquisition, text normalization, and shared types inherited from AoS Reminders
- `src/components/` - the React interface
- `brand/` - SVG sources for the icons and social preview image; `yarn brand:icons` renders them into `public/`
- `scripts/` - maintenance scripts run through `yarn`

## License and credits

MIT, see [LICENSE](LICENSE). The original copyright notice for AoS Reminders is kept as the license requires.

40K Reminders is unofficial and fan-made. It is not endorsed or sanctioned by Games Workshop and takes no credit for their content. Warhammer 40,000 and all associated names are trademarks of Games Workshop Ltd.

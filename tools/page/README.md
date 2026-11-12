# Page artwork

Source of every image in `assets/` and the frames around `docs/screenshots/`.
The style follows the plugin's Royal Emerald skin: an illuminated Mushaf border, ruby surah-header cartouches,
Amiri for Arabic display text and Cairo (the plugin's own font) for labels. The section medallions in `icons/`
are cut from the plugin's home-screen artwork.

```sh
npm i playwright && npx playwright install chromium   # once
node tools/page/build.js            # hero, headings, buttons, sections map, features, steps, family cards
node tools/page/build.js shots      # frame screenshots
node tools/page/build.js art hero   # only outputs whose name contains "hero"
```

## Screenshots

Put the raw 1920×1080 captures in `tools/page/shots-raw/` (ignored by git) with the names listed in
[docs/screenshots/README.md](../../docs/screenshots/README.md), then run `node tools/page/build.js shots`.
Missing captures become "coming soon" plates; their hashes go to `docs/screenshots/PENDING`, and
`scripts/check_page.py` refuses a release while any of them is still on the page.

To show the real home screen inside the hero TV, replace `tools/page/hero-screen.jpg` and rebuild.

Fonts: Amiri and Cairo, SIL Open Font License 1.1 (from Fontsource). Templates: `templates/*.html`,
shared ornaments: `ornament.js`, colours and fonts: `base.css`.

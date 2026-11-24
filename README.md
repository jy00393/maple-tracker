# Maple Tracker

A personal MapleStory (GMS) tracker that runs free on GitHub Pages and refreshes itself from Nexon's public news feed every 6 hours.

- **Today**: a Challenger World end-of-season countdown with the steps Nexon's notice requires before each deadline, the next Sunny Sunday's perks (and whether to wait for a Star Force Sunday), a one-minute first-run setup, a warning when a reset is close and something is still open, the best next upgrade (most gear score per meso, with its cost and the date you can afford it), a 30/60/90-minute session plan, your dailies streak, this week's crystals, the next level gate, and gameplay events ending this week (Cash Shop sales are hidden until you ask; × hides an event that isn't for you).
- **Events**: a timeline of every live and upcoming event (overlaps at a glance, Thursday reset ticks, today line), plus Live now / Starting soon / Maintenance / All posts lists, all parsed from Nexon's posts. **Reminders on your phone**: subscribe to the calendar feed the job publishes (event ends with a day-before alert, maintenance, weekly resets).
- **Checklist**: dailies and weeklies that clear themselves at the right reset, ticked separately for each character (account-wide items are shared), with Challenger World items shown only for Challenger characters and items hidden until your level reaches them, and a 16-week streak calendar.
- **Bosses**: pick bosses, tick clears, see Heroic (×5) crystal income with the 14-per-character and 180-per-world caps.
- **Mesos**: a planner (weekly income from bosses, Ursus, farming vs goals like 200 Bright Cubes, with the date each is affordable), a GMS v.272 Star Force calculator (expected cost, typical and bad-luck cost, boom odds, Sunny Sunday and Safeguard), a cube tier-up calculator, and a 12-week income chart.
- **Gear**: an equipment grid; tap a slot for an item editor with name search and pictures (item list and icons from the community API maplestory.io), the game's real potential lines per slot and tier, prime and non-prime, valued for the item's level (Meso Obtained and Item Drop Rate +20% on Legendary accessories, cooldown on hats, crit damage on gloves), bonus stats (flames), the stats your stars give, set effects recognised from the item names, an optional damage estimate that ranks Star Force upgrades by damage per meso once you enter your stat-window totals, totals for STR %, boss, meso and drop, and the expected mesos to reach each slot's target.
- **Progress**: level gates with dates (Beyond Burning aware), symbols, Genesis/Destiny liberation, 6th job order with a Sol Erda planner, Item Burning Plus.
- **Settings**: daily safety copies of your entries with one-tap restore, sync between PC and phone through a secret gist (entries from both devices are merged; a QR code connects the phone; an optional reminder before the token expires), install as a phone app, backup and restore.

Everything you enter stays in your browser (localStorage). Use **Settings → Export backup** to move it to another device.

## Set it up (about 10 minutes)

1. On github.com, create a new repository, for example `maple-tracker`.
   - Free GitHub Pages needs a **public** repository. With GitHub Pro you can make it private.
   - Your ticks and entries are never in the repo, only in your browser.
2. Put these files in it. Either:
   - push with git, or
   - on the empty repo's page click **uploading an existing file**. Open the unzipped folder, select everything **inside** it (Ctrl+A), including the `.github` folder, and drag that onto the page. Don't drag the folder itself, or everything lands one level too deep. Click **Commit changes**. (On a Mac, press Cmd+Shift+. in Finder to see `.github`.)
3. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
4. **Actions** tab → **Update Nexon data and deploy** → **Run workflow**. Wait for the green tick (about a minute).
5. Open `https://<your-username>.github.io/maple-tracker/`. Add your character on the **Characters** tab.

After that it runs by itself every 6 hours, and again whenever you push a change.

Then, on the site:

- **Phone app**: on iPhone open the link in Safari → Share → Add to Home Screen; on Android Chrome → menu → Install app.
- **Reminders**: Events → Reminders on your phone → Subscribe (or Add to Google Calendar).
- **Same data on PC and phone**: Settings → Sync. Make a classic GitHub token with only the `gist` scope, paste it on each device. After the first device is connected, **Connect my phone (QR code)** shows a code the phone can scan instead of pasting the token; treat that code like a password. Your entries go to a secret gist on your account; the token stays in that browser. All your GitHub Pages sites share one origin (`<you>.github.io`), so keep the token's scope to gists.
- **Level dates**: Progress → Level, log your level and EXP % now and then (or list the character in `config/characters.json` and the job records it from Nexon's rankings).

Two things that can look wrong but aren't:

- Your upload in step 2 starts a run straight away, before Pages is switched on, so that first run fails at "configure-pages" and GitHub may email you about it. Step 4 is the run that counts.
- If the Actions tab shows no workflow, the `.github` folder didn't upload. Click **Add file → Create new file**, type `.github/workflows/update-and-deploy.yml` as the name, paste in that file's contents and commit.

If every run reports a Nexon error on the Settings page, Nexon may be refusing GitHub's servers. Everything you enter keeps working; only events and level lookups stop updating. Running `node scripts/update-data.mjs` on your own computer and pushing the result is the fallback.

## Optional: automatic level updates

List characters in `config/characters.json`:

```json
[{ "name": "YourIGN", "region": "na" }]
```

Each run looks them up on Nexon's public rankings and the Characters page offers to copy the new level across. Anything in this file is visible to anyone who can see the repository (the rankings already show it publicly).

## How the auto-update works

`scripts/update-data.mjs` (Node 22, no dependencies) runs in GitHub Actions:

1. Reads Nexon's news list at `g.nexonstatic.com/maplestory/cms/v1/news`.
2. Downloads recent event, update, sale and maintenance posts (only new or recently changed ones, at most 30 per run, half a second apart).
3. `scripts/lib/nexon-parse.mjs` finds each section's date window ("November 11, 2026 (after maintenance) - February 9, 2027 11:59 PM UTC", Cash Shop "UTC: Monday, November 23 8:00 AM - …", maintenance "starting on … concluding around …") and any reset notes.
4. Writes `site/data/news.json`, `events.json`, `posts.json`, `characters.json` (with a level/EXP history) and `calendar.ics`, commits changes, and deploys `site/` to Pages.

Nexon has no official API for GMS. If they change their pages the job will report errors on the Events and Settings pages; the parser tests (`node --test scripts/test/*.test.mjs`) show what broke.

GitHub pauses scheduled jobs in public repos after 60 days with no repository activity. The job's own data commits normally keep it active; if it ever stops, re-enable it from the Actions tab.

## Static game data

These change only with big patches. Each file says where it came from:

| File | What | Source |
|---|---|---|
| `site/data/bosses.json` | Boss crystal prices (Interactive; Heroic ×5), caps | MapleStory Wiki, Intense Power Crystal, GMS v.272 tab |
| `site/data/symbols.json` | Symbol costs and Heroic daily amounts | MapleStory Wiki symbol pages |
| `site/data/liberation.json` | Genesis and Destiny stages and per-boss amounts | MapleStory Wiki, Genesis/Destiny Weapon |
| `site/data/ibp.json` | Item Burning Plus stages | Nexon v.272 event notice |
| `site/data/checklist.json` | Daily and weekly checklist | Nexon notices and community guides |
| `site/data/items.json` | Equipment names, levels and slots for the Gear search (refreshed by the job) | maplestory.io community API; unofficial and may lag a patch or two |
| `site/data/potential.json` | Potential lines per equipment group and tier, with values by item level | StrategyWiki, Potential System (page from Aug 2023; GMS values for Lv. 151+) |
| `site/data/gearstats.json` | Star Force stat gains per star, set effects, the damage formula used for estimates | MapleStory Wiki: Star Force stat tables, set pages, Damage Formula |
| `site/data/season.json` | Challenger World end-of-season deadlines and steps | Nexon's Challenger World notice (news id 47305) |
| `site/data/gear.json`, `erda.json` | Gear tiers, targets, 6th-job order | Editable presets |
| `site/data/upgrades.json` | Star Force rates and costs, cube prices and tier-up odds, potential line values, EXP table 260-300, Sol Erda costs | MapleStory Wiki, Nexon v.269/v.271 notes; cube odds are community estimates (Nexon doesn't publish GMS odds) |

## Run it locally

```sh
cd site && python3 -m http.server 8000   # then open http://localhost:8000
node scripts/update-data.mjs            # refresh data by hand
node --test scripts/test/*.test.mjs     # tests
```

Not affiliated with Nexon. MapleStory and its game names belong to Nexon. Preact and htm are MIT-licensed (see `site/vendor/`).

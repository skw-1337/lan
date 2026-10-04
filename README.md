# LAN Party · availability planner

A small static site (GitHub Pages) backed by Firebase (Firestore + Authentication) to organise a remote
"fake LAN" over Radmin VPN. Each guest gets a personal invite link, picks the dates they're free and the games
they're up for, can suggest another game, and everyone sees who's coming. The interface is available in
French and English.

Featured classics: Counter-Strike 1.6, Warcraft III, StarCraft, Age of Empires II and Quake III Arena.

| Path | What it is |
| --- | --- |
| `index.html` | Guest page: line-up, availability form, scoreboard |
| `admin.html` | Organizer page (email + password sign-in): invites, dates, games, replies |
| `js/` | App code, no build step. `i18n.js` holds the FR/EN strings, `games.js` the games catalog |
| `img/` | Artwork of the featured games (see credits) |
| `firestore.rules` | Security rules, published with `node deploy-rules.mjs` |
| `.tests/rules.test.mjs` | Security tests run against the real Firebase project |

## How identity is checked

1. The organizer creates one link per guest (`…/#i=<128-bit code>`) and sends it privately.
2. On first visit, the guest confirms "Yes, I'm X". The link is then bound to that browser (an anonymous
   Firebase account) and can't be activated anywhere else.
3. Firestore rules make sure a guest can only write their own answer, under the name chosen by the organizer.
   Nobody can read the planner without an activated link.

If someone else opens a link before its owner, the owner sees "Link already used" and tells the organizer, who
clicks **New link**: the old link and the bound device are revoked, answers are kept. Same thing if a guest
switches phones or clears their browser data.

## Setup

1. **Firebase** ([console.firebase.google.com](https://console.firebase.google.com)):
   - create a project;
   - Authentication → enable the **Anonymous** and **Email/Password** providers;
   - Firestore Database → create the database (production mode);
   - Project settings → Your apps → Web → copy the config into `js/firebase-config.js`
     (these values are public by design; security lives in the rules).
2. **Organizer account**: Authentication → Users → Add user (email + password). Save its UID in a local
   `.admin-uid` file at the project root. The file is git-ignored, so the UID is never published.
3. **Rules**: `node deploy-rules.mjs` inserts the UID into the rules and publishes them.
4. **GitHub Pages**: push this folder to a public repository, then Settings → Pages → Deploy from a branch →
   `main` / `(root)`.

## Usage

- On `admin.html`, fill in the event (title, practical info such as the Radmin network or Discord link, dates,
  games) and save. The classic games can be added in one click, as can the games suggested by guests.
- Add guests one by one: the invite message is copied automatically, ready to paste in a private message.
- To join the LAN yourself, sign in as organizer first, then create your own invite and open it in the same browser.

## Security tests

```bash
cd .tests && npm install && node rules.test.mjs
```

The script temporarily publishes test rules (the organizer keeps access), replays the normal flows and the
cheating attempts with throwaway anonymous accounts, cleans up, then republishes the real rules.

## Credits

Artwork © Valve (Counter-Strike), Blizzard Entertainment (Warcraft III, StarCraft), Microsoft (Age of Empires II),
id Software (Quake III Arena). Non-commercial fan project, not affiliated with these publishers.

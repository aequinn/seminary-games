# Seminary Games

Small browser games for seminary class. Each game is a single `index.html` in its own folder. Open it on the classroom projector to play.

## Games

| Game | Folder | What it is |
|---|---|---|
| One in a Millennium | [`one-in-a-millennium/`](one-in-a-millennium/) | Old Testament team trivia where rarer correct answers score more, with Jeremiah–Joel and Doctrinal Mastery rounds. |

## Joining from phones

Teams can play from a phone instead of the leader typing every answer.

1. On the setup screen, click **Let teams join by phone**. A QR code and a 4-letter game code appear. **Show on the big screen** makes them large for the projector.
2. One person per team scans the code (or goes to `/join` and types the code), then types the team's name. Each phone takes an unused "Team N" slot, or adds a new team.
3. Each round, the question shows on the phones. Answers drop into the team's answer box on the projector, still hidden. The leader can change them before revealing.
4. After the reveal, each phone shows its own result. After each round it shows the standings.

Teams without a phone still work: the leader types their answers as before. If a phone loses its connection, it reconnects to its team on its own. A team that switches phones mid-game can rejoin by typing its exact team name. Rooms close by themselves after 24 hours.

Phone joining needs the site's server (below). The games still work without it, including when opened as a plain file.

## The server

`worker/index.ts` is a Cloudflare Worker. It serves the pages and runs one Durable Object per game room, which relays messages between the projector and the phones over WebSockets. Projects use the `cf` CLI (`cloudflare.config.ts`), with Vite building the pages.

```sh
npm install
npm run dev       # http://localhost:5173 on this computer only
npm run dev:lan   # also on your network address, so phones on the same Wi-Fi can join
npm run deploy    # publish to coolseminarygames.win
```

The live site is the `seminary-games` Worker on `coolseminarygames.win` and `www.coolseminarygames.win` (set in `cloudflare.config.ts`). Pushing to GitHub does not publish it; run `npm run deploy`. The older `seminary-games` Pages project no longer serves the domain.

When testing with phones locally, open the game on the computer using the network address that `npm run dev:lan` prints, not `localhost`. The QR code uses whatever address the projector page was opened from.

## Adding a game

1. Make a new folder named for the game, such as `my-new-game/`.
2. Put the game's page in that folder as `index.html`.
3. Add it to the `pages` list in `vite.config.ts`.
4. Add a card for it to the menu in the top-level `index.html`, and a row to the table above.

## Scripture Man

`scriptureman/` is kept as separate files for editing: `index.html`, `style.css`, and `script.js`. Opening `index.html` directly plays the game. To make the one-file copy for deploying, run:

```sh
npm run build:scriptureman
```

That writes `scriptureman/build/scriptureman.html` with the CSS and JavaScript inlined. Rebuild after every edit.

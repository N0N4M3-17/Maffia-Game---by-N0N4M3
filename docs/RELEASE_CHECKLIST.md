# Mafia 2.0 Release Checklist

Use this checklist before treating a branch as a v1 release candidate. It is written for the local GM-hosted Java build, with optional secure public access through an HTTPS tunnel or reverse proxy.

## 1. Prerequisites

- Java 17+ is installed and available as `java`.
- Maven 3.9+ is installed and available as `mvn`.
- Node.js 22+ is installed when running static checks or `npm start`.
- The repository is clean except for intentional release changes.
- The host machine and test phones are on the same LAN.
- If testing internet access, an HTTPS tunnel or reverse proxy is ready and its public origin is known.

## 2. Source Checks

Run these from the project folder:

```bash
npm test
mvn -q test
git diff --check
```

All three must pass before release. If Java or Maven are unavailable locally, GitHub Actions must pass the Maven test job before the branch can be treated as release-ready.

## 3. Clean Host Smoke Test

Run the app from a clean checkout or freshly unpacked build:

```bash
mvn exec:java
```

Then verify:

- The terminal prints local and LAN URLs.
- The browser opens the local host without serving the obsolete anonymous-only prototype.
- The seeded admin can log in with email or username.
- The admin can create a non-admin player account.
- A named room can be created and becomes the active hosted table.
- Three or more accounts can join the active room from separate browser sessions.
- The GM can configure a valid role set and launch the game.
- Each player sees only their own role, except Mafia players also see their Mafia teammates.
- The GM can see all role assignments after launch.
- Public chat is blocked outside allowed public phases and dead players are observe-only.
- Mafia and day votes lock early when a decisive majority is reached.
- Day voting uses strict majority; no majority means no elimination unless all votes create a valid majority.
- Newly eliminated players receive one final-statement window.
- Game over records wins/losses on player profiles.
- Reset returns the table to a usable lobby state.

## 4. LAN Device Test

Use at least one laptop GM view and two phone portrait views:

- Phones join through the LAN invite from the Rooms screen.
- Portrait layouts keep controls visible without horizontal scrolling.
- Landscape/laptop layouts keep GM controls, phase state, and player lists readable.
- Invite copy controls work where the browser supports the clipboard API.
- Refreshing a player browser does not expose another player's private state.

## 5. Secure Public Hosting Test

Only test internet access through HTTPS:

```bash
PUBLIC_URL=https://your-secure-host.example mvn exec:java
```

Then verify:

- The Rooms screen shows the secure public invite.
- The UI marks the public URL as secure.
- Remote players can register/login and join the active room through the public origin.
- Firewall rules do not expose the plain LAN host directly to the public internet.
- Closing the tunnel or proxy makes public access unavailable without corrupting local data.

## 6. Data And Privacy Checks

- `data/` remains ignored by git.
- `data/mafia-db.json` is present only on the host machine.
- Password records are salted PBKDF2-HMAC-SHA256 hashes, not plaintext.
- Profile image uploads reject unsupported formats and dimensions above 100x100.
- The app blocks deleting or demoting the last admin.
- Browser payloads do not expose hidden roles, night targets, or private action results to unauthorized players.

## 7. Known Limitations

- The host currently runs one active game table at a time.
- Internet play requires a separate HTTPS tunnel or reverse proxy; the app does not provide managed cloud hosting.
- The local database is a host-owned JSON file, not a multi-machine or cloud account system.
- Java 17 and Maven are required for the current host runtime.
- Automated rule coverage is still a release blocker until the role, phase, vote, authorization, and short-game paths are covered.

## 8. Release Decision

Do not publish a release candidate until:

- Source checks pass.
- GitHub Actions pass.
- Clean host smoke test passes.
- LAN device test passes.
- Secure public hosting test passes if internet invites are included in the release notes.
- Known limitations are reviewed and accepted by the GM.

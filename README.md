# Maffia-Game---by-N0N4M3

Maffia Game ported to hybrid mode (Browser/Phone capacity).

## Run the Java LAN host

### Requirements
- Java 17+
- Maven 3.9+
- Node.js 22+ for local static checks and the optional `npm start` launcher.

### Start server

```bash
mvn exec:java
```

Alternatively, if Node.js is already installed, `npm start` delegates to the same Maven Java host.

Server binds to `0.0.0.0:3000` by default and prints LAN URLs in terminal.

## Current implementation status

- Java backend host for LAN browser play.
- GitHub Actions CI runs static checks and Maven tests on pull requests.
- Persistent local account registry with email/username login.
- Seeded local admin account: `gabi17hun@gmail.com` / `n0n4m3-admin` with password `admin123`.
- Browser admin screen for creating, editing, and deleting the local player base, scores, usernames, emails, and passwords.
- Named room list with local LAN and internet-ready room modes; one room is the active hosted table at a time.
- Profile settings with display-name changes, score history, and max 100x100 profile image uploads.
- GM-hosted room lobby in browser.
- Players join from their authenticated account.
- Player seats recover from the signed-in account after refresh where possible.
- GM configures role counts (including Town manually).
- GM starts game into **Night 0**.
- Testing launch rules: minimum 3 players, with at least 1 Mafia, 1 Sheriff/Doctor/Vigilante, and 1 Town.
- Roles are pushed to each player privately in their client on Night 0.
- GM sees all connected players and assigned roles once game starts.
- Public player chat is restricted to morning, discussion, day vote, and game over; dead players are observe-only.
- Newly eliminated players receive a timed final-statement phase and can submit one final public message.
- Mafia and day votes advance early once a decisive majority is reached; day votes also resolve when every alive player has voted.

## Local data

The host stores accounts, room metadata, sessions, profile images, and scores in `data/mafia-db.json`.
Passwords are not stored in plaintext; they are salted and hashed with PBKDF2-HMAC-SHA256.
Keep the `data/` folder local and out of git.

## Room hosting model

The current host runs one active game table at a time. Creating a named room makes it the active table when no lobby/game is in progress. Players can join the active room locally through the LAN URL, or through the configured public URL when the host is placed behind a secure HTTPS tunnel or reverse proxy.

### Secure public invite

For internet play, run the Java host behind an HTTPS tunnel or reverse proxy and start it with `PUBLIC_URL` set to the public HTTPS origin. Example:

```bash
PUBLIC_URL=https://your-secure-host.example mvn exec:java
```

The Rooms screen will show that URL as the secure public invite. Do not expose the plain LAN host directly to the internet without HTTPS and firewall controls.

## Current Spec Drafts

- [Spec v1 (Sections 1–2): Phase State Machine + Role Permission Matrix](docs/SPEC_V1.md)
- [Product plan: aims, milestones, completion marks, and v1 release gates](docs/PRODUCT_PLAN.md)
- [GM runbook: hosting, rooms, admin, gameplay operation, and troubleshooting](docs/GM_RUNBOOK.md)
- [Release checklist: source checks, LAN/public smoke tests, privacy checks, and known limitations](docs/RELEASE_CHECKLIST.md)

# Mafia 2.0 GM Runbook

This runbook is for the person hosting the local game table.

## 1. Requirements

- Java 17 or newer.
- Maven 3.9 or newer.
- A laptop or desktop on the same network as the players.
- Optional: Node.js, only if you want to use `npm start` as a shortcut.

## 2. Start the Host

From the project folder:

```bash
mvn exec:java
```

Or, with Node.js installed:

```bash
npm start
```

The host binds to `0.0.0.0:3000` and prints local and LAN URLs in the terminal. Open the local URL on the host machine. Players use the LAN invite from the Rooms screen.

## 3. First Admin Login

The local admin account is seeded on startup:

- Email: `gabi17hun@gmail.com`
- Username: `n0n4m3-admin`
- Password: `admin123`

After logging in, use the Admin screen to create, edit, score, reset passwords for, or delete player accounts. At least one admin account must remain, so the app will block deleting or demoting the last admin.

## 4. Create or Join a Room

Use the Rooms screen to create a named room. The host currently runs one active table at a time:

- Creating a room makes it the active room when no lobby or game is in progress.
- Players should join the active room.
- Switching rooms is blocked while a lobby or game is active.
- Reset the lobby before changing to a different room.

The invite panel provides:

- Local host link for the host computer.
- LAN invite for players on the same network.
- Secure public invite when `PUBLIC_URL` is configured.

## 5. Secure Public Hosting

For internet play, place the Java host behind an HTTPS tunnel or reverse proxy and start the host with `PUBLIC_URL` set:

```bash
PUBLIC_URL=https://your-secure-host.example mvn exec:java
```

Use HTTPS and firewall controls. Do not expose the plain LAN host directly to the public internet.

## 6. Configure the Game

On the Host screen:

1. Confirm all players have joined the active room.
2. Set role counts so total roles match seated players.
3. Keep at least 1 Mafia, 1 Town, and 1 Sheriff/Doctor/Vigilante. Add Jester only when you want a neutral vote-out objective in the round.
4. Adjust timers if needed.
5. Choose whether day vote tally messages are public.
6. Save setup and launch roles.

## 7. Run the Table

The server owns timers, legal actions, private information, and phase transitions.

- Night 0 privately reveals roles.
- Mafia, Sheriff, Doctor, and Vigilante phases run in order when those roles are alive.
- Mafia votes lock early when a majority kill target is reached.
- Vigilante choices lock like Sheriff and Doctor choices, then advance after the short result hold.
- Day votes resolve on strict majority or when every alive player has voted.
- If a Jester is voted out during the day, that Jester immediately wins independently.
- If morning begins with only one Mafia and one armed Vigilante alive, the Vigilante wins independently.
- Newly eliminated players receive a final-statement phase and may submit one final public message.
- Dead players become observe-only outside their final-statement window.

The GM can manually advance the phase when needed.

## 8. Scores

When the game reaches game over, scores are recorded to local player profiles:

- Mafia players win when Mafia wins.
- Town-aligned players win when Town wins.
- A lynched Jester wins alone on a Jester victory.
- Vigilante wins on the special armed morning duel victory.
- Games, wins, and losses persist in `data/mafia-db.json`.

## 9. Troubleshooting

- If players cannot connect, confirm they are on the same network and use the LAN invite, not `localhost`.
- If the LAN invite is missing, check firewall and network adapter settings.
- If Maven is not found, install Maven 3.9+ and make sure `mvn` is on PATH.
- If Java is not found, install Java 17+ and make sure `java` is on PATH.
- If a player refreshed, have them log in again and use Join current room.
- If room switching is blocked, reset the lobby after the current game is finished.

## 10. Local Data

Accounts, sessions, rooms, profile images, and scores are stored locally in `data/mafia-db.json`. The `data/` folder is ignored by git and should remain private to the host machine.

# Room Management

The server still runs **one active game table**. Multiple named room records can exist; creating an inactive room does not replace a populated active table. Independent simultaneous games remain future work.

## Permissions and Behavior

- Any signed-in account can create a room and become its host.
- Hosts can rename/change network mode, disband their rooms, kick members, apply timeouts, and lift temporary restrictions.
- Admins can manage any room, permanently evict an account from that room, and lift permanent evictions. Hosts cannot remove admins or undo an admin eviction.
- Hosts/admins choose **Join as player** or **Observe**. Observer mode has no player seat or role card and retains management controls. A player seat can switch to observer only in the lobby, preserving active-round results and role counts.
- Kick removes membership but allows rejoining. Timeout blocks rejoining until expiry; UI offers 5 minutes, 15 minutes, or 1 hour. API range is 30-86400 seconds. Admin eviction lasts until lifted.
- Restrictions are account-scoped and persisted in the local JSON database. Both the room join route and legacy `/api/join` enforce them. A newly registered account is a different identity; this is not IP/device moderation.
- Removing a living player mid-round voids the game without scores. The player's actions and state endpoint are blocked immediately, and their seat is removed on lobby return. Removed dead-player records remain until the round ends so scoring is preserved.
- Disbanding hides the room and rejects new joins. An active round displays a void reason before automatic lobby return; all its seats are cleared. Disbanding an idle room does not affect another active table.
- Moderation changes are available from **Rooms -> Manage room**, with native confirmations. The dialog includes room members, restrictions, duration selection, and disband control.

## API Changes

- `GET /api/rooms`: open rooms with viewer-specific `canManage`/`canObserve`; member and restriction lists are moderator-only.
- `POST /api/rooms`: `{name, networkMode}` creates a room; only an empty inactive table is automatically replaced.
- `PATCH /api/rooms/{id}`: `{name, networkMode}`; owner/admin only.
- `DELETE /api/rooms/{id}`: disband; owner/admin only.
- `POST /api/rooms/{id}/join`: optional `{mode: "player" | "observer"}`. Legacy omitted mode remains player. Observer reply has `observer: true` and no player ID.
- `POST /api/rooms/{id}/moderate`: `{action: "kick" | "timeout" | "evict" | "unban", accountId, durationSec?}`. Permanent eviction and lifting it require admin.
- `GET /api/my-player`: can report observer recovery or a moderation notice without returning a seat.
- `GET /api/gm-state`: `viewerMode` distinguishes a seated administrator from a separate observer, so player counts do not hide a real admin player.

Room records add `disbanded`, `blockedUntil` (account to expiry timestamp; permanent eviction uses the server's max-long sentinel), and `observerAccountIds`. Missing fields in existing databases are initialized when loaded. Personal data/password hashes are not added to room list payloads.

## Verification and Limits

The automated browser suite includes real-server registration/authentication and moderation tests plus portrait dialog interaction. It checks cross-host denial, admin protections, bans on both join paths, persisted expiry, observer seat counts, active-game voids, and disband cleanup.

Internet use still requires HTTPS hosting, rate limits/request-size hardening, and physical-network acceptance. This feature does not make the LAN host a fully hardened public hosting service.

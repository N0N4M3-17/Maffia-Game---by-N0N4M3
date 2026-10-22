# Mafia 2.0 Product Plan

Reviewed: 2026-10-22. Product stage: playable LAN prototype; not release-ready.

## Status Rules

`[x]` means implemented, not production-certified. Unchecked items say **Missing**, **Partial**, or **Verification Pending**. Acceptance evidence is recorded separately; code is not proof of a completed real-device playtest. Percentages are replaced with observable milestones.

## Product Intent

One local Java host runs a social-deduction table. Players sign in from browsers and phones, join a named room, privately receive roles, and play server-controlled rounds while a separate GM facilitates. Local accounts, salted password hashes, profiles, avatars, and aggregate scores persist on the host.

The theme is **Noir Card Table**: charcoal and forest-black surfaces, restrained brass, deep-red danger states, readable system text, serif display headings, tactile cards, and role accents only when privately revealed.

Five scenes: account/profile; lobby/setup; full-space dealing; gameplay/GM observation; outcome followed by lobby return. Administrative screens remain practical. The GM is excluded from displayed table-player counts in the separate host view.

## M0: Runnable Foundation

- [x] Java LAN host, browser delivery, local/LAN URLs, and Node launch wrapper.
- [x] Resolve 11 locally conflicted files, retaining the modern account-based game. Originals are preserved in ignored `.local-backups/pre-noir/`.
- [x] Restore valid JavaScript, package manifests, and Java compilation. This was the immediate prerequisite to the UI pass.
- [x] Static checks, Java rule tests, and browser test harness.
- [ ] **Verification Pending:** clean Java 17 installation and packaged launch. Local verification uses installed JDK 23 targeting Java 17.

## M1: Accounts, Rooms, and Setup

- [x] Registration and username/email login with salted PBKDF2 password hashes.
- [x] Persistent local registry, admin editing/deletion, and last-admin protection.
- [x] Editable name and profile image with format and 100x100 validation.
- [x] Aggregate games/wins/losses on profiles.
- [x] Named rooms, one active table, LAN invite, optional HTTPS public-origin invite.
- [x] Mafia, Sheriff, Doctor, Vigilante, Jester, Town, and ammunition setup.
- [x] Role-count validation, minimum test composition, editable timers, public-tally setting, lobby seat removal.
- [ ] **Missing:** per-game history, individual result records, and score deltas.
- [ ] **Partial:** secure internet hosting; public URL support exists, deployment hardening and remote testing remain.
- [ ] **Missing / future scope:** simultaneous independent games in multiple rooms.

## M2: Private Dealing and Core Gameplay

- [x] Server-shuffled roles, Night 0 dealing, private peek/hide card, local acknowledgement.
- [x] Server phase ticker, optional-role skipping, timed abstention, morning and final statements.
- [x] Mafia majority vote/private chat; Sheriff investigation; Doctor self-protection/no consecutive repeat; optional ammunition-limited Vigilante shot.
- [x] Alive-player target tiles, explicit submit/lock, Doctor warning, Sheriff visual result.
- [x] Brief result holds after Sheriff, Doctor, and Vigilante submission before advancement.
- [x] Strict-majority day/Mafia voting, abstention, no elimination without majority, early resolution.
- [x] Protection-aware simultaneous night resolution and newly eliminated final statements.
- [x] Town/Mafia victory, independent day-lynched Jester win, armed Vigilante morning-duel win.
- [ ] **Missing:** Sheriff submit, read result, then explicit confirm-or-timeout flow. The timed hold is not a two-step confirmation.
- [ ] **Verification Pending:** complete-game protection, ammunition, ties, late actions, final statements, and independent-victory integration tests.

## M3: GM, Observation, and Lifecycle

- [x] Full-workspace GM board: roles, counts, controls, event summaries, pending players, separate chat previews.
- [x] Read-only GM-style dead-player overview and server-side action/chat permissions.
- [x] GM public reveal, morning elimination, living-role reshuffle without revival, and void controls.
- [x] Animated win/loss/void outcomes, winning faction/identity, void reason.
- [x] Automatic lobby return, retaining remaining seats and timer configuration.
- [x] Interaction heartbeat and alive-player inactivity: twice the longest phase, minimum 30 seconds.
- [x] Live-player sign-out/removal/inactivity voids active games without scores; departed seat removed on lobby return.
- [x] Basic account-based seat recovery and connection-loss/restoration feedback.
- [ ] **Partial:** inactivity is per seat, not per independent device/browser/session. Dead observers do not void a round by becoming idle.
- [ ] **Partial:** outcome duration reuses inactivity timeout; no independent GM-configurable outcome duration.
- [ ] **Verification Pending:** multi-session reconnect races, rejoining, score idempotency, unattended lobby-return integration tests.

## M4: Noir UI, Theme, and Usability

- [x] Shared palette, typography, surfaces, focus indicators, spacing, role accents, motion rules.
- [x] Locally bundled Lucide controls, original card-back/Joker artwork, reusable role-card treatments.
- [x] Theme account/profile, lobby, dealing, gameplay, GM/observer, outcome scenes.
- [x] Desktop private-role/action/chat regions; full workspace GM/observer layout.
- [x] Portrait status tray, table/chat switching, readable targets, touch-sized primary controls.
- [x] Consistent forms, timers, steppers, status messages, disabled states, native confirmation dialogs.
- [x] Stable polling for panels, targets, timers, rosters, drafts, focus, and scroll.
- [x] Destructive GM/account/seat confirmations; reconnect feedback; inactivity warning and Stay in game.
- [x] Stable dealing/outcome entrances, neutral hidden-role state, private role flair, reduced-motion support.
- [x] Keyboard role cards/dialogs, focus rings, labelled chats, live status messages.
- [ ] **Verification Pending:** complete screen-reader/contrast audit, every icon/error label, physical touchscreen acceptance.
- [ ] **Partial:** loading/server errors use status messages; per-operation busy indicators remain.
- [ ] **Missing:** anchored help menus/tooltips where needed. Use native controls first; bundle Floating UI only when an actual positioning need is introduced.
- [ ] **Verification Pending:** physical-phone/laptop tests, representative 6-10-player and large-table sessions, final visual sign-off.

## M5: Privacy, Quality, and Release

- [x] Authenticated player ownership, role/phase-gated payloads, dead-player action restrictions implemented.
- [x] Initial JUnit tests: majority, ties, abstentions, winner decisions, optional-role ordering.
- [x] Browser regression suite: responsive scenes, peeking, polling, dialogs, observation, outcomes, inactivity warning, reduced motion.
- [x] GM runbook, asset licences, CI static/Java checks, release checklist.
- [ ] **Partial:** validation exists; bounded request bodies, duplicate-name policy, abuse/rate controls remain.
- [ ] **Verification Pending:** complete API privacy/authorization matrix, including deliberate reveals and observer visibility.
- [ ] **Missing:** full-game API tests and role-assignment/night-resolution/timer/lifecycle integration coverage.
- [ ] **Missing:** documented standalone distribution with runtime dependencies.
- [ ] **Verification Pending:** clean Java 17 host, real LAN devices, optional HTTPS remote test, accepted limitations, release-blocker closure.

## Evidence and Delivery

- Original conflicts preserved; modern committed functionality retained. No gameplay-rule changes in this theme pass. Static SVG delivery adds a MIME type only.
- Java rule suite: 11 tests passed using installed JDK/Maven in this pass.
- Browser tests use deterministic API fixtures, not complete backend or real-LAN integration. See `docs/UI_VALIDATION.md` for results and limits.
- Assets are local; no CDN or font service required.
- PR27 contains lifecycle prerequisites. The Noir UI PR is stacked on that branch to avoid duplicating its changes. Merging remains manual.

## Recommended Next Order

1. Review the theme; merge lifecycle prerequisite before the UI follow-up.
2. Implement Sheriff confirmation, per-game history, and session-level reconnect/inactivity as separate functional PRs.
3. Add API/rules integration tests and request hardening.
4. Complete accessibility and physical-device acceptance; fix recorded defects.
5. Package and verify Java 17 LAN release; validate secure remote access separately.

Managed matchmaking, cloud identity/rankings, native mobile, active-game database recovery, and simultaneous tables remain outside LAN v1.

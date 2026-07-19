# Mafia 2.0 — Product Plan

**Document status:** Draft 1

**Product stage:** Playable LAN prototype; not release-ready
**Source of truth for progress:** The checked status in this document reflects the implementation present on the current branch. A check means implemented, not necessarily fully acceptance-tested with a group of players.

## 1. Product Intent

Mafia 2.0 is a browser-based, local-network social-deduction game. One person runs a lightweight Java host and acts as the Game Master (GM); participants join from phones or browsers on the same LAN. The application should remove the GM's repetitive bookkeeping while preserving the in-person social experience.

### Primary goals

1. **Fast table setup.** A GM can open the host, share a LAN address, configure a balanced role pool, and start a named room with lightweight local accounts.
2. **Private, trustworthy play.** Players see only information their role and current phase permit; the server, not the browser, validates game actions and resolves outcomes.
3. **Smooth game flow.** Timed night, morning, discussion, and voting phases keep an in-person game moving with minimal GM administration.
4. **Mobile-first accessibility.** The same browser UI works for a GM laptop and player phones.
5. **Repeatable LAN sessions.** A finished game can be reset and replayed without persistent infrastructure.

### Product principles and boundaries

- The game remains **LAN-hosted first**, but the next product layer now includes a persistent local account database, named rooms, local admin control, profile settings, and scores.
- The GM remains an in-person facilitator, while the app owns role secrecy, legal actions, timers, vote resolution, and public outcomes.
- The initial role set is Town, Mafia, Sheriff, Doctor, and Vigilante.
- Advanced role packs, matchmaking, and fully managed public hosting remain future work, not prerequisites for v1.

## 2. Definition of Done for v1

v1 is complete when a mixed group can run repeated LAN games end to end without relying on the GM to calculate votes, remember night-action constraints, or privately distribute role information.

The release gate is all of the following:

- A GM can configure and launch a valid game, and players can join using only a name.
- Every supported role can complete its legal action; illegal and late actions are rejected server-side.
- The server advances phases by timer, resolves night actions and day voting correctly, reveals eliminations, and declares a winner.
- Dead-player restrictions and private information boundaries work throughout a full game.
- The UI is usable on a phone and gives both GM and player enough state to continue without ambiguity.
- Automated checks cover the rules engine's important edge cases, and a multi-device LAN smoke test passes.
- Setup, hosting, and gameplay documentation are sufficient for a new GM to run a session.

## 2.1 Scene Model

Treat the browser experience like five Unity-style scenes:

1. **Account scene:** login, registration, profile management, scores, and admin user management.
2. **Lobby scene:** room joining/hosting, player roster, role mix, timers, and pre-game setup.
3. **Deal scene:** Night 0 card shuffle, private copied role card, reveal, hide, and confirm.
4. **Game scene:** timed role actions, table view, chat, GM phase helpers, and live action status.
5. **Outcome scene:** game over for win/loss or GM-voided rounds; voided games record no scores and can be reset back to the lobby scene.

## 3. Progress Dashboard

| Workstream | Status | Completion mark | Notes |
|---|---|---:|---|
| LAN host and browser delivery | **Implemented** | 100% | Java host binds on the LAN and serves the browser assets. |
| GM lobby and role configuration | **Implemented** | 100% | Name-only join, role-count editing, role-total validation, launch checks, and reset exist. |
| Private role assignment / Night 0 | **Implemented** | 100% | The server shuffles roles and each player receives their own role after launch. |
| Core phase engine | **Implemented** | 95% | Timed night and day phases run server-side with an independent host ticker; executable edge-case tests remain. |
| Supported role actions | **Implemented** | 90% | Mafia, Sheriff, Doctor, and Vigilante actions are implemented; end-to-end edge-case verification remains. |
| Day voting and victory | **Implemented** | 85% | Voting, public-tally setting, elimination, and win detection exist; vote-rule acceptance tests are still needed. |
| Chat and information controls | **Partially implemented** | 80% | Mafia chat is phase-gated; public player chat now has server send/visibility gates and a disabled/read-only UI, while broader payload privacy review remains. |
| Player/GM experience | **Partially implemented** | 97% | Functional responsive UI, portrait action tray, full-screen Night 0 deal scene, reusable peek/hide role card, clickable target cards with selection summaries, doctor warnings, sheriff result visuals, delayed Sheriff/Doctor result holds, GM/player phase guidance, pending-player GM helpers, a command-center GM scene, and GM observability exist; accessibility and broader polish remain. |
| Test automation / quality gate | **In progress** | 25% | Static checks exist and executable JUnit coverage now covers vote majority, ties, abstentions, plurality helpers, win-condition decisions, and night-role phase ordering; broader role, night-resolution, authorization, and API smoke tests remain. |
| Release operations and documentation | **In progress** | 65% | Java launch instructions, GM runbook, CI workflow, and release checklist exist; packaging and clean-environment verification remain. |
| Local accounts, rooms, profiles, and admin | **In progress** | 70% | Local account registry, password hashing, seeded admin, named rooms, active-room hosting, profiles, and admin editing exist; fully independent simultaneous multi-room game state and public hosting hardening remain. |

## 4. Milestones and Goalposts

### M0 — Product foundation: complete

- [x] A Java 17 LAN host starts on port 3000 by default and prints local/LAN URLs.
- [x] Browser assets are served by the Java host.
- [x] The application supports a GM view and player view.
- [x] Players join a lobby by name, with basic name validation.
- [x] The GM can reset the in-memory session.

**Exit mark reached:** A group on one network can open the product and form a lobby.

### M1 — Game setup and secrecy: complete

- [x] GM configures counts for Mafia, Sheriff, Doctor, Vigilante, Town, and Vigilante shots.
- [x] Launch rejects invalid counts, role/player mismatches, and the current minimum testing composition.
- [x] Roles are shuffled and assigned by the server.
- [x] A player receives their own role, while the GM can inspect the full role table.
- [x] Night 0 gives players a private role-reveal state before gameplay begins.

**Exit mark reached:** The app can replace manual role-card distribution for the supported roles.

### M2 — Core playable round: substantially complete

- [x] Server-owned timers advance Night 0, Mafia, Sheriff, Doctor, Vigilante, morning, discussion, and day-vote phases.
- [x] A host-side phase ticker advances timed phases even when no player action is submitted.
- [x] Mafia can use a private, phase-limited chat and submit one kill vote each.
- [x] Sheriff can investigate one alive player and receive a private alignment result.
- [x] Doctor can protect an alive player, including themself, but not the same target on consecutive nights.
- [x] Vigilante can skip or shoot an alive non-self target while shots remain.
- [x] Night resolution applies protection before mafia and vigilante attacks, allowing simultaneous deaths.
- [x] Day voting supports target selection or abstention, resolution, role reveal, and a configurable public vote log.
- [x] Win checks declare Town when no Mafia remain and Mafia when alive Mafia are at least the alive non-Mafia count.
- [x] Add the specified `FINAL_STATEMENTS` state or explicitly remove it from the game specification.
- [ ] Verify all role, tie, abstention, protection, and timer edge cases against executable tests.
  - [x] Add executable vote-helper tests for strict majority, ties, abstentions, and unique plurality behavior.
  - [x] Add executable win-condition tests for Town elimination, Mafia parity, and unresolved games.
  - [x] Add executable phase-order tests for skipped optional night roles.

**Exit mark:** A facilitator can run one complete round without manual calculation.
**Remaining to close:** Add executable rule-engine tests for the final-statements, vote, role, protection, timer, and abstention paths.

### M3 — Rules parity, privacy, and resilience: next priority

- [x] Restrict general player chat to the intended phases and block dead players, matching the documented permission matrix.
- [ ] Confirm all player-state payloads expose only role-authorized information in every phase.
- [ ] Decide and document the final day-vote rule: strict majority (as specified) versus current plurality behavior; then enforce and test it consistently.
- [x] Define early-lock behavior for mafia and day votes, or remove it from the specification.
- [x] Add a clear reconnect/session-recovery policy; preserve a player's identity across accidental refreshes where feasible.
- [ ] Add input limits, duplicate-name policy, error messages, and basic abuse/rate protections appropriate for a LAN host.

**Exit mark:** The implemented behavior matches the written rules, and a player cannot accidentally or intentionally bypass core information/action boundaries through the UI or API.

### M4 — Playtest-ready experience

- [x] Add a concise GM runbook: host setup, LAN sharing, role balancing, phase controls, reset, and troubleshooting.
- [x] Replace dropdown action targeting with clickable alive-player target cards and explicit submit buttons.
- [x] Add doctor repeat-protection warnings before submit.
- [x] Show sheriff investigation results as a visual alignment card.
- [x] Make Sheriff and Doctor committed actions advance to the next phase immediately.
- [x] Add a portrait/mobile action tray with phase, timer, alive count, and selected target.
- [x] Add a GM void-game control that sends the table to a no-score game-over state, plus a return-to-lobby path that keeps seated players.
- [x] Add player-facing guidance for joining, role reveal, action confirmation, waiting states, death, final statements, and game over.
- [x] Add GM-facing phase guidance for setup, night roles, morning, final statements, discussion, voting, and game over.
- [x] Replace the raw GM live-state JSON view with status cards, separated chat previews, action summaries, and active-round controls.
- [x] Add GM current-action pending player chips for night roles, final statements, and day voting.
- [x] Add a full-screen Night 0 deal scene with one card per seated player, role symbols, a clickable player card reveal, a copied private role card, and separate landscape/portrait layouts.
- [x] Hold Sheriff and Doctor phases briefly after submit so the player and GM can see the committed result before auto-advance.
- [x] Preserve GM timer edits while the polling loop runs, then apply saved timers to subsequent phases.
- [x] Restyle active GM view as a command-center scene with a table-stage player grid, left GM controls, right event log, and GM-excluded display counts.
- [x] Add manager-only lobby seat removal so the GM can keep themselves or mistaken players out of the seated player list before launch.
- [ ] Improve small-screen usability, keyboard support, semantic labels, color contrast, and non-color status cues.
- [x] Surface clear GM-facing phase guidance, action completion counts, outcomes, and winner summary.
- [ ] Conduct structured multi-device playtests (minimum 3 players and a representative 6–10 player game) and record defects.

**Exit mark:** A new GM can host a game with a new group using only the documentation and UI.

### M5 — v1 release readiness

- [ ] Create automated unit tests for role assignment, phase transitions, night resolution, vote resolution, win conditions, and authorization.
  - [x] Add the first JUnit rule tests for vote resolution helpers, win-condition decisions, and night-role phase ordering.
- [ ] Add API/integration smoke tests for a complete short game.
- [ ] Add a documented build/package command.
- [x] Add a release checklist with clean-host, LAN, secure-public, data/privacy, and known-limitations gates.
- [ ] Test the packaged host on a clean Java 17 environment and multiple phone browsers on a LAN.
- [ ] Fix all release-blocking issues found in playtests; publish known limitations.

**Exit mark:** v1's definition of done is satisfied and the project can be handed to a GM for independent use.

## 5. Proposed Execution Order for Goal Mode

This order minimizes rework: lock the rules before polishing the interface, then prove the result with automated and real-device testing.

1. **Rules audit and alignment.** Reconcile the current Java engine with `SPEC_V1.md`, especially final statements, day-vote majority, early lock, and chat/dead-player permissions.
2. **Server-side hardening.** Implement missing restrictions and explicit transition behavior; keep the server authoritative.
3. **Automated rules tests.** Extract or exercise game-state logic to cover the critical cases listed in M5.
4. **Player and GM UX completion.** Add the UI states and guidance needed for the finalized flow; validate mobile behavior.
5. **Documentation and playtests.** Write the runbook, test real LAN sessions, prioritize defects, and repeat until release criteria pass.
6. **Release verification.** Run the build, automated suite, API smoke test, and clean-environment LAN test; then publish the release checklist and known limitations.

## 6. Essential UI Usability Backlog

These are the next high-value UI features after the PR22 pass:

- **Action lock clarity:** every night role and day vote should show a clear committed state, the selected target, and the next phase once the server accepts the action.
- **GM nudge controls:** the GM console now identifies exactly who is pending for the current phase; next pass can add table-safe reminder copy or controls.
- **Mobile action tray:** portrait mode now surfaces phase, timer, alive count, and selected target above the play layout; next pass can add one-tap scroll/focus shortcuts.
- **Reconnect banner:** returning players should see whether they recovered their seat, joined as a new seat, or need GM help.
- **Post-game recap:** game over should show winner, eliminations, final vote/action summary, and score changes per player.
- **Accessibility pass:** every icon-only affordance should have keyboard focus, labels, and non-color status cues.

## 7. Explicit Non-Goals for v1

- Internet matchmaking, public rooms, or remote hosting.
- Cloud accounts, global rankings, or managed matchmaking.
- Database-backed recovery or analytics.
- Custom/third-party role packs beyond the initial five roles.
- In-app GM override or moderation workflow; the GM resolves social disputes in person.
- Native mobile applications.

## 8. Status Update Protocol

During implementation, update this plan only when evidence changes:

- Mark an item complete only after implementation and the relevant check have passed.
- For partially complete items, add the remaining acceptance criterion rather than marking them done.
- Record material scope decisions (for example, removing final statements) in the relevant milestone and update `SPEC_V1.md` in the same change.
- Treat M3 privacy/rules parity and M5 test automation as release blockers even if the prototype appears playable.

# Mafia 2.0 Browser Port — Spec v1 (Sections 1–2)

This document captures only the first two implementation sections requested:

1. Phase state machine
2. Per-role permission matrix by phase

> Note: GM override controls are intentionally **out of scope** for the app. The GM can still arbitrate in person, but no in-app override workflow is specified in this version.

---

## 1) Phase State Machine

### 1.1 Core State Nodes

- `LOBBY`
- `NIGHT_MAFIA`
- `NIGHT_SHERIFF`
- `NIGHT_DOCTOR`
- `NIGHT_VIGILANTE`
- `NIGHT_RESOLUTION`
- `MORNING_ANNOUNCEMENT`
- `FINAL_STATEMENTS` (only if there are eliminations)
- `DAY_DISCUSSION`
- `DAY_VOTING`
- `DAY_VOTE_RESOLUTION`
- `GAME_OVER`

### 1.2 State Transitions

```text
LOBBY
  -> NIGHT_MAFIA

NIGHT_MAFIA
  -> NIGHT_SHERIFF (on timer end or all mafia votes locked)

NIGHT_SHERIFF
  -> NIGHT_DOCTOR (on submit or timeout -> auto-abstain)

NIGHT_DOCTOR
  -> NIGHT_VIGILANTE (on submit or timeout -> auto-abstain)

NIGHT_VIGILANTE
  -> NIGHT_RESOLUTION (on submit or timeout -> auto-abstain)

NIGHT_RESOLUTION
  -> MORNING_ANNOUNCEMENT

MORNING_ANNOUNCEMENT
  -> FINAL_STATEMENTS (if >=1 death)
  -> DAY_DISCUSSION (if 0 deaths)

FINAL_STATEMENTS
  -> DAY_DISCUSSION (after all eligible statements or timeout)

DAY_DISCUSSION
  -> DAY_VOTING (timer end or manual close by phase flow)

DAY_VOTING
  -> DAY_VOTE_RESOLUTION (timer end or majority already reached and locked)

DAY_VOTE_RESOLUTION
  -> GAME_OVER (if win condition met)
  -> NIGHT_MAFIA (otherwise)
```

### 1.3 Entry/Exit Rules Per State

#### `LOBBY`
- Entry: game created, players connected.
- Exit requirement: role assignment complete and game started.

#### `NIGHT_MAFIA`
- Active players: alive mafia only.
- Inputs:
  - Mafia chat (enabled only in this state).
  - Mafia kill vote (one vote per alive mafia).
- Resolution rule:
  - Majority among alive mafia required.
  - Tie or no majority => no mafia kill.

#### `NIGHT_SHERIFF`
- Active player: alive sheriff (if role exists and alive).
- Inputs: select one alive target.
- Timeout: auto-abstain.
- Output stored: alignment result queued privately for sheriff client.

#### `NIGHT_DOCTOR`
- Active player: alive doctor (if role exists and alive).
- Inputs: select one alive target (self allowed).
- Constraint: cannot target same player as previous night.
- Timeout: auto-abstain.

#### `NIGHT_VIGILANTE`
- Active player: alive vigilante (if role exists and alive).
- Inputs: optional shot target.
- Constraints:
  - self-target not allowed.
  - requires remaining ammo.
- Timeout: auto-abstain.

#### `NIGHT_RESOLUTION`
- No player input.
- Engine applies deterministic ordering:
  1. Load doctor protection target (if any)
  2. Resolve mafia kill intent
  3. Resolve vigilante shot intent
- Multiple simultaneous deaths are allowed.
- If two attacks hit same unprotected target, target dies once.

#### `MORNING_ANNOUNCEMENT`
- Publicly announce all deaths from the resolved night (or no deaths).
- Eliminated players reveal role and become dead/non-participating.
- Win check executes at morning boundary:
  - Town win if all mafia dead.
  - Mafia win if mafia count >= town count at start of morning.

#### `FINAL_STATEMENTS`
- Enabled (per current rules).
- Each newly eliminated player gets one short final statement window.
- No ongoing gameplay actions allowed.

#### `DAY_DISCUSSION`
- Alive players discuss; no votes finalized here.
- Timer-based phase.

#### `DAY_VOTING`
- Alive players submit one elimination vote each or abstain (if enabled by host settings).
- Majority required: `floor(alive_count / 2) + 1`.
- Early lock allowed if majority mathematically reached and cannot be overturned.

#### `DAY_VOTE_RESOLUTION`
- If majority reached: eliminate target and reveal role.
- If no majority: no elimination.
- Run win-condition check.

#### `GAME_OVER`
- Freeze gameplay input.
- Show winner and final role table.

### 1.4 Global Rules (State-Independent)

- Dead players cannot chat, vote, or act.
- Unauthorized communication channels are disabled in-app.
- All timers are authoritative server-side.
- Night non-response behavior:
  - Sheriff/Doctor/Vigilante auto-abstain on timeout.

---

## 2) Per-Role Permission Matrix by Phase

Legend:
- ✅ Allowed
- ❌ Not allowed
- ⚠️ Allowed with constraints
- — Not applicable

### 2.1 Player Permissions

| Phase | Town | Mafia (alive) | Sheriff | Doctor | Vigilante | Dead Player |
|---|---:|---:|---:|---:|---:|---:|
| LOBBY | ✅ Join/ready | ✅ Join/ready | ✅ Join/ready | ✅ Join/ready | ✅ Join/ready | — |
| NIGHT_MAFIA: mafia chat | ❌ | ✅ (mafia only) | ❌ | ❌ | ❌ | ❌ |
| NIGHT_MAFIA: mafia kill vote | ❌ | ✅ (1 vote) | ❌ | ❌ | ❌ | ❌ |
| NIGHT_SHERIFF: investigate | ❌ | ❌ | ⚠️ (1 alive target) | ❌ | ❌ | ❌ |
| NIGHT_DOCTOR: protect | ❌ | ❌ | ❌ | ⚠️ (1 alive target, self OK, no consecutive same target) | ❌ | ❌ |
| NIGHT_VIGILANTE: shoot | ❌ | ❌ | ❌ | ❌ | ⚠️ (optional; ammo required; no self-target) | ❌ |
| MORNING_ANNOUNCEMENT | ✅ View | ✅ View | ✅ View | ✅ View | ✅ View | ✅ View only |
| FINAL_STATEMENTS | ❌ | ❌ | ❌ | ❌ | ❌ | ⚠️ Only newly eliminated can speak |
| DAY_DISCUSSION | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| DAY_VOTING | ✅ (1 vote) | ✅ (1 vote) | ✅ (1 vote) | ✅ (1 vote) | ✅ (1 vote) | ❌ |
| DAY_VOTE_RESOLUTION | ✅ View | ✅ View | ✅ View | ✅ View | ✅ View | ✅ View only |
| GAME_OVER | ✅ View | ✅ View | ✅ View | ✅ View | ✅ View | ✅ View |

### 2.2 Visibility Rules by Role

| Data | Town | Mafia | Sheriff | Doctor | Vigilante | Dead |
|---|---:|---:|---:|---:|---:|---:|
| Own role | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Other players' roles (alive) | ❌ | ❌ (except mafia identities) | ❌ | ❌ | ❌ | ❌ |
| Mafia teammate identities | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Sheriff investigation result | ❌ | ❌ | ✅ (self only) | ❌ | ❌ | ❌ |
| Doctor chosen target history | ❌ | ❌ | ❌ | ✅ (self only, needed for no-repeat rule) | ❌ | ❌ |
| Vigilante ammo count | ❌ | ❌ | ❌ | ❌ | ✅ (self only) | ❌ |
| Live day vote tally | Host-configurable | Host-configurable | Host-configurable | Host-configurable | Host-configurable | ❌ |
| Night action submissions | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

### 2.3 Validation Rules (Enforced Server-Side)

1. Reject actions from dead players.
2. Reject actions outside the active phase.
3. Enforce vigilante no-self-target.
4. Enforce doctor no-consecutive-target (including self).
5. Ignore late submissions after timer lock.
6. Convert missing Sheriff/Doctor/Vigilante actions at timeout to abstain.
7. Day elimination requires strict majority: `floor(alive/2)+1`.
8. Night mafia kill requires majority among alive mafia voters.

---

## Non-Goals in this Version

- No in-app GM override workflow.
- No custom role expansion logic in this section.
- No persistence/DB schema in this section.

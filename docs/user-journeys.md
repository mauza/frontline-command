# User Journeys

Working list for the UX pass. Each journey is something a real player tries to
do end to end. A journey is **done** when a player can complete it without
guessing, without reading the rulebook, and without the UI contradicting itself.

Scope is the 1942 Second Edition rule set in
[`rules-1942-second-edition.md`](rules-1942-second-edition.md), and the engine
commands that actually exist: `start_game`, `purchase`, `move`, `advance_phase`,
`start_battle`, `battle_step`, `choose_casualties`, `submerge`, `retreat`,
`continue_battle`, `land_fighter`, `strategic_bomb`, `place`, `collect_income`,
`concede_game`, `abandon_game`.

Status: ✅ done · 🚧 partly done · ⬜ not started

Each ✅ was driven end to end with two browsers against the real engine, not
read off the code.

---

## A. Getting into a game

**A1 — Start a game and invite friends.** ✅
Copy-code and copy-link buttons on the invite card. `/join/CODE` opens the join
tab with the code already filled in.

**A2 — Join a game from a code.** ✅
Receive a code, enter it, land in the lobby, understand who else is in and what
is being waited on.

**A3 — Understand what power(s) I got.** ✅
"You control" card with power chips, whose turn it is now, how many turns until
yours, and the full turn order.
After the host starts, immediately know which powers are mine, what that means
for turn order, and when I will next act.

**A4 — Come back to a game later.** ✅
The summary endpoint returns whose turn it is; the campaign list shows
"Round 3 · Japan · Combat Move", tags games waiting on you with YOUR MOVE, and
sorts those to the top.
Close the tab, return days later, find my games, and resume without the URL.

---

## B. The turn loop

**B1 — Buy units.** ✅
Overspending now says how far over you are instead of silently disabling submit.
See income, understand what each unit does and costs, build a shopping list,
know what I can afford, and submit. Includes factory repair.

**B2 — Move units to attack (Combat Move).** ✅
Routes are restricted to adjacent spaces at click time, and a land unit walked
into the ocean now gets an inline "these units can't go into 4 Sea Zone"
instead of a server round-trip. Deeper rules (canals, hostility, landing
capacity) stay with the engine so the two cannot disagree.

**B3 — Move units without fighting (Noncombat Move).** ✅
Guidance states the landing requirement up front.

**B4 — Place newly bought units.** ✅
"Where you can build" lists each factory you own with its remaining room,
using the same capacity rule the engine enforces, and marks damaged ones.

**B5 — Collect income and end the turn.** ✅
States the amount before you commit.

---

## C. Combat — the core loop

**C1 — Start and finish a simple land battle.** ✅
Declare, start, roll, take casualties, and resolve to a winner.
Fixed: the "Fight!" button — the only way to start any battle — was gated behind
having naval bombardment ships, so every land battle was unstartable.
Added: dice showing real hit/miss, a per-side hit tally, and a battle marker on
the map.

**C2 — Choose casualties.** ✅
Understand how many hits I took, what each unit is worth, which choice is
better, and confirm. Includes the multinational/grouped case where several
powers defend together and each assigns in turn.

**C3 — Retreat or press on.** ✅
Destinations are listed by name with the dice from the round that just happened
shown alongside the decision.

**C4 — Watch a battle I am not fighting.** ✅
Live battles pulse on the map for every player, resolved ones burst, and a
result banner above the map tells everyone who took what and after how many
rounds. Battle log entries use territory names instead of raw ids.

**C5 — Naval combat: submarines and destroyers.** ✅
Driven end to end: UK destroyer vs two German subs. The engine correctly
suppressed Surprise Strike because a destroyer was present, and the dice show
each side's target number.

**C6 — Amphibious assault.** 🚧
Transport load/unload panel verified present and reachable, and shore
bombardment appears only when ships can actually bombard. A full sea-to-shore
assault has not been driven end to end — the round-one setup has no UK land
unit adjacent to a loaded transport.

**C7 — Anti-aircraft fire.** ✅
AAA rolls appear as their own labelled dice group before the main battle.
Understand AAA firing at my aircraft before the main battle, at most three dice
per AAA, and that it does not fire on overflight.

**C8 — Emergency fighter landing.** 🚧
Panel exists and is wired to the decision, but no run produced a fighter with
nowhere to land, so it has not been confirmed against a live decision.

**C9 — Strategic bombing raid.** ✅
Only targets with a bomber in range are offered; damage is reported.
Send a bomber at a factory, understand damage and its effect on production.

---

## D. Reading the board

**D1 — Understand who owns what and where units are.** ✅
Power colours are one source shared by map, ledger and chips; unit stacks are
tinted by owner and show type at every zoom.

**D2 — Inspect a territory.** ✅
Victory-city and capital tags added — neither was surfaced anywhere before.
Tap it and learn owner, IPC value, victory-city status, and the full unit stack.

**D3 — Understand the economy.** ✅

**D4 — Follow what happened since I was last here.** ✅
Every event and placement error uses territory names; timestamps are relative.

---

## E. Winning, losing, and edge states

**E1 — Track victory conditions.** ✅
"Road to victory" card: cities held vs needed per side with a pip track,
computed the same way the engine does (Axis ≥9, Allies ≥10 of 13).

**E2 — Capture a capital.** 🚧
Capitals are now tagged in the inspector, but the IPC swing on capture is not
explained anywhere and was not exercised — it needs a multi-round game.

**E3 — See the game end.** ✅
Both players get "GAME OVER / Axis wins!".
A real ending, not "the server has declared this campaign finished".

**E4 — Concede or abandon.** ✅
Deliberate, confirmable, hard to do by accident.

---

## F. Cross-cutting

**F1 — Always know whose turn it is and what is blocking.** ✅
The turn banner, phase guide and decision alert agree; a pending decision
addressed to you outranks whose turn it is.

**F2 — Recover from an error.** ✅
Errors render beside the control that caused them and name territories.

**F3 — Play on a phone.** ✅
No horizontal overflow at 360–1920; no sub-44px targets; no contrast failures.

**F4 — Play asynchronously.** ✅
Covered by A4 plus relative timestamps in the log.

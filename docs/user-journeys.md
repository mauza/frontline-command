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

Status: ✅ done · 🚧 in progress · ⬜ not started

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

**B2 — Move units to attack (Combat Move).** ⬜
Select units, plot a legal route, understand why an illegal move is illegal
*before* submitting, and see which territories I am about to attack.

**B3 — Move units without fighting (Noncombat Move).** ⬜
Reposition, and land every aircraft legally. Being told mid-phase that a plane
has nowhere to land is a failure.

**B4 — Place newly bought units.** ⬜
Understand factory capacity, which territories are legal, and where sea
placement is allowed.

**B5 — Collect income and end the turn.** ⬜
See what I earned and why, and hand off cleanly to the next player.

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

**C3 — Retreat or press on.** ⬜
After a round, understand my odds, see where I can retreat to, and know that
amphibious attackers cannot retreat.

**C4 — Watch a battle I am not fighting.** ✅
Live battles pulse on the map for every player, resolved ones burst, and a
result banner above the map tells everyone who took what and after how many
rounds. Battle log entries use territory names instead of raw ids.

**C5 — Naval combat: submarines and destroyers.** ⬜
Surprise Strike, submerging, and the destroyer's effect on all of it.

**C6 — Amphibious assault.** ⬜
Load a transport, move, offload into a hostile territory, optional shore
bombardment, and the no-retreat rule.

**C7 — Anti-aircraft fire.** ✅
AAA rolls appear as their own labelled dice group before the main battle.
Understand AAA firing at my aircraft before the main battle, at most three dice
per AAA, and that it does not fire on overflight.

**C8 — Emergency fighter landing.** ⬜
Resolve fighters with nowhere to land after a battle.

**C9 — Strategic bombing raid.** ✅
Only targets with a bomber in range are offered; damage is reported.
Send a bomber at a factory, understand damage and its effect on production.

---

## D. Reading the board

**D1 — Understand who owns what and where units are.** ⬜
At a glance, from the map alone.

**D2 — Inspect a territory.** ✅
Victory-city and capital tags added — neither was surfaced anywhere before.
Tap it and learn owner, IPC value, victory-city status, and the full unit stack.

**D3 — Understand the economy.** ⬜
Who is ahead, what each power earns, and how that changed.

**D4 — Follow what happened since I was last here.** ⬜
A log I can actually read, not raw event strings.

---

## E. Winning, losing, and edge states

**E1 — Track victory conditions.** ✅
"Road to victory" card: cities held vs needed per side with a pip track,
computed the same way the engine does (Axis ≥9, Allies ≥10 of 13).

**E2 — Capture a capital.** ⬜
Understand the IPC swing and what it means.

**E3 — See the game end.** ✅
Both players get "GAME OVER / Axis wins!".
A real ending, not "the server has declared this campaign finished".

**E4 — Concede or abandon.** ✅
Deliberate, confirmable, hard to do by accident.

---

## F. Cross-cutting

**F1 — Always know whose turn it is and what is blocking.** ⬜
Never contradict myself between panels.

**F2 — Recover from an error.** ⬜
Errors appear next to the control that caused them, in plain language.

**F3 — Play on a phone.** ⬜
Every journey above, at 390px.

**F4 — Play asynchronously.** ⬜
Come back after hours, understand what changed, know if it is my move.

# Production End-to-End Playtest

## Scope

- Site: `https://war.mau.guru`
- Format: two players, Allies versus Axis
- Allied player: autonomous subagent controlling Soviet Union, United Kingdom, and United States
- Axis player: autonomous subagent controlling Germany and Japan
- Operator: browser automation, rules clarification, defect triage, fixes, and deployment
- Goal: play from campaign creation through a server-declared victory

## Method

- Use separate persistent Chromium profiles for each player.
- Exercise the deployed UI for campaign, navigation, purchases, movement, combat decisions, placement, and lifecycle controls.
- Use authenticated production API state only to summarize the board for the player agents and to diagnose failures.
- Record confusion separately from confirmed defects.
- If a defect blocks progress, preserve evidence, fix and deploy it, then continue when state remains valid or restart when it does not.

## Timeline

### 2026-08-04

- Playtest requested.
- Confirmed system Chromium is available and installed `playwright-core` for automation.
- Started persistent Allied and Axis player-agent sessions. Both requested board state, legal actions, pending decisions, and clear commit/reversibility information each turn.
- Created `QA Full Campaign 2026-08-04` through the deployed UI in an isolated Allied browser profile.
- Joined through the deployed UI from a separate Axis browser profile using invite code `RQ1SVQ`.
- Started the two-player campaign through the host UI. Powers were assigned correctly: Allies received Soviet Union, United Kingdom, and United States; Axis received Germany and Japan.
- Browser console and page-error capture remained clean through create, join, start, and the Soviet purchase.
- Soviet R1 purchase was drafted and submitted through the UI: four infantry and three artillery for 24 IPC.
- Soviet combat routes were entered through the map UI for 21 units and produced battles in West Russia and Ukraine S.S.R.
- West Russia exercised battle start, repeated battle rounds, owner-authorized casualties in both browser profiles, and attacker continue/retreat decisions.
- Deployed the overkill casualty fix as `0.2.1`. Retried the unchanged persisted decision through the Axis UI; both final defenders were accepted and the campaign advanced from version 17 to 18.
- Deployed the mixed-naval-transport fix as `0.2.2`. The invalid first campaign was the only QA campaign deleted; pre-existing campaigns were preserved.
- Restarted with campaign ID `d0VaL1KwYp0X2nJn` and invite code `VMJBLA`. The corrected Sea Zone 7 battle destroyed both the UK battleship and its accompanying transport.
- Deployed the aircraft/submarine mutual non-targeting fix as `0.2.3`. The live round-74 battle recovered in place without restarting.
- Completed eight full rounds while exercising land and naval combat, AAA fire, surprise strikes, submerge and retreat decisions, carrier landings, amphibious assaults, transport loading, factory placement, strategic bombing, and victory-city capture.
- Japan captured India. The UK captured France and Germany retook it. Japan's first Honolulu invasion fleet was destroyed in Sea Zone 53.
- Germany attacked the combined Allied Sea Zone 8 fleet with five fighters and three bombers. The first volley created a seven-hit multinational casualty decision split between the UK and US.
- Deployed the grouped-casualty-control fix as `0.2.4`. The persisted decision resumed at version 823; Germany destroyed nine transports, two carriers, three destroyers, and two fighters while losing three fighters.
- Germany's three-bomber raid inflicted 11 damage on the London factory. The UK exercised partial factory repair and restored enough production to place two bombers.
- Japan staged a second loaded Honolulu invasion fleet. A US destroyer screen delayed it for one turn, after which the US counterattacked in Sea Zone 53.
- The three-round Sea Zone 53 battle exercised battleship damage, repeated casualty groups, transport-last enforcement, and aircraft-only victory. The US lost its attacking surface fleet and seven fighters; Japan lost two carriers, two battleships, four fighters, four destroyers, two loaded transports, and all invasion cargo. Two US fighters survived and landed on Honolulu.
- At version 926, both persistent players assessed the endgame. Axis had a credible three-turn Honolulu rebuild, while the Allied player judged that it could prolong the game but had no credible route to the Allied victory threshold and explicitly conceded.
- The application had no safe way to record that player decision. Deployed `0.2.5` with a version-checked concession command, an explicit two-step UI confirmation, a dedicated finished-state result, and a multiplayer guard requiring control of every power in the conceding alliance.
- Exercised concession through the deployed Allied browser profile. The server recorded event 928, `Allies conceded; Axis wins`, and advanced the campaign to version 927 with `status: finished` and `winner: Axis`.
- Reopened the result in the Axis browser profile. Both profiles displayed `Axis victory` with clean browser console and page-error capture.

## Confusion Log

- **Minor / movement route entry:** The Allied player initially supplied source and destination only for multi-space moves. After seeing that the UI requires every adjacent space, it asked whether intermediate paths were mandatory and then supplied `Russia -> Caucasus -> Ukraine` and `Karelia S.S.R. -> West Russia -> Ukraine`. The phase guide says to click adjacent spaces in order, but it does not explicitly contrast this with source/destination orders.
- **Minor / split casualties:** One volley can appear as multiple casualty prompts, such as `1 + 3`, without explaining the fire groups that caused the split.
- **Minor / aircraft retreat display:** Retreated aircraft remain visually in the hostile territory until their noncombat landing move.
- **Minor / aircraft landing rule:** The interface does not proactively explain that aircraft cannot land in territory captured during the same turn.
- **Minor / territory naming:** A player referred to `China`, while the catalog and command surface require `Anhwei`.
- **Minor / transport capacity:** The UK player expected three transports to evacuate seven units before the capacity validation clarified the six-unit limit.

## Defect Log

- **Blocking / combat casualty assignment / fixed in 0.2.1:** In West Russia round 3, the Soviets rolled three hits against Germany's final two units. The pending decision exposed `hits: 2`, `minHits: 3`, and two eligible units. The UI correctly showed `2 / 2 hits assigned` and enabled confirmation, but the server returned HTTP 422: `must assign between 3 and 2 hits`. Root cause: grouped casualty `MinHits` was calculated before overkill hits were capped to the current owner's casualty capacity. The fix caps both newly created decisions and validation of already-persisted decisions. The original live decision succeeded after deployment without restarting the campaign.
- **Blocking / mixed naval battle transports / confirmed:** Germany attacked UK battleship + transport in Sea Zone 7 with submarines and fighters. After the battleship sank, combat completed but the transport remained with `ignoredBy: Germany`. Germany never selected an ignore option. Root cause: combat-movement cleanup marked every enemy transport ignored whenever the zone contained any non-transport defender, removing the transport from battle forces. The current campaign board is invalid and will be restarted after the fix.
- **Blocking / aircraft-submarine stalemate / confirmed:** The restarted campaign verified that `0.2.2` correctly destroyed both the UK battleship and accompanying transport in Sea Zone 7. The UK counterattacked four submarines with a destroyer and aircraft. After the destroyer was lost, only aircraft and submarines remained. Neither force could legally target the other, but combat cycled through submerge, fire, and continue decisions through round 74 instead of ending. The resolver safety limit stopped at version 360. The fix detects mutual non-targeting, awards the defended space to the defender, preserves all surviving units, and runs before another persisted battle step so this campaign can recover.
- **Blocking / multinational casualty controls / fixed in 0.2.4:** A seven-hit Sea Zone 8 volley had to be allocated across UK and US defenders while combat units remained under both owners. The correct UK range was zero to seven hits, but the battle card duplicated the owner-specific control and demanded exactly seven, which forced selection of UK transports before queued US combat ships and produced HTTP 422: `defenseless transports must be chosen last`. Grouped decisions now use only the owner-specific ranged control, and decision text displays the allowed minimum and maximum. The live queue resumed with four UK combat casualties followed by three US combat casualties.
- **Lifecycle gap / concession / fixed in 0.2.5:** A player could determine that its alliance had no credible winning path, but the only terminal controls were victory-city capture or owner-only abandonment. Added authenticated alliance concession. A player must control every power in the conceding alliance, preventing one participant in a 3-5 player campaign from surrendering teammates' powers. Successful concession sets the engine winner and the persisted campaign status through the normal command transaction.

## Outcome

Completed at version 927 after ten full rounds and the opening of round 11. The Allied player conceded after determining it had no credible route to its victory threshold. The server declared Axis the winner, persisted the campaign as finished, and displayed the result correctly to both browser profiles.

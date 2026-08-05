# 1942 Second Edition Rules Baseline

## Controlling Sources

1. [Renegade 2023 rulebook](https://store-kftzvkkgjv.mybigcommerce.com/content/File%20Storage%20for%20site/Rulebooks/Axis%20Allies/A%26A%5F1942%5F2ndEd%5FRulebook%5FWEB.pdf)
2. [Renegade resources page](https://renegadegamestudios.com/axis-allies-resources)
3. [Current consolidated FAQ mirror](https://www.axisandallies.org/files/AA-1942-2nd-Edition-FAQ.pdf)
4. [Original Avalon Hill rulebook mirror](https://www.axisandallies.org/files/rules/Axis-Allies-1942-Second-Edition.pdf)
5. [Official tournament rules](https://store-kftzvkkgjv.mybigcommerce.com/content/File%20Storage%20for%20site/Rulebooks/Axis%20Allies/A%26A%5F1942%5FTournament%5FRules.pdf), used only for explicit clarifications unless tournament mode is selected
6. [Community setup-card transcription](https://www.axisandallies.org/resources-downloads/setup-chart-axis-allies-1942-second-edition/), because the publisher does not provide downloadable setup cards

The 2023 rulebook is authoritative because Renegade states that its reprint incorporates prior errata and FAQ corrections. Tournament setup changes and bidding are not default boxed rules.

## Core Identity

- Turn order: Soviet Union, Germany, United Kingdom, Japan, United States.
- Phases: Purchase Units, Combat Move, Conduct Combat, Noncombat Move, Mobilize New Units, Collect Income.
- Starting IPCs: 24, 41, 31, 30, 42.
- Victory is checked after the United States turn.
- Axis standard victory requires 9 victory cities. Allied standard victory requires 10.
- Total Victory, requiring all 13 cities, is optional.
- Core rules have no technology research.

## Rules That Must Not Leak In From Classic

- Neutral territories are impassable. There is no 3 IPC neutral violation.
- Transports have no combat value, are selected last, and carry one land unit plus one infantry.
- Destroyers govern submarine movement, submergence, Surprise Strike, and air targetability.
- Battleships require two hits in one combat and repair automatically afterward.
- AAA fires only against attacking aircraft in its territory, at most three dice per AAA, and does not fire on overflight.
- Industrial complexes have territory-based capacity and repairable strategic-bombing damage.
- Artillery supports attacking infantry one for one.
- Unit counts are not limited by the number of supplied plastic pieces.
- Victory uses victory cities, not Classic capital or economic victory conditions.

## Explicit Engine Decisions

- AAA has normal combat value 0. The detailed current rules override a contradictory defense value printed in one mobilization chart.
- The Black Sea is open by default. Turkish Straits closure is an optional scenario rule.
- Strategic-bombing fighter escorts and interceptors are optional.
- Honolulu is a victory city, as corrected by errata and included in the current rulebook.
- Seaborne amphibious attackers cannot retreat. Overland attackers and aircraft in the same land battle can retreat after a combat round.
- Tournament setup changes remain a separate future scenario and are never silently applied.

## Allied Transport And AAA Clarifications

- The 2023 rulebook's "Transporting Multinational Forces" sidebar (page 19) and transport characteristics (page 30) assign each step by power: land units load and later offload on their owner's turns, while the allied transport moves or remains stationary on its owner's turn.
- A transport may therefore carry allied cargo during its owner's turn, but that cargo remains aboard. On the cargo owner's later turn, those units may load onto or offload from the allied transport without moving the transport.
- The AAA limited-move rule (page 24) permits an AAA loaded on a prior turn to be carried during Combat Move. AAA may never attack, so it cannot offload into a hostile territory; a new AAA cannot load during Combat Move.

## Testing Standard

Rules should be implemented as deterministic state transitions with supplied dice. Every rule requires legal and illegal table tests, with dedicated interaction tests for submarines/destroyers, carriers/aircraft, transports/amphibious assaults, AAA, factory damage, liberation, and victory timing.

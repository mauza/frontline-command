# 1942 Second Edition Board

## Edition Fingerprint

The target board is Axis & Allies 1942 Second Edition, originally released in 2012 and reprinted by Renegade. It is not Classic Second Edition, Spring 1942 First Edition, Revised, Anniversary, 1940, or the 1942 Online ranked ruleset.

- Physical size: 40 by 26 inches, two 20 by 26 panels.
- Digital working canvas: 3500 by 2000 units.
- Spaces: 161 total.
- Land spaces: 96, including neutral and impassable areas.
- Water spaces: 65, numbered 1 through 65.
- Adjacency edges: 403 in the principal public cross-check dataset.
- The map wraps east to west, not north to south.
- Starting industrial complexes include Karelia S.S.R. and India.

## Verification Sources

- [Current rulebook](https://store-kftzvkkgjv.mybigcommerce.com/content/File%20Storage%20for%20site/Rulebooks/Axis%20Allies/A%26A%5F1942%5F2ndEd%5FRulebook%5FWEB.pdf)
- [Setup chart transcription](https://www.axisandallies.org/resources-downloads/setup-chart-axis-allies-1942-second-edition/)
- [Contemporary board preview](https://www.axisandallies.org/p/axis-allies-1942-second-edition-preview-map-and-setup/)
- [TripleA 1942 Second Edition package](https://github.com/triplea-maps/world_war_ii_v5_1942), pinned for research to commit `965147e7d29b31f2514b1d0e3abb39b44ef2e3e6`
- TripleA standard scenario filename: `map/games/WW2v5_1942_2nd.xml`
- TripleA tournament scenario filename: `map/games/WW2v5_1942_2nd_TR.xml`; this is not the default setup

The TripleA map repository has no explicit license. No map artwork, tiles, relief textures, logos, fonts, or unit images are included. Territory outlines are transformed from the pinned package as factual geometry, lightly simplified, and rendered with original presentation artwork.

After checking out the pinned commit, regenerate the catalog with:

```sh
go run ./tools/generate-board /path/to/map/centers.txt /path/to/map/polygons.txt /path/to/map/games/WW2v5_1942_2nd.xml internal/board/catalog.json
```

## Independent Board Implementation

The current board uses an independently rendered layered SVG:

1. Original ocean and terrain treatment.
2. Interactive territory and sea-zone polygons generated from factual outlines.
3. Ownership overlays driven by server state.
4. Territory names, IPC values, victory cities, and sea-zone numbers.
5. Original initial-deployment count badges.
6. Selection, reachable-space, battle, and movement-route layers.

The Go board package owns stable territory IDs, all 403 adjacency edges, production, original ownership, victory cities, and starting setup. The client contains only original display artwork. Legal adjacency is never inferred from visual shapes.

## Interaction Requirements

- Wheel, button, pinch, and double-tap zoom.
- Drag pan and fit-to-board.
- Zoom-dependent labels and unit detail.
- Enlarged invisible hit regions for islands.
- Origin selection and legal-destination highlighting.
- Thin route previews, pending-move list, confirmation, and undo.
- Persistent desktop command panel and mobile bottom sheet.
- Colorblind ownership palettes and a non-map territory list.

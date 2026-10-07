# Game-series emblems

These transparent SVGs are manually constructed from the approved [second concept](../../../docs/design/game-selector-identity-v2.png). They are custom series identifiers inspired by the cover Pokémon, not official game wordmarks or repackaged character sprites.

All assets use a 64 × 64 viewBox and flat fills. Each series has two variants:

- `*-compact.svg`: simplified contours for the 16px toolbar slot.
- `*.svg`: additional silhouette details for the 24px game menu and collapsed sidebar.

FRLG combines Charizard's head and wing with Venusaur's flower crown. BDSP combines Dialga's crest with Palkia's rounded armor. SWSH combines the two wolf profiles with the sword and shield mane. Colors, center details and negative space were simplified for dark UI rendering; no generated preview bitmap is loaded by the application.

The `GameEmblem` component selects and bundles the appropriate local asset. The surrounding game button retains its accessible label; the emblem itself is decorative.

FRLG target sprites are copied from `frlg-auto-rng/assets/sprites` at the commit in `manifest.json`. Only supported static and wild species are included, in both normal and shiny colors. They are bundled with the application and do not require that repository or a network connection at runtime.

The reference project's resource pipeline uses the Pokémon FireRed graphics and palettes from `pret/pokefirered/graphics/pokemon`. Pokémon graphics remain the property of their respective rights holders. This directory is independent of the BDSP module's assets.

Unown uses the A sprite as its species icon; this icon does not assert an encounter's letter form.

To refresh from an audited reference checkout, run `tools/generate-frlg-wild-data.py --sprites-from <reference>/assets/sprites`; the importer also records SHA-256 hashes. Normal metadata generation needs only the bundled planner snapshot.

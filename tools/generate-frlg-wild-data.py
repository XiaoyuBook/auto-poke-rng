"""Generate compact renderer metadata from the bundled FRLG encounter table."""

from __future__ import annotations

import ast
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PLANNER = ROOT / "runtime" / "python" / "frlg_planner"
SOURCE = PLANNER / "rng" / "tenlines_utils.py"
ENCOUNTERS = PLANNER / "rng" / "resources" / "EncounterTables" / "Gen3" / "frlg" / "wild_encounters.json"
GAME_TEXT = PLANNER / "assets" / "game_text.json"
OUTPUT = ROOT / "src" / "frlgWildData.ts"
CATEGORIES = ("Grass", "Surfing", "OldRod", "GoodRod", "SuperRod", "RockSmash")


def load_location_map() -> dict[str, str]:
    text = SOURCE.read_text(encoding="utf-8")
    marker = "FRLG_MAP_TO_LOCATION = "
    start = text.index(marker) + len(marker)
    mapping_text = text[start:].split("\n}\n", 1)[0] + "\n}"
    return ast.literal_eval(mapping_text)


def main() -> None:
    locations = load_location_map()
    game_text = json.loads(GAME_TEXT.read_text(encoding="utf-8"))
    encounters = json.loads(ENCOUNTERS.read_text(encoding="utf-8"))
    species_names = list(game_text["species_en_to_zh"])
    species = {}
    location_labels = {}
    result = {family: {category: {} for category in CATEGORIES} for family in ("fr", "lg")}

    for entry in encounters:
        family = "fr" if "FireRed" in entry["base_label"] else "lg"
        location = locations[entry["map"]]
        location_labels[location] = game_text["location_en_to_zh"].get(location, location)

        def add(category: str, slots: list[dict], mask: bool = False) -> None:
            if not slots:
                return
            values = result[family][category].setdefault(location, set())
            for slot in slots:
                species_id = int(slot["species"]) & 0x7FF if mask else int(slot["species"])
                if not 1 <= species_id <= 386:
                    continue
                values.add(species_id)
                name = species_names[species_id - 1]
                species[str(species_id)] = {
                    "species": name,
                    "displayName": game_text["species_en_to_zh"].get(name, name),
                }

        add("Grass", entry.get("land_mons", {}).get("mons", []), mask=True)
        add("Surfing", entry.get("water_mons", {}).get("mons", []), mask=True)
        fishing = entry.get("fishing_mons", {}).get("mons", [])
        add("OldRod", fishing[:2])
        add("GoodRod", fishing[2:5])
        add("SuperRod", fishing[5:10])
        add("RockSmash", entry.get("rock_smash_mons", {}).get("mons", []), mask=True)

    compact = {
        family: {
            category: {
                location: sorted(ids)
                for location, ids in sorted(values.items())
            }
            for category, values in categories.items()
            if values
        }
        for family, categories in result.items()
    }
    output = (
        "// Generated from runtime/python/frlg_planner's audited encounter snapshot.\n"
        "export const FRLG_WILD_SPECIES = "
        + json.dumps(dict(sorted(species.items(), key=lambda item: int(item[0]))), ensure_ascii=False, indent=2)
        + " as const;\n\nexport const FRLG_WILD_LOCATION_LABELS = "
        + json.dumps(dict(sorted(location_labels.items())), ensure_ascii=False, indent=2)
        + " as const;\n\nexport const FRLG_WILD_ENCOUNTERS = "
        + json.dumps(compact, ensure_ascii=False, indent=2)
        + " as const;\n"
    )
    OUTPUT.write_text(output, encoding="utf-8")
    print(f"Generated {len(species)} species and {sum(len(locations) for game in compact.values() for locations in game.values())} encounter locations.")


if __name__ == "__main__":
    main()

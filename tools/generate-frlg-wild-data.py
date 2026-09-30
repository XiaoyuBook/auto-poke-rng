"""Generate compact renderer metadata from the bundled FRLG encounter table."""

from __future__ import annotations

import ast
import argparse
import hashlib
import json
from pathlib import Path
import runpy
import shutil


ROOT = Path(__file__).resolve().parents[1]
PLANNER = ROOT / "runtime" / "python" / "frlg_planner"
SOURCE = PLANNER / "rng" / "tenlines_utils.py"
ENCOUNTERS = PLANNER / "rng" / "resources" / "EncounterTables" / "Gen3" / "frlg" / "wild_encounters.json"
PERSONAL = PLANNER / "rng" / "resources" / "Personal" / "Gen3" / "personal_rsefrlg.bin"
ABILITY_NAMES = PLANNER / "rng" / "resources" / "i18n" / "en" / "abilities_en.txt"
GAME_TEXT = PLANNER / "assets" / "game_text.json"
GAME_TEXT_PY = PLANNER / "assets" / "game_text.py"
OUTPUT = ROOT / "src" / "frlgWildData.ts"
METADATA_OUTPUT = ROOT / "src" / "frlgMetadata.ts"
CATEGORIES = ("Grass", "Surfing", "OldRod", "GoodRod", "SuperRod", "RockSmash")


def load_location_map() -> dict[str, str]:
    text = SOURCE.read_text(encoding="utf-8")
    marker = "FRLG_MAP_TO_LOCATION = "
    start = text.index(marker) + len(marker)
    mapping_text = text[start:].split("\n}\n", 1)[0] + "\n}"
    return ast.literal_eval(mapping_text)


def load_filter_text() -> dict:
    wanted = {"ABILITY_EN_TO_ZH", "FILTER_NATURE_ZH_TO_EN", "FILTER_TYPE_ZH_TO_EN"}
    module = ast.parse(GAME_TEXT_PY.read_text(encoding="utf-8"))
    return {node.targets[0].id: ast.literal_eval(node.value) for node in module.body
            if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name)
            and node.targets[0].id in wanted}


def generate_metadata(game_text: dict) -> None:
    names = [line.strip() for line in ABILITY_NAMES.read_text(encoding="utf-8").splitlines() if line.strip()]
    species_names = (PLANNER / "rng/resources/i18n/en/species_en.txt").read_text(encoding="utf-8-sig").splitlines()
    data = PERSONAL.read_bytes()
    species = {}
    for species_id in range(1, 387):
        offset = species_id * 0x1C
        ids = (data[offset + 0x16], data[offset + 0x17])
        name = species_names[species_id - 1].strip()
        species[name] = {"id": species_id, "label": game_text["species_en_to_zh"].get(name, name),
                         "abilities": list(dict.fromkeys(names[i - 1] for i in ids if i))}
    text = load_filter_text()
    tables = {
        "FRLG_SPECIES_METADATA": species,
        "FRLG_ABILITY_LABELS": text["ABILITY_EN_TO_ZH"],
        "FRLG_NATURE_LABELS": {v: k for k, v in text["FILTER_NATURE_ZH_TO_EN"].items()},
        "FRLG_TYPE_LABELS": {v: k for k, v in text["FILTER_TYPE_ZH_TO_EN"].items()},
    }
    constants = {node.targets[0].id: ast.literal_eval(node.value) for node in ast.parse(SOURCE.read_text(encoding="utf-8")).body
                 if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name)
                 and node.targets[0].id in {"SOUND_LABEL_TO_VALUE", "BUTTON_MODE_LABEL_TO_VALUE", "SEED_BUTTON_LABEL_TO_VALUE", "EXTRA_BUTTON_LABEL_TO_VALUE"}}
    for field, constant in (("sound", "SOUND"), ("btn_mode", "BUTTON_MODE"), ("seed_btn", "SEED_BUTTON"), ("extra_btn", "EXTRA_BUTTON")):
        labels = {v: k for k, v in game_text[f"{field}_zh_to_en"].items()}
        tables[f"FRLG_{field.upper()}_LABELS"] = {value: labels.get(label, label) for label, value in constants[f"{constant}_LABEL_TO_VALUE"].items()}
    dump = lambda value: json.dumps(value, ensure_ascii=False)
    output = "// Generated from the bundled FRLG personal data and original GUI translations.\n"
    for name, table in tables.items():
        output += f"export const {name} = {{\n"
        output += "".join(f"  {dump(key)}: {dump(value)},\n" for key, value in table.items())
        output += "} as const;\n\n"
    METADATA_OUTPUT.write_text(output.rstrip() + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sprites-from", type=Path, help="Import matching normal/shiny PNGs once; never required at runtime")
    args = parser.parse_args()
    locations = load_location_map()
    game_text = json.loads(GAME_TEXT.read_text(encoding="utf-8"))
    encounters = json.loads(ENCOUNTERS.read_text(encoding="utf-8"))
    generate_metadata(game_text)
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
    if args.sprites_from:
        static_tables = runpy.run_path(str(PLANNER / "automation/static_targets.py"))["STATIC_TARGETS_BY_GAME"]
        names = {name for table in static_tables.values() for targets in table.values() for name in targets}
        ids = set(map(int, species)) | {species_names.index(name) + 1 for name in names}
        destination = ROOT / "src/assets/frlg-targets"
        files = {}
        for style in ("normal", "shiny"):
            (destination / style).mkdir(parents=True, exist_ok=True)
            for species_id in sorted(ids):
                relative = f"{style}/{species_id}.png"
                source = args.sprites_from / relative
                if species_id == 201:
                    source = args.sprites_from / style / "201-A.png"
                shutil.copyfile(source, destination / relative)
                files[relative] = hashlib.sha256(source.read_bytes()).hexdigest()
        manifest = {"source": "frlg-auto-rng/assets/sprites", "commit": json.loads((PLANNER.parent / "frlg-planner-manifest.json").read_text(encoding="utf-8"))["commit"], "files": files}
        (destination / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Generated {len(species)} species and {sum(len(locations) for game in compact.values() for locations in game.values())} encounter locations.")


if __name__ == "__main__":
    main()

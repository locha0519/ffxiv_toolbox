# -*- coding: utf-8 -*-
"""從繁中客戶端解包整理製作配方，輸出 data/craft.json。"""

import csv
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / ".cache"
OUT = ROOT / "data" / "craft.json"
BASE = "https://raw.githubusercontent.com/thewakingsands/ffxiv-datamining-tc/main/"
VERSION = "2026.09.14.0000.0000"

REQUIRED = [
    "Recipe.csv",
    "Item.csv",
    "CraftType.csv",
    "GatheringItem.csv",
    "GilShopItem.csv",
    "SpecialShop.csv",
]
OPTIONAL = [
    "FishParameter.csv",
    "SpearfishingItem.csv",
]
COMPANY = [
    "CompanyCraftSequence.csv",
    "CompanyCraftPart.csv",
    "CompanyCraftProcess.csv",
    "CompanyCraftSupplyItem.csv",
    "CompanyCraftDraft.csv",
    "CompanyCraftDraftCategory.csv",
    "CompanyCraftType.csv",
]
COMPANY_JOB = 8

csv.field_size_limit(min(sys.maxsize, 2**31 - 1))


def download(name: str, url: str | None = None) -> Path | None:
    CACHE.mkdir(parents=True, exist_ok=True)
    dest = CACHE / name
    if dest.exists() and dest.stat().st_size > 0:
        print(f"cache {name}", flush=True)
        return dest
    url = url or (BASE + name)
    print(f"get {name}", flush=True)
    result = subprocess.run(
        [
            "curl.exe", "-fsSL", "--retry", "8", "--retry-all-errors", "--retry-delay", "2",
            "-A", "ffxiv-craft-tree", "-o", str(dest), url,
        ],
        check=False,
    )
    if result.returncode != 0 or not dest.exists() or dest.stat().st_size == 0:
        print(f"skip {name}", flush=True)
        if dest.exists() and dest.stat().st_size == 0:
            dest.unlink()
        return None
    print(f"downloaded {name} ({dest.stat().st_size} bytes)", flush=True)
    return dest


def read_sheet(path: Path):
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.reader(handle))
    if len(rows) < 4:
        raise SystemExit(f"{path.name} 內容不足")
    header = rows[1]
    data = []
    for row in rows[3:]:
        if not row or not any(cell.strip() for cell in row):
            continue
        if len(row) < len(header):
            row = row + [""] * (len(header) - len(row))
        data.append(row)
    return header, data


def col_map(header):
    return {name: index for index, name in enumerate(header) if name}


def cell(row, index, default=""):
    if index is None or index >= len(row):
        return default
    return row[index]


def as_int(value, default=0):
    text = (value or "").strip()
    if not text or text.lower() == "false":
        return default if text.lower() == "false" else 0
    try:
        return int(float(text))
    except ValueError:
        return default


def indexed_slots(header, prefix, count):
    mapping = col_map(header)
    slots = []
    for index in range(count):
        key = f"{prefix}[{index}]"
        if key not in mapping:
            break
        slots.append(mapping[key])
    return slots


def add_company_recipes(paths, raw_items, grouped):
    """公會合建：各階段補給數量 = 每組個數 × 組數，再併進同一張配方。"""
    supply_header, supply_rows = read_sheet(paths["CompanyCraftSupplyItem.csv"])
    supply_at = col_map(supply_header)["Item"]
    supply_item = {}
    for row in supply_rows:
        supply_id = as_int(cell(row, 0))
        item_id = as_int(cell(row, supply_at))
        if supply_id > 0 and item_id > 0:
            supply_item[supply_id] = item_id

    process_header, process_rows = read_sheet(paths["CompanyCraftProcess.csv"])
    process_slots = []
    process_idx = col_map(process_header)
    slot = 0
    while f"SupplyItem[{slot}]" in process_idx:
        process_slots.append(
            (
                process_idx[f"SupplyItem[{slot}]"],
                process_idx[f"SetQuantity[{slot}]"],
                process_idx[f"SetsRequired[{slot}]"],
            )
        )
        slot += 1
    processes = {}
    for row in process_rows:
        process_id = as_int(cell(row, 0))
        amounts = []
        for supply_at, qty_at, sets_at in process_slots:
            item_id = supply_item.get(as_int(cell(row, supply_at)), 0)
            set_qty = as_int(cell(row, qty_at))
            sets = as_int(cell(row, sets_at))
            if item_id > 0 and set_qty > 0 and sets > 0 and item_id in raw_items:
                amounts.append((item_id, set_qty * sets))
        processes[process_id] = amounts

    part_header, part_rows = read_sheet(paths["CompanyCraftPart.csv"])
    part_process_at = indexed_slots(part_header, "CompanyCraftProcess", 8)
    parts = {}
    for row in part_rows:
        part_id = as_int(cell(row, 0))
        parts[part_id] = [as_int(cell(row, index)) for index in part_process_at]

    draft_header, draft_rows = read_sheet(paths["CompanyCraftDraft.csv"])
    draft_idx = col_map(draft_header)
    drafts = {}
    for row in draft_rows:
        draft_id = as_int(cell(row, 0))
        drafts[draft_id] = cell(row, draft_idx.get("Name")).strip()

    category_header, category_rows = read_sheet(paths["CompanyCraftDraftCategory.csv"])
    category_at = col_map(category_header)["Name"]
    categories = {}
    for row in category_rows:
        categories[as_int(cell(row, 0))] = cell(row, category_at).strip()

    type_header, type_rows = read_sheet(paths["CompanyCraftType.csv"])
    type_at = col_map(type_header)["Name"]
    craft_types = {}
    for row in type_rows:
        craft_types[as_int(cell(row, 0))] = cell(row, type_at).strip()

    seq_header, seq_rows = read_sheet(paths["CompanyCraftSequence.csv"])
    seq_idx = col_map(seq_header)
    part_at = indexed_slots(seq_header, "CompanyCraftPart", 8)
    added = 0
    samples = []
    for row in seq_rows:
        result_id = as_int(cell(row, seq_idx["ResultItem"]))
        if result_id <= 0 or result_id not in raw_items:
            continue
        totals = {}
        order = []
        for index in part_at:
            part_id = as_int(cell(row, index))
            if part_id <= 0:
                continue
            for process_id in parts.get(part_id, []):
                if process_id <= 0:
                    continue
                for item_id, amount in processes.get(process_id, []):
                    if item_id not in totals:
                        order.append(item_id)
                    totals[item_id] = totals.get(item_id, 0) + amount
        if not totals:
            continue
        ings = [[item_id, totals[item_id]] for item_id in order]
        signature = tuple(tuple(pair) for pair in ings)
        draft_name = drafts.get(as_int(cell(row, seq_idx.get("CompanyCraftDraft"))), "")
        category_name = categories.get(as_int(cell(row, seq_idx.get("CompanyCraftDraftCategory"))), "")
        note_parts = [part for part in (category_name, draft_name) if part]
        entry = {
            "id": 1_000_000 + as_int(cell(row, 0)),
            "job": COMPANY_JOB,
            "yield": 1,
            "secondary": False,
            "ings": ings,
            "signature": signature,
            "note": " · ".join(note_parts),
        }
        bucket = grouped.setdefault(result_id, [])
        if any(existing["signature"] == signature and existing["job"] == COMPANY_JOB for existing in bucket):
            continue
        bucket.append(entry)
        added += 1
        if len(samples) < 6 and ("飛空艇" in raw_items[result_id][0] or "潛水" in raw_items[result_id][0]):
            phase = craft_types.get(as_int(cell(row, seq_idx.get("CompanyCraftType"))), "")
            ing_text = "、".join(f"{raw_items[item_id][0]}×{amount}" for item_id, amount in ings[:8])
            samples.append(
                f"{raw_items[result_id][0]} draft={draft_name} phase={phase} {ing_text}"
            )
    print(f"company recipes {added}", flush=True)
    return samples


def main():
    paths = {}
    for name in REQUIRED:
        path = download(name)
        if path is None:
            raise SystemExit(f"缺少必要檔案 {name}")
        paths[name] = path
    for name in OPTIONAL + COMPANY:
        path = download(name)
        if path is not None:
            paths[name] = path
        elif name in COMPANY:
            raise SystemExit(f"缺少必要檔案 {name}")

    job_header, job_rows = read_sheet(paths["CraftType.csv"])
    jobs_idx = col_map(job_header)
    jobs = {}
    for row in job_rows:
        job_id = as_int(cell(row, 0))
        name = cell(row, jobs_idx.get("Name")).strip()
        if name:
            jobs[str(job_id)] = name
    jobs[str(COMPANY_JOB)] = "公會合建"

    item_header, item_rows = read_sheet(paths["Item.csv"])
    items_idx = col_map(item_header)
    name_at = items_idx["Name"]
    icon_at = items_idx["Icon"]
    raw_items = {}
    for row in item_rows:
        item_id = as_int(cell(row, 0))
        if item_id <= 0:
            continue
        name = cell(row, name_at).strip()
        if not name:
            continue
        raw_items[item_id] = [name, as_int(cell(row, icon_at)), 0]

    gather = set()
    for filename, column in (
        ("GatheringItem.csv", "Item"),
        ("FishParameter.csv", "Item"),
        ("SpearfishingItem.csv", "Item"),
    ):
        if filename not in paths:
            continue
        header, rows = read_sheet(paths[filename])
        index = col_map(header).get(column)
        if index is None:
            print(f"{filename} 沒有 {column} 欄")
            continue
        for row in rows:
            item_id = as_int(cell(row, index))
            if item_id > 0:
                gather.add(item_id)
        print(f"{filename} -> 採集 {len(gather)}")

    shop = set()
    shop_header, shop_rows = read_sheet(paths["GilShopItem.csv"])
    shop_at = col_map(shop_header)["Item"]
    for row in shop_rows:
        item_id = as_int(cell(row, shop_at))
        if item_id > 0:
            shop.add(item_id)

    exchange = set()
    special_header, special_rows = read_sheet(paths["SpecialShop.csv"])
    receive_at = [
        index
        for index, name in enumerate(special_header)
        if name.startswith("Item{Receive}") or name.startswith("Item{Result}")
    ]
    print(f"SpecialShop receive columns: {len(receive_at)}")
    if not receive_at:
        interesting = [name for name in special_header if "Item" in name][:40]
        print("SpecialShop item columns sample:", interesting)
    for row in special_rows:
        for index in receive_at:
            item_id = as_int(cell(row, index))
            if item_id > 0:
                exchange.add(item_id)

    for item_id in gather:
        if item_id in raw_items:
            raw_items[item_id][2] |= 1
    for item_id in exchange:
        if item_id in raw_items:
            raw_items[item_id][2] |= 2
    for item_id in shop:
        if item_id in raw_items:
            raw_items[item_id][2] |= 4

    voyage_path = download(
        "voyage-sources.json",
        "https://raw.githubusercontent.com/ffxiv-teamcraft/ffxiv-teamcraft/staging/libs/data/src/lib/json/voyage-sources.json",
    )
    voyage_data = {}
    submarine = set()
    airship = set()
    if voyage_path:
        voyage_data = json.loads(voyage_path.read_text(encoding="utf-8"))
        for key, entries in voyage_data.items():
            item_id = as_int(key)
            if item_id <= 0 or item_id in gather or item_id not in raw_items:
                continue
            for entry in entries:
                if entry.get("type") == 1:
                    submarine.add(item_id)
                elif entry.get("type") == 0:
                    airship.add(item_id)
        print(f"voyage sources -> 潛水艇 {len(submarine)} 飛空艇 {len(airship)}")
    for item_id in submarine:
        raw_items[item_id][2] |= 8
    for item_id in airship:
        raw_items[item_id][2] |= 16

    recipe_header, recipe_rows = read_sheet(paths["Recipe.csv"])
    recipe_idx = col_map(recipe_header)
    ingredient_slots = []
    slot = 0
    while f"Item{{Ingredient}}[{slot}]" in recipe_idx:
        ingredient_slots.append(
            (
                recipe_idx[f"Item{{Ingredient}}[{slot}]"],
                recipe_idx[f"Amount{{Ingredient}}[{slot}]"],
            )
        )
        slot += 1
    print(f"ingredient slots: {len(ingredient_slots)}")

    grouped = {}
    for row in recipe_rows:
        result_id = as_int(cell(row, recipe_idx["Item{Result}"]))
        if result_id <= 0 or result_id not in raw_items:
            continue
        ings = []
        for item_at, amount_at in ingredient_slots:
            item_id = as_int(cell(row, item_at))
            amount = as_int(cell(row, amount_at))
            if item_id > 0 and amount > 0 and item_id in raw_items:
                ings.append([item_id, amount])
        if not ings:
            continue
        signature = tuple(ings)
        entry = {
            "id": as_int(cell(row, 0)),
            "job": as_int(cell(row, recipe_idx["CraftType"])),
            "yield": max(1, as_int(cell(row, recipe_idx["Amount{Result}"]), 1)),
            "secondary": cell(row, recipe_idx.get("IsSecondary")).strip().lower() == "true",
            "ings": ings,
            "signature": signature,
        }
        bucket = grouped.setdefault(result_id, [])
        if any(existing["signature"] == signature for existing in bucket):
            continue
        bucket.append(entry)

    company_samples = add_company_recipes(paths, raw_items, grouped)

    recipes = {}
    for result_id, bucket in grouped.items():
        bucket.sort(key=lambda entry: (entry["job"] == COMPANY_JOB, entry["secondary"], -entry["id"]))
        recipes[str(result_id)] = [
            [
                entry["id"],
                entry["job"],
                entry["yield"],
                int(entry["secondary"]),
                entry["ings"],
                entry.get("note", ""),
            ]
            for entry in bucket
        ]

    used = set(int(key) for key in recipes)
    for bucket in recipes.values():
        for entry in bucket:
            for item_id, _amount in entry[4]:
                used.add(item_id)

    items = {}
    for item_id in used:
        info = raw_items.get(item_id)
        if info:
            items[str(item_id)] = info

    from sources import build_sources

    sources = build_sources(
        raw_items,
        used,
        voyage_data,
        special_header,
        special_rows,
        shop_header,
        shop_rows,
    )

    payload = {
        "version": VERSION,
        "lang": "tc",
        "source": "thewakingsands/ffxiv-datamining-tc",
        "jobs": jobs,
        "items": items,
        "recipes": recipes,
        "sources": sources,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"items {len(items)} recipes {len(recipes)} -> {OUT} ({OUT.stat().st_size} bytes)")

    sample_path = CACHE / "sample.txt"
    lines = ["jobs: " + "、".join(f"{key}:{value}" for key, value in jobs.items())]
    shown = 0
    for result_id, bucket in recipes.items():
        name = items[result_id][0]
        if "錠" not in name and "木材" not in name:
            continue
        entry = bucket[0]
        ing_text = "、".join(
            f"{items[str(item_id)][0]}×{amount}" for item_id, amount in entry[4]
        )
        lines.append(f"{name} id={result_id} yield={entry[2]} job={jobs.get(str(entry[1]), entry[1])} {ing_text}")
        shown += 1
        if shown >= 8:
            break
    lines.append("")
    lines.extend(company_samples)
    sample_path.write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    main()

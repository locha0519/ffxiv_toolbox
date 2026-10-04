# -*- coding: utf-8 -*-
"""整理採集點、釣場、刺魚、兌換、商店與航行海域。"""

import re
from collections import defaultdict

KANA = re.compile(r"[\u3041-\u3096\u30a1-\u30fa\u30fc-\u30ff]")

import build_data as b

GATHER_KIND = {0: "採掘", 1: "碎石", 2: "採伐", 3: "割草"}
GENERIC_SHOPS = {
    "",
    "購買道具",
    "アイテムの購入",
    "購買武器",
    "購買工具",
    "購買戰鬥防具",
    "購買能工巧匠及大地使者防具",
    "購買能工巧匠及大地使者飾品",
}


def _sheet(name):
    path = b.download(name)
    if path is None:
        print(f"來源略過 {name}", flush=True)
        return None, None
    return b.read_sheet(path)


def _grid(raw_x, raw_y, size):
    scale = (size or 100) / 100.0
    x = raw_x / 2048.0 * 41.0 / scale
    y = raw_y / 2048.0 * 41.0 / scale
    if 0.5 <= x <= 42 and 0.5 <= y <= 42:
        return (round(x, 1), round(y, 1))
    return None


def _world(export_x, export_y, size, offset_x, offset_y):
    """ExportedGatheringPoint 的 X、Y 對應地圖上的 X、Y。"""
    scale = (size or 100) / 100.0
    map_x = ((export_x + offset_x) * scale + 1024.0) / 2048.0 * 41.0
    map_y = ((export_y + offset_y) * scale + 1024.0) / 2048.0 * 41.0
    if 0.5 <= map_x <= 42 and 0.5 <= map_y <= 42:
        return (round(map_x, 1), round(map_y, 1))
    return None


def _line(kind, level, zone, spot, coord):
    text = kind
    if level:
        text += f" Lv{level}"
    where = []
    if zone:
        where.append(zone)
    if spot and spot != zone:
        where.append(spot)
    if where:
        text += "　" + "　".join(where)
    if coord:
        text += f"　({coord[0]:.1f}, {coord[1]:.1f})"
    return text


def _cap(lines, limit, rest):
    unique = list(dict.fromkeys(lines))
    if len(unique) <= limit:
        return unique
    return unique[:limit] + [rest.format(n=len(unique) - limit)]


def _names(raw_items):
    return {item_id: info[0] for item_id, info in raw_items.items()}


def _places():
    header, rows = _sheet("PlaceName.csv")
    if not rows:
        return {}
    return {b.as_int(row[0]): (row[1].strip() if len(row) > 1 else "") for row in rows}


def _territories(place):
    header, rows = _sheet("TerritoryType.csv")
    if not rows:
        return {}
    idx = b.col_map(header)
    found = {}
    for row in rows:
        territory_id = b.as_int(row[0])
        zone = place.get(b.as_int(b.cell(row, idx.get("PlaceName"))), "")
        found[territory_id] = {
            "zone": zone,
            "map": b.as_int(b.cell(row, idx.get("Map"))),
        }
    return found


def _maps():
    header, rows = _sheet("Map.csv")
    if not rows:
        return {}
    idx = b.col_map(header)
    found = {}
    for row in rows:
        map_id = b.as_int(row[0])
        found[map_id] = {
            "id": map_id,
            "size": b.as_int(b.cell(row, idx.get("SizeFactor")), 100) or 100,
            "x": b.as_int(b.cell(row, idx.get("Offset{X}"))),
            "y": b.as_int(b.cell(row, idx.get("Offset{Y}"))),
            "key": b.cell(row, idx.get("Id")).strip(),
            "markers": b.as_int(b.cell(row, idx.get("MapMarkerRange"))),
        }
    return found


def _map_of(territories, maps, territory_id):
    info = territories.get(territory_id) or {}
    return maps.get(info.get("map") or 0) or {"size": 100, "x": 0, "y": 0, "key": ""}


KIND_CODE = {0: "m", 1: "q", 2: "l", 3: "h"}


def _flag(value):
    return str(value or "").strip().lower() == "true"


def _num(value):
    text = str(value or "").strip()
    if not text:
        return 0.0
    try:
        return float(text)
    except ValueError:
        return 0.0


def _marker_coord(raw_x, raw_y, chart):
    """地圖標記的 X、Y 是圖上的像素，不是世界座標。"""
    size = chart.get("size") or 100
    scale = size / 100.0
    x = (raw_x / scale + (chart.get("x") or 0)) / 50.0 + 1.0
    y = (raw_y / scale + (chart.get("y") or 0)) / 50.0 + 1.0
    if 0.5 <= x <= 42 and 0.5 <= y <= 42:
        return (round(x, 1), round(y, 1))
    return None


def _nearest(crystals, map_key, x, y):
    rows = crystals.get(map_key, ())
    big = [crystal for crystal in rows if crystal.get("big")]
    best = None
    best_d = None
    for crystal in big or rows:
        dist = (crystal["x"] - x) ** 2 + (crystal["y"] - y) ** 2
        if best_d is None or dist < best_d:
            best_d = dist
            best = crystal
    return best


def _point(chart, zone, coord, title, kind, crystals, detail):
    map_id = (chart or {}).get("key") or ""
    if not coord or "/" not in map_id or map_id.startswith("default"):
        return None
    nearest = _nearest(crystals, map_id, coord[0], coord[1])
    return [
        map_id,
        zone,
        coord[0],
        coord[1],
        title or zone,
        kind,
        nearest["name"] if nearest else "",
        nearest["x"] if nearest else 0,
        nearest["y"] if nearest else 0,
        detail or "",
        1 if nearest and nearest.get("big") else 0,
    ]


def _aetherytes(place, maps):
    """乙太之光的位置來自地圖標記，Data{Type} 3 指向 Aetheryte。"""
    header, rows = _sheet("MapMarker.csv")
    a_header, a_rows = _sheet("Aetheryte.csv")
    if not rows or not a_rows:
        return {}
    idx = b.col_map(header)
    a_idx = b.col_map(a_header)
    info = {}
    for row in a_rows:
        if _flag(b.cell(row, a_idx.get("Invisible"))):
            continue
        name = place.get(b.as_int(b.cell(row, a_idx.get("PlaceName"))), "").strip()
        if not name:
            name = b.cell(row, a_idx.get("Singular")).strip()
        if not name or name == "乙太之光":
            continue
        info[b.as_int(row[0])] = {
            "name": name,
            "big": _flag(b.cell(row, a_idx.get("IsAetheryte"))),
            "map": b.as_int(b.cell(row, a_idx.get("Map"))),
        }
    parent_maps = defaultdict(list)
    for chart in maps.values():
        key = chart.get("key") or ""
        if chart.get("markers") and "/" in key and not key.startswith("default"):
            parent_maps[chart["markers"]].append(chart)
    picked = {}
    for row in rows:
        if b.as_int(b.cell(row, idx.get("Data{Type}"))) != 3:
            continue
        meta = info.get(b.as_int(b.cell(row, idx.get("Data{Key}"))))
        if not meta:
            continue
        parent = b.as_int(str(row[0]).split(".", 1)[0])
        charts = parent_maps.get(parent) or []
        if meta["map"]:
            home = [chart for chart in charts if chart.get("id") == meta["map"]]
            charts = home or charts
        elif len(charts) != 1:
            continue
        if not charts:
            continue
        chart = charts[0]
        coord = _marker_coord(_num(b.cell(row, idx.get("X"))), _num(b.cell(row, idx.get("Y"))), chart)
        if not coord:
            continue
        token = (chart["key"], meta["name"], meta["big"])
        icon = b.as_int(b.cell(row, idx.get("Icon")))
        previous = picked.get(token)
        if previous and previous["icon"] == 60453 and icon != 60453:
            continue
        picked[token] = {"name": meta["name"], "x": coord[0], "y": coord[1], "big": meta["big"], "icon": icon, "map": chart["key"]}
    by_map = defaultdict(list)
    for entry in picked.values():
        by_map[entry["map"]].append(entry)
    return by_map


def _usable_name(name):
    text = (name or "").strip()
    if not text or text == "測試" or text.startswith("測試") or KANA.search(text):
        return ""
    return text


def _vendors(place, territories, maps):
    """商人站點：ENpcData 對到 GilShop 或 SpecialShop，座標在 Level（類型 8）。"""
    base_header, base_rows = _sheet("ENpcBase.csv")
    resident_header, resident_rows = _sheet("ENpcResident.csv")
    level_header, level_rows = _sheet("Level.csv")
    gil_header, gil_rows = _sheet("GilShop.csv")
    empty = {"gil": {}, "trade": {}}
    if not (base_rows and resident_rows and level_rows and gil_rows):
        return empty
    data_at = [index for index, name in enumerate(base_header) if name.startswith("ENpcData[")]
    gil_idx = b.col_map(gil_header)
    gil_ids = {b.as_int(row[0]) for row in gil_rows}
    spec_header, spec_rows = _sheet("SpecialShop.csv")
    spec_ids = {b.as_int(row[0]) for row in spec_rows} if spec_rows else set()
    resident_idx = b.col_map(resident_header)
    residents = {}
    for row in resident_rows:
        residents[b.as_int(row[0])] = (
            _usable_name(row[1] if len(row) > 1 else ""),
            b.as_int(b.cell(row, resident_idx.get("Map"))),
        )
    level_idx = b.col_map(level_header)
    positions = defaultdict(list)
    for row in level_rows:
        if b.as_int(b.cell(row, level_idx.get("Type"))) != 8:
            continue
        npc_id = b.as_int(b.cell(row, level_idx.get("Object")))
        if npc_id <= 0:
            continue
        positions[npc_id].append(row)
    gil_npcs = defaultdict(set)
    trade_npcs = defaultdict(set)
    for row in base_rows:
        npc_id = b.as_int(row[0])
        if not residents.get(npc_id, ("", 0))[0]:
            continue
        for col in data_at:
            value = b.as_int(b.cell(row, col))
            if value in gil_ids:
                gil_npcs[value].add(npc_id)
            elif value in spec_ids:
                trade_npcs[value].add(npc_id)

    def locate(npc_ids):
        found = []
        seen = set()
        for npc_id in npc_ids:
            name, home = residents.get(npc_id, ("", 0))
            if not name:
                continue
            located = []
            for row in positions.get(npc_id, ()):
                territory_id = b.as_int(b.cell(row, level_idx.get("Territory")))
                zone = (territories.get(territory_id) or {}).get("zone") or ""
                if not zone:
                    continue
                chart = maps.get(b.as_int(b.cell(row, level_idx.get("Map")))) or _map_of(territories, maps, territory_id)
                if "/" not in chart.get("key", "") or chart["key"].startswith("default"):
                    continue
                coord = _world(
                    _num(b.cell(row, level_idx.get("X"))),
                    _num(b.cell(row, level_idx.get("Z"))),
                    chart["size"],
                    chart["x"],
                    chart["y"],
                )
                if not coord:
                    continue
                located.append((chart.get("id") or 0, chart["key"], zone, coord, name))
            if any(spot[0] == home for spot in located):
                located = [spot for spot in located if spot[0] == home]
            for _map_id, map_key, zone, coord, npc_name in located:
                key = (map_key, coord[0], coord[1], npc_name)
                if key in seen:
                    continue
                seen.add(key)
                found.append((map_key, zone, coord[0], coord[1], npc_name))
        return found

    return {
        "gil": {shop_id: locate(npc_ids) for shop_id, npc_ids in gil_npcs.items()},
        "trade": {shop_id: locate(npc_ids) for shop_id, npc_ids in trade_npcs.items()},
    }


def _pick_spots(spots, limit):
    unique = []
    seen = set()
    for spot in spots:
        key = (spot[0], spot[2], spot[3], spot[4])
        if key in seen:
            continue
        seen.add(key)
        unique.append(spot)
    unique.sort(key=lambda spot: (spot[1], spot[4]))
    chosen = []
    used_maps = set()
    for spot in unique:
        if spot[0] in used_maps:
            continue
        used_maps.add(spot[0])
        chosen.append(spot)
        if len(chosen) >= limit:
            return chosen
    for spot in unique:
        if spot in chosen:
            continue
        chosen.append(spot)
        if len(chosen) >= limit:
            break
    return chosen


def _gather(raw_items, used, place, territories, maps, crystals):
    item_header, item_rows = _sheet("GatheringItem.csv")
    base_header, base_rows = _sheet("GatheringPointBase.csv")
    point_header, point_rows = _sheet("GatheringPoint.csv")
    export_header, export_rows = _sheet("ExportedGatheringPoint.csv")
    lines = defaultdict(list)
    points = defaultdict(list)
    if not (item_rows and base_rows and point_rows):
        return lines, points
    item_idx = b.col_map(item_header)
    row_to_item = {
        b.as_int(row[0]): b.as_int(b.cell(row, item_idx["Item"]))
        for row in item_rows
    }
    base_idx = b.col_map(base_header)
    slots = b.indexed_slots(base_header, "Item", 8)
    bases = {}
    for row in base_rows:
        base_id = b.as_int(row[0])
        kind = b.as_int(b.cell(row, base_idx.get("GatheringType")))
        if kind not in GATHER_KIND:
            continue
        items = []
        for slot in slots:
            item_id = row_to_item.get(b.as_int(b.cell(row, slot)), 0)
            if item_id in used:
                items.append(item_id)
        if items:
            bases[base_id] = (kind, b.as_int(b.cell(row, base_idx.get("GatheringLevel"))), items)
    # 名稱列把布林欄算進去，實際的採集點基底在第 5 欄，地區與地名在第 9、10 欄。
    spots = defaultdict(set)
    for row in point_rows:
        base_id = b.as_int(b.cell(row, 4))
        if base_id not in bases:
            continue
        territory_id = b.as_int(b.cell(row, 8))
        zone = (territories.get(territory_id) or {}).get("zone") or ""
        if not zone:
            continue
        spot = place.get(b.as_int(b.cell(row, 9)), "")
        spots[base_id].add((territory_id, zone, spot))
    exported = {}
    if export_rows:
        export_idx = b.col_map(export_header)
        for row in export_rows:
            exported[b.as_int(row[0])] = (
                float(b.cell(row, export_idx["X"]) or 0),
                float(b.cell(row, export_idx["Y"]) or 0),
            )
    for base_id, (kind, level, items) in bases.items():
        places = spots.get(base_id) or set()
        coord = None
        chart = None
        if len(places) == 1 and base_id in exported:
            territory_id = next(iter(places))[0]
            chart = _map_of(territories, maps, territory_id)
            export_x, export_y = exported[base_id]
            coord = _world(export_x, export_y, chart["size"], chart["x"], chart["y"])
        label = GATHER_KIND[kind]
        detail = f"Lv {level}" if level else ""
        marker = _point(chart, "", coord, "", KIND_CODE[kind], crystals, detail) if coord else None
        seen = set()
        for _territory, zone, spot in sorted(places, key=lambda entry: (entry[1], entry[2])):
            if marker and zone:
                placed = marker[:]
                placed[1] = zone
                placed[4] = spot or zone
                for item_id in items:
                    points[item_id].append(placed)
                continue
            text = _line(label, level, zone, spot, coord)
            if text in seen:
                continue
            seen.add(text)
            for item_id in items:
                lines[item_id].append(text)
    return lines, points


def _fish(used, place, territories, maps, crystals):
    header, rows = _sheet("FishingSpot.csv")
    lines = defaultdict(list)
    points = defaultdict(list)
    if not rows:
        return lines, points
    idx = b.col_map(header)
    slots = b.indexed_slots(header, "Item", 10)
    for row in rows:
        territory_id = b.as_int(b.cell(row, idx.get("TerritoryType")))
        zone = (territories.get(territory_id) or {}).get("zone") or ""
        if not zone:
            continue
        raw_x = b.as_int(b.cell(row, idx.get("X")))
        raw_y = b.as_int(b.cell(row, idx.get("Z")))
        if raw_x <= 0 and raw_y <= 0:
            continue
        chart = _map_of(territories, maps, territory_id)
        coord = _grid(raw_x, raw_y, chart["size"])
        spot = ""
        for key in ("PlaceName", "PlaceName{Sub}", "PlaceName{Main}"):
            spot = place.get(b.as_int(b.cell(row, idx.get(key))), "")
            if spot:
                break
        level = b.as_int(b.cell(row, idx.get("GatheringLevel")))
        marker = _point(chart, zone, coord, spot or zone, "f", crystals, f"Lv {level}" if level else "")
        text = _line("釣魚", level, zone, spot, coord)
        for slot in slots:
            item_id = b.as_int(b.cell(row, slot))
            if item_id not in used:
                continue
            if marker:
                points[item_id].append(marker)
            else:
                lines[item_id].append(text)
    return lines, points


def _spear(used, place, territories, maps, crystals):
    item_header, item_rows = _sheet("SpearfishingItem.csv")
    base_header, base_rows = _sheet("GatheringPointBase.csv")
    note_header, note_rows = _sheet("SpearfishingNotebook.csv")
    lines = defaultdict(list)
    points = defaultdict(list)
    if not (item_rows and base_rows and note_rows):
        return lines, points
    item_idx = b.col_map(item_header)
    row_to_item = {
        b.as_int(row[0]): b.as_int(b.cell(row, item_idx["Item"]))
        for row in item_rows
    }
    base_idx = b.col_map(base_header)
    slots = b.indexed_slots(base_header, "Item", 8)
    base_items = {}
    for row in base_rows:
        items = []
        for slot in slots:
            item_id = row_to_item.get(b.as_int(b.cell(row, slot)), 0)
            if item_id in used:
                items.append(item_id)
        if items:
            base_items[b.as_int(row[0])] = items
    idx = b.col_map(note_header)
    for row in note_rows:
        items = base_items.get(b.as_int(b.cell(row, idx.get("GatheringPointBase"))))
        if not items:
            continue
        territory_id = b.as_int(b.cell(row, idx.get("TerritoryType")))
        zone = (territories.get(territory_id) or {}).get("zone") or ""
        spot = place.get(b.as_int(b.cell(row, idx.get("PlaceName"))), "")
        chart = _map_of(territories, maps, territory_id)
        coord = _grid(
            b.as_int(b.cell(row, idx.get("X"))),
            b.as_int(b.cell(row, idx.get("Y"))),
            chart["size"],
        )
        level = b.as_int(b.cell(row, idx.get("GatheringLevel")))
        detail = f"Lv {level}" if level else ""
        shadow = b.cell(row, idx.get("IsShadowNode")).strip().lower() == "true"
        if shadow:
            detail = f"{detail}　影子魚影".strip()
        marker = _point(chart, zone, coord, spot or zone, "s", crystals, detail)
        text = _line("刺魚", level, zone, spot, coord)
        if shadow:
            text += "　影子魚影"
        for item_id in items:
            if marker:
                points[item_id].append(marker)
            else:
                lines[item_id].append(text)
    return lines, points


def _trades(raw_items, used, special_header, special_rows, crystals, vendors):
    lines = defaultdict(list)
    points = defaultdict(list)
    if not special_rows:
        return lines, points
    idx = b.col_map(special_header)
    names = _names(raw_items)
    seen = defaultdict(set)
    for row in special_rows:
        shop = b.cell(row, idx.get("Name")).strip() or "兌換"
        if shop == "測試" or shop.startswith("測試"):
            continue
        if KANA.search(shop):
            shop = "兌換"
        row_items = set()
        slot = 0
        while f"Item{{Receive}}[{slot}][0]" in idx:
            received = []
            for side in (0, 1):
                item_id = b.as_int(b.cell(row, idx.get(f"Item{{Receive}}[{slot}][{side}]")))
                count = b.as_int(b.cell(row, idx.get(f"Count{{Receive}}[{slot}][{side}]")), 1) or 1
                if item_id in used:
                    received.append((item_id, count, side == 1))
            if received:
                row_items.update(item_id for item_id, _count, _hq in received)
                costs = []
                for side in range(3):
                    cost_id = b.as_int(b.cell(row, idx.get(f"Item{{Cost}}[{slot}][{side}]")))
                    cost_count = b.as_int(b.cell(row, idx.get(f"Count{{Cost}}[{slot}][{side}]")))
                    cost_name = names.get(cost_id, "")
                    if cost_name == "Gil":
                        cost_name = "金幣"
                    if cost_id <= 0 or cost_count <= 0 or not cost_name:
                        continue
                    bit = f"{cost_name} ×{cost_count}"
                    if b.cell(row, idx.get(f"HQ{{Cost}}[{slot}][{side}]")).strip().lower() == "true":
                        bit += "（HQ）"
                    rating = b.as_int(b.cell(row, idx.get(f"CollectabilityRating{{Cost}}[{slot}][{side}]")))
                    if rating > 0:
                        bit += f"（收藏價值 {rating}）"
                    costs.append(bit)
                if costs and not any("×999" in bit or bit.endswith("×999") for bit in costs):
                    paid = "、".join(costs)
                    for item_id, count, hq in received:
                        got = f"×{count}" + ("（HQ）" if hq else "")
                        text = f"{shop}：付出 {paid}，得到 {got}"
                        if text not in seen[item_id]:
                            seen[item_id].add(text)
                            lines[item_id].append(text)
            slot += 1
        for map_key, zone, x, y, npc_name in _pick_spots(vendors["trade"].get(b.as_int(row[0]), []), 6):
            marker = _point({"key": map_key}, zone, (x, y), npc_name, "t", crystals, shop)
            if not marker:
                continue
            for item_id in row_items:
                points[item_id].append(marker[:])
    return lines, points


def _shop_label(label):
    if not label or label in GENERIC_SHOPS or KANA.search(label):
        return "金幣商店"
    return label


def _gil(raw_items, used, shop_header, shop_rows, crystals, vendors):
    lines = defaultdict(list)
    points = defaultdict(list)
    header, rows = _sheet("GilShop.csv")
    if not rows or not shop_rows:
        return lines, points
    idx = b.col_map(header)
    shop_idx = b.col_map(shop_header)
    names = {}
    for row in rows:
        names[b.as_int(row[0])] = b.cell(row, idx.get("Name")).strip()
    found = defaultdict(set)
    for row in shop_rows:
        item_id = b.as_int(b.cell(row, shop_idx.get("Item")))
        if item_id not in used:
            continue
        shop_id = b.as_int(str(b.cell(row, 0)).split(".", 1)[0])
        found[item_id].add(shop_id)
    for item_id, shop_ids in found.items():
        spots = []
        unlocated = []
        for shop_id in shop_ids:
            label = names.get(shop_id, "")
            located = vendors["gil"].get(shop_id, [])
            if located:
                spots.extend((*spot, _shop_label(label)) for spot in located)
            elif label not in GENERIC_SHOPS and label and not KANA.search(label):
                unlocated.append(label)
        for map_key, zone, x, y, npc_name, detail in _pick_spots(spots, 6):
            marker = _point({"key": map_key}, zone, (x, y), npc_name, "b", crystals, detail)
            if marker:
                points[item_id].append(marker)
        if points[item_id]:
            continue
        if unlocated:
            lines[item_id] = [f"金幣商店　{label}" for label in sorted(set(unlocated))]
        else:
            lines[item_id] = ["金幣商店可購買"]
    return lines, points


def _voyages(used, voyage_data):
    sub_lines = defaultdict(list)
    air_lines = defaultdict(list)
    if not voyage_data:
        return sub_lines, air_lines
    sub_header, sub_rows = _sheet("SubmarineExploration.csv")
    map_header, map_rows = _sheet("SubmarineMap.csv")
    air_header, air_rows = _sheet("AirshipExplorationPoint.csv")
    seas = {}
    if map_rows:
        seas = {b.as_int(row[0]): (row[1].strip() if len(row) > 1 else "") for row in map_rows}
    sectors = {}
    if sub_rows:
        idx = b.col_map(sub_header)
        for row in sub_rows:
            sea = seas.get(b.as_int(b.cell(row, idx.get("Map"))), "")
            dest = b.cell(row, idx.get("Destination")).strip()
            if not dest:
                continue
            sectors[b.as_int(row[0])] = f"{sea}　{dest}" if sea else dest
    points = {}
    if air_rows:
        idx = b.col_map(air_header)
        points = {b.as_int(row[0]): b.cell(row, idx.get("Name")).strip() for row in air_rows}
    for key, entries in voyage_data.items():
        item_id = b.as_int(key)
        if item_id not in used:
            continue
        subs = []
        airs = []
        for entry in entries:
            point_id = entry.get("id")
            point_id = point_id if isinstance(point_id, int) else b.as_int(point_id)
            if entry.get("type") == 1:
                label = sectors.get(point_id)
                if label:
                    subs.append(label)
            elif entry.get("type") == 0:
                label = points.get(point_id)
                if label:
                    airs.append(label)
        if subs:
            sub_lines[item_id] = sorted(set(subs))
        if airs:
            air_lines[item_id] = sorted(set(airs))
    return sub_lines, air_lines


def build_sources(raw_items, used, voyage_data, special_header, special_rows, shop_header, shop_rows):
    place = _places()
    territories = _territories(place)
    maps = _maps()
    crystals = _aetherytes(place, maps)
    vendors = _vendors(place, territories, maps)
    gathered, gather_points = _gather(raw_items, used, place, territories, maps, crystals)
    fished, fish_points = _fish(used, place, territories, maps, crystals)
    speared, spear_points = _spear(used, place, territories, maps, crystals)
    traded, trade_points = _trades(raw_items, used, special_header, special_rows, crystals, vendors)
    bought, shop_points = _gil(raw_items, used, shop_header, shop_rows, crystals, vendors)
    submarine, airship = _voyages(used, voyage_data)
    keys = (
        set(gathered) | set(gather_points) | set(fished) | set(fish_points)
        | set(speared) | set(spear_points) | set(traded) | set(trade_points)
        | set(bought) | set(shop_points) | set(submarine) | set(airship)
    )
    kind_limit = {"g": 12, "f": 8, "s": 8, "b": 6, "t": 6}
    sources = {}
    for item_id in keys:
        entry = {}
        groups = (
            ("g", gathered, 16, "另外還有 {n} 處採集點"),
            ("f", fished, 12, "另外還有 {n} 處釣場"),
            ("s", speared, 12, "另外還有 {n} 處刺魚點"),
            ("t", traded, 8, "另外還有 {n} 種兌換"),
            ("u", submarine, 24, "另外還有 {n} 處海域"),
            ("a", airship, 24, "另外還有 {n} 處航點"),
            ("b", bought, 6, "另外還有 {n} 間商店"),
        )
        for key, table, limit, rest in groups:
            rows = table.get(item_id)
            if rows:
                entry[key] = _cap(rows, limit, rest)
        markers = []
        seen = set()
        counts = defaultdict(int)
        for table in (gather_points, fish_points, spear_points, shop_points, trade_points):
            for marker in table.get(item_id, []):
                kind = marker[5] if len(marker) > 5 else ""
                group = "g" if kind in "mqlh" else kind
                token = tuple(marker)
                if token in seen or counts[group] >= kind_limit.get(group, 8):
                    continue
                seen.add(token)
                counts[group] += 1
                markers.append(list(marker))
        if markers:
            entry["p"] = markers
        if entry:
            sources[str(item_id)] = entry
    print(
        "sources "
        f"採集 {len(gathered)} 釣魚 {len(fished)} 刺魚 {len(speared)} "
        f"兌換 {len(traded)} 潛水艇 {len(submarine)} 飛空艇 {len(airship)} 商店 {len(bought)} "
        f"乙太 {sum(len(rows) for rows in crystals.values())} -> {len(sources)}",
        flush=True,
    )
    sample = []
    for name, rows in crystals.items():
        for crystal in rows:
            if crystal["name"] in ("地平關", "利姆薩・羅敏薩下層甲板", "格里達尼亞新街"):
                sample.append(f"ae {crystal['name']} {name} {crystal['x']} {crystal['y']}")
    for item_id in (5106, 12223, 20171):
        sample.append(f"== {raw_items.get(item_id, ['?'])[0]} {item_id}")
        for key, rows in (sources.get(str(item_id)) or {}).items():
            sample.append(f"[{key}]")
            for row in rows[:8]:
                sample.append(row if isinstance(row, str) else " | ".join(str(part) for part in row))
    trade_id = next((item_id for item_id, rows in traded.items() if any("白票" in row or "神典石" in row or "兵武" in row for row in rows)), 0)
    if trade_id:
        sample.append(f"== trade {raw_items.get(trade_id, ['?'])[0]} {trade_id}")
        packed = sources.get(str(trade_id), {})
        sample.extend(packed.get("t", [])[:8])
        for row in packed.get("p", [])[:6]:
            sample.append(" | ".join(str(part) for part in row))
    (b.CACHE / "source-sample.txt").write_text("\n".join(sample), encoding="utf-8")
    return sources

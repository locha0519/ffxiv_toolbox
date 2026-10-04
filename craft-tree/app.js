const STORAGE_KEY = "ffxiv-craft-tree-v1";

const CRYSTAL_NAME = /^(?:[風火冰土雷水]之(?:碎晶|水晶|晶簇)|無屬性水晶|(?:深紅|深綠|深藍)(?:水晶|晶簇)|黑暗物質晶簇)$/;

const MARKET_WORLDS = ["陸行鳥", "伊弗利特", "迦樓羅", "利維坦", "鳳凰", "奧汀", "巴哈姆特", "拉姆", "泰坦"];

const MARKET_WORLD_NAMES = {
  4028: "伊弗利特",
  4029: "迦樓羅",
  4030: "利維坦",
  4031: "鳳凰",
  4032: "奧汀",
  4033: "巴哈姆特",
  4034: "拉姆",
  4035: "泰坦",
};

const state = {
  db: null,
  craftable: [],
  targets: [],
  pins: new Set(),
  choices: new Map(),
  done: new Set(),
  lists: [],
  activeListId: "",
  hideCrystals: false,
  marketWorld: "陸行鳥",
  prices: new Map(),
  hydrated: false,
  hover: null,
  sourceId: null,
  activeResult: 0,
  matches: [],
};

const els = {
  query: document.querySelector("#query"),
  qty: document.querySelector("#qty"),
  form: document.querySelector("#search-form"),
  results: document.querySelector("#results"),
  list: document.querySelector("#target-list"),
  listEmpty: document.querySelector("#list-empty"),
  board: document.querySelector("#board"),
  scroll: document.querySelector("#board-scroll"),
  detail: document.querySelector("#detail"),
  detailBody: document.querySelector("#detail-body"),
  footnote: document.querySelector("#footnote"),
  clear: document.querySelector("#clear-btn"),
  jump: document.querySelector("#jump-base"),
  copyMaterials: document.querySelector("#copy-material-names"),
  copyRecipes: document.querySelector("#copy-recipe-names"),
  sourceCopy: document.querySelector("#source-copy"),
  tabs: document.querySelector("#list-tabs"),
  listName: document.querySelector("#list-name"),
  hideCrystals: document.querySelector("#hide-crystals"),
  marketWorld: document.querySelector("#market-world"),
  marketBtn: document.querySelector("#market-btn"),
  source: document.querySelector("#source"),
  sourceTitle: document.querySelector("#source-title"),
  sourceBody: document.querySelector("#source-body"),
  sourceClose: document.querySelector("#source-close"),
};

function iconUrl(icon) {
  if (!icon) return "";
  const name = String(icon).padStart(6, "0");
  return `https://xivapi.com/i/${name.slice(0, 3)}000/${name}.png`;
}

function item(id) {
  return state.db.items[String(id)];
}

function itemName(id) {
  return item(id)?.[0] || `未知道具 ${id}`;
}

function isCrystal(id) {
  return CRYSTAL_NAME.test(itemName(id));
}

function crystalHidden(id) {
  return state.hideCrystals && isCrystal(id);
}

function formatGil(amount) {
  return `${Math.round(amount).toLocaleString("zh-Hant")} 金幣`;
}

function marketScope() {
  return state.marketWorld === "陸行鳥" ? "dc" : "world";
}

function priceKey(id) {
  return `${state.marketWorld}:${id}`;
}

function quoteFrom(row) {
  if (!row) return null;
  const scope = marketScope();
  const take = (bucket) => {
    const node = bucket?.minListing?.[scope];
    const price = Number(node?.price);
    if (!Number.isFinite(price) || price <= 0) return null;
    return { price, worldId: node.worldId || 0 };
  };
  const nq = take(row.nq);
  const hq = take(row.hq);
  const picked = nq || hq;
  if (!picked) return null;
  const worldName = picked.worldId ? MARKET_WORLD_NAMES[picked.worldId] : "";
  return {
    price: picked.price,
    hq: !nq,
    worldName: state.marketWorld === "陸行鳥" ? worldName : "",
  };
}

function quoteOf(id) {
  const key = priceKey(id);
  if (!state.prices.has(key)) return undefined;
  return quoteFrom(state.prices.get(key));
}

function priceText(id) {
  const quote = quoteOf(id);
  if (quote === undefined) return "";
  if (!quote) return "沒有掛牌";
  const quality = quote.hq ? "・高品質" : "";
  const world = quote.worldName ? `・${quote.worldName}` : "";
  return `最低 ${formatGil(quote.price)}／個${quality}${world}`;
}

function priceHtml(id) {
  const text = priceText(id);
  if (!text) return "";
  const empty = text === "沒有掛牌" ? " is-empty" : "";
  return `<div class="price${empty}">${escapeHtml(text)}</div>`;
}

function basePriceNote(ids) {
  let total = 0;
  let counted = 0;
  let missing = 0;
  let unknown = 0;
  for (const id of ids) {
    if (state.done.has(id)) continue;
    const quote = quoteOf(id);
    if (quote === undefined) {
      unknown += 1;
      continue;
    }
    if (!quote) {
      missing += 1;
      continue;
    }
    total += quote.price * (state.model?.demand.get(id) || 0);
    counted += 1;
  }
  if (!counted && !missing) return "";
  const miss = missing ? `，${missing} 種沒有掛牌` : "";
  const pending = unknown ? `，還有 ${unknown} 種沒查` : "";
  if (!counted) return `尚未蒐集的素材目前沒有掛牌${pending}`;
  return `尚未蒐集的最低掛牌約 ${formatGil(total)}（單價×數量，一次買齊可能更貴）${miss}${pending}`;
}

function marketLine(id) {
  const quote = quoteOf(id);
  if (quote === undefined) return "";
  if (!quote) return "市場板目前沒有這項的掛牌。價格來自 Universalis。";
  const where = quote.worldName ? `，在${quote.worldName}` : "";
  const quality = quote.hq ? "高品質" : "普通品質";
  return `市場最低掛牌 ${formatGil(quote.price)}／個（${quality}${where}）。這是目前最便宜的一筆單價，一次買齊可能更貴。價格來自 Universalis。`;
}

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function blankList(name) {
  return { id: uid(), name, targets: [], pins: [], choices: [], done: [] };
}

function currentList() {
  return state.lists.find((list) => list.id === state.activeListId) || state.lists[0];
}

function syncToList() {
  const list = currentList();
  if (!list) return;
  list.targets = state.targets;
  list.pins = [...state.pins];
  list.choices = [...state.choices];
  list.done = [...state.done];
}

function syncFromList() {
  const list = currentList();
  state.targets = list?.targets || [];
  state.pins = new Set(list?.pins || []);
  state.choices = new Map(list?.choices || []);
  state.done = new Set(list?.done || []);
}

function recipesOf(id) {
  return state.db.recipes[String(id)] || [];
}

function recipeNotes(id) {
  const notes = [];
  for (const entry of recipesOf(id)) {
    if (entry[5] && !notes.includes(entry[5])) notes.push(entry[5]);
  }
  return notes.join(" ");
}

function recipeKind(id) {
  const list = recipesOf(id);
  if (!list.length) return "素材";
  const company = list.some((entry) => entry[1] === 8);
  const normal = list.some((entry) => entry[1] !== 8);
  if (company && normal) return "可製作／合建";
  return company ? "合建" : "可製作";
}

function recipeModel(entry) {
  return {
    id: entry[0],
    job: entry[1],
    yield: entry[2],
    secondary: Boolean(entry[3]),
    ings: entry[4].map(([ingId, amount]) => ({ id: ingId, amount })),
    note: entry[5] || "",
    company: entry[1] === 8,
  };
}

function chosenRecipe(id) {
  if (state.pins.has(id)) return null;
  const list = recipesOf(id);
  if (!list.length) return null;
  const want = state.choices.get(id);
  const found = want ? list.find((entry) => entry[0] === want) : null;
  return recipeModel(found || list[0]);
}

function jobName(job) {
  return state.db.jobs[String(job)] || `職業 ${job}`;
}

function sourceLabel(flags, pinned) {
  if (pinned) return "不拆解";
  const parts = [];
  if (flags & 1) parts.push("採集");
  if (flags & 8) parts.push("潛水艇");
  if (flags & 16) parts.push("飛空艇");
  if (flags & 2) parts.push("兌換");
  if (flags & 4) parts.push("商店");
  if (!parts.length) parts.push("其他");
  return parts.join("／");
}

function groupKey(flags, pinned) {
  if (pinned) return 99;
  if (flags & 1) return 1;
  if (flags & 8) return 2;
  if (flags & 16) return 3;
  if (flags & 2) return 4;
  if (flags & 4) return 5;
  return 6;
}

const GROUP_TITLES = {
  1: "採集",
  2: "潛水艇",
  3: "飛空艇",
  4: "兌換",
  5: "商店",
  6: "其他",
  99: "指定不拆解",
};

function depthOf(id, stack = new Set(), memo = new Map()) {
  if (state.pins.has(id) || !recipesOf(id).length) return 0;
  if (memo.has(id)) return memo.get(id);
  if (stack.has(id) || stack.size > 24) return 0;
  const recipe = chosenRecipe(id);
  if (!recipe) return 0;
  stack.add(id);
  let depth = 0;
  for (const ing of recipe.ings) depth = Math.max(depth, depthOf(ing.id, stack, memo));
  stack.delete(id);
  const value = depth + 1;
  memo.set(id, value);
  return value;
}

function compute() {
  const memo = new Map();
  const demand = new Map();
  for (const target of state.targets) {
    demand.set(target.id, (demand.get(target.id) || 0) + target.qty);
  }

  const involved = new Set(demand.keys());
  const walk = (id) => {
    const recipe = chosenRecipe(id);
    if (!recipe) return;
    for (const ing of recipe.ings) {
      if (!involved.has(ing.id)) {
        involved.add(ing.id);
        walk(ing.id);
      }
    }
  };
  for (const id of [...involved]) walk(id);

  const depth = new Map();
  let maxDepth = 0;
  for (const id of involved) {
    const value = depthOf(id, new Set(), memo);
    depth.set(id, value);
    maxDepth = Math.max(maxDepth, value);
  }

  const layers = new Map();
  for (const id of involved) {
    const value = depth.get(id);
    if (!layers.has(value)) layers.set(value, []);
    layers.get(value).push(id);
  }

  for (let level = maxDepth; level >= 1; level -= 1) {
    for (const id of layers.get(level) || []) {
      const recipe = chosenRecipe(id);
      if (!recipe) continue;
      const need = demand.get(id) || 0;
      const crafts = Math.ceil(need / recipe.yield);
      for (const ing of recipe.ings) {
        demand.set(ing.id, (demand.get(ing.id) || 0) + crafts * ing.amount);
      }
    }
  }

  const edges = [];
  for (const id of involved) {
    const recipe = chosenRecipe(id);
    if (!recipe) continue;
    const crafts = Math.ceil((demand.get(id) || 0) / recipe.yield);
    for (const ing of recipe.ings) {
      edges.push({ from: id, to: ing.id, qty: crafts * ing.amount });
    }
  }

  return { demand, depth, maxDepth, layers, edges };
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function iconHtml(id, name) {
  const info = item(id);
  const url = iconUrl(info?.[1]);
  if (!url) return `<span class="ph">${escapeHtml(name.slice(0, 1))}</span>`;
  return `<img alt="" src="${url}" data-fallback="${escapeHtml(name.slice(0, 1))}">`;
}

function search(query) {
  const text = query.trim();
  if (!text) return [];
  const starts = [];
  const contains = [];
  for (const entry of state.craftable) {
    const nameAt = entry.name.indexOf(text);
    const noteAt = entry.note.indexOf(text);
    if (nameAt === 0) starts.push(entry);
    else if (nameAt > 0 || noteAt >= 0) contains.push(entry);
    if (starts.length >= 20) break;
  }
  return starts.concat(contains).slice(0, 20);
}

function renderResults() {
  const matches = search(els.query.value);
  state.matches = matches;
  state.activeResult = 0;
  if (!matches.length || !els.query.value.trim()) {
    els.results.hidden = true;
    els.results.innerHTML = "";
    return;
  }
  els.results.hidden = false;
  els.results.innerHTML = matches.map((entry, index) => `
    <li>
      <button type="button" data-pick="${entry.id}" class="${index === 0 ? "active" : ""}">
        ${iconHtml(entry.id, entry.name)}
        <span>${escapeHtml(entry.name)}</span>
        <small>${escapeHtml(entry.note || entry.kind)}</small>
      </button>
    </li>
  `).join("");
}

function addTarget(id, qty) {
  const amount = Math.max(1, Math.min(9999, qty || 1));
  const existing = state.targets.find((target) => target.id === id);
  if (existing) existing.qty += amount;
  else state.targets.push({ id, qty: amount });
  els.query.value = "";
  renderResults();
  persist();
  render();
}

function renderList() {
  els.listEmpty.hidden = state.targets.length > 0;
  els.list.innerHTML = state.targets.map((target) => `
    <li class="target">
      ${iconHtml(target.id, itemName(target.id))}
      <span>${escapeHtml(itemName(target.id))}</span>
      <button type="button" class="name-copy" data-copy-name="${target.id}" title="只複製名稱，方便貼到遊戲內搜尋">複製</button>
      <input type="number" min="1" max="9999" value="${target.qty}" data-qty="${target.id}" aria-label="數量">
      <button type="button" class="icon-btn" data-remove="${target.id}" aria-label="移除">×</button>
    </li>
  `).join("");
}

function orderByParents(ids, edges, placed) {
  const score = new Map();
  for (const edge of edges) {
    if (!placed.has(edge.from) || !ids.includes(edge.to)) continue;
    const list = score.get(edge.to) || [];
    list.push(placed.get(edge.from));
    score.set(edge.to, list);
  }
  return [...ids].sort((a, b) => {
    const avg = (id) => {
      const list = score.get(id);
      if (!list?.length) return 9999;
      return list.reduce((sum, value) => sum + value, 0) / list.length;
    };
    const diff = avg(a) - avg(b);
    if (diff) return diff;
    return itemName(a).localeCompare(itemName(b), "zh-Hant");
  });
}

function renderBoard(model) {
  if (!state.targets.length) {
    els.board.innerHTML = `<div class="empty-board">加入想做的成品後，這裡會由左到右展開。最右邊每一格的數量，就是要去採集、兌換或購買的基礎素材合計。</div>`;
    return;
  }

  const placed = new Map();
  const columns = [];
  for (let level = model.maxDepth; level >= 0; level -= 1) {
    let ids = model.layers.get(level) || [];
    ids = ids.filter((id) => (model.demand.get(id) || 0) > 0 && !crystalHidden(id));
    if (level === 0) {
      ids.sort((a, b) => {
        const infoA = item(a);
        const infoB = item(b);
        const group = groupKey(infoA?.[2] || 0, state.pins.has(a)) - groupKey(infoB?.[2] || 0, state.pins.has(b));
        if (group) return group;
        return itemName(a).localeCompare(itemName(b), "zh-Hant");
      });
    } else {
      ids = orderByParents(ids, model.edges, placed);
    }
    ids.forEach((id, index) => placed.set(id, index));
    columns.push({ level, ids });
  }

  const html = columns.map((column) => {
    const isBase = column.level === 0;
    const title = isBase ? "基礎素材" : `合成 ${column.level} 次`;
    const doneCount = isBase ? column.ids.filter((id) => state.done.has(id)).length : 0;
    const priceNote = isBase ? basePriceNote(column.ids) : "";
    const note = isBase
      ? `${column.ids.length} 種，數量已合併${doneCount ? `，已蒐集 ${doneCount}` : ""}${priceNote ? `。${priceNote}` : ""}`
      : "再往右是它的材料";
    let lastGroup = null;
    const cards = column.ids.map((id) => {
      const info = item(id);
      const flags = info?.[2] || 0;
      const pinned = state.pins.has(id);
      const recipe = chosenRecipe(id);
      const need = model.demand.get(id) || 0;
      const leaf = !recipe;
      let groupHtml = "";
      if (isBase) {
        const key = groupKey(flags, pinned);
        if (key !== lastGroup) {
          lastGroup = key;
          const special = key === 2 || key === 3 ? " is-special" : "";
          groupHtml = `<div class="group-label${special}">${GROUP_TITLES[key]}</div>`;
        }
      }
      const crafts = recipe ? Math.ceil(need / recipe.yield) : 0;
      const meta = leaf
        ? sourceLabel(flags, pinned && recipesOf(id).length > 0)
        : recipe.company
          ? `公會合建${recipe.note ? ` · ${recipe.note}` : ""} · ${crafts} 次`
          : `${jobName(recipe.job)} · 做 ${crafts} 次${recipe.yield > 1 ? `，每次 ${recipe.yield}` : ""}`;
      const options = recipesOf(id);
      const recipeSelect = options.length > 1 && !pinned
        ? `<select data-recipe="${id}" aria-label="選擇配方">${options.map((entry) => {
          const modelRecipe = recipeModel(entry);
          const brief = modelRecipe.company
            ? (modelRecipe.note || "公會合建")
            : modelRecipe.ings.slice(0, 2).map((ing) => itemName(ing.id)).join("、");
          const label = `${jobName(modelRecipe.job)} · ${brief}${modelRecipe.secondary ? " · 副配方" : ""}`;
          return `<option value="${modelRecipe.id}" ${recipe && recipe.id === modelRecipe.id ? "selected" : ""}>${escapeHtml(label)}</option>`;
        }).join("")}</select>`
        : "";
      const pinButton = options.length
        ? `<button type="button" data-pin="${id}">${pinned ? "繼續拆解" : "停在這層"}</button>`
        : "";
      const target = state.targets.some((entry) => entry.id === id);
      const done = state.done.has(id);
      const picked = state.sourceId === id;
      return `${groupHtml}
        <article class="card ${leaf ? "is-leaf" : ""} ${target ? "is-target" : ""} ${done ? "is-done" : ""} ${picked ? "is-picked" : ""}" data-card="${id}">
          <label class="done-check" title="標成已蒐集">
            <input type="checkbox" data-done="${id}" ${done ? "checked" : ""} aria-label="已蒐集">
          </label>
          ${iconHtml(id, itemName(id))}
          <div class="card-body">
            <div class="name-row">
              <div class="name">${escapeHtml(itemName(id))}</div>
              <button type="button" class="name-copy" data-copy-name="${id}" title="只複製名稱，方便貼到遊戲內搜尋">複製</button>
            </div>
            <div class="meta">${escapeHtml(meta)}</div>
            ${priceHtml(id)}
          </div>
          <div class="qty">×${need}</div>
          ${recipeSelect || pinButton ? `<div class="card-actions">${recipeSelect}${pinButton}</div>` : ""}
        </article>`;
    }).join("");
    const copy = isBase ? `<button type="button" class="copy" id="copy-base">複製這一欄</button>` : "";
    return `<section class="col ${isBase ? "is-base" : ""}" data-level="${column.level}">
      <header class="col-head">
        <h2>${title}</h2>
        <p>${note}</p>
        ${copy}
      </header>
      ${cards || `<p class="hint">這一層沒有項目</p>`}
    </section>`;
  }).join("");

  els.board.innerHTML = `${html}<svg class="links" id="links"></svg>`;
  state.model = model;
  requestAnimationFrame(drawLinks);
}

function drawLinks() {
  const svg = document.querySelector("#links");
  const model = state.model;
  if (!svg || !model) return;
  const cards = new Map();
  for (const card of els.board.querySelectorAll("[data-card]")) {
    cards.set(Number(card.dataset.card), card);
  }
  const boardRect = els.board.getBoundingClientRect();
  svg.setAttribute("width", String(els.board.scrollWidth));
  svg.setAttribute("height", String(els.board.scrollHeight));
  const rects = new Map();
  const rectOf = (id) => {
    if (rects.has(id)) return rects.get(id);
    const card = cards.get(id);
    if (!card) return null;
    const rect = card.getBoundingClientRect();
    rects.set(id, rect);
    return rect;
  };
  svg.innerHTML = model.edges.map((edge) => {
    if (crystalHidden(edge.from) || crystalHidden(edge.to)) return "";
    const a = rectOf(edge.from);
    const b = rectOf(edge.to);
    if (!a || !b) return "";
    const x1 = a.right - boardRect.left;
    const y1 = a.top - boardRect.top + a.height / 2;
    const x2 = b.left - boardRect.left;
    const y2 = b.top - boardRect.top + b.height / 2;
    const bend = Math.max(24, (x2 - x1) / 2);
    return `<path class="link" data-from="${edge.from}" data-to="${edge.to}" d="M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}"></path>`;
  }).join("");
  paintHover();
}

let hoverTimer = 0;

function paintHover() {
  const svg = document.querySelector("#links");
  const model = state.model;
  if (!svg || !model) return;
  const hot = state.hover == null ? null : relatedIds(state.hover, model.edges);
  for (const path of svg.querySelectorAll("path")) {
    const on = Boolean(hot && hot.has(Number(path.dataset.from)) && hot.has(Number(path.dataset.to)));
    path.classList.toggle("is-hot", on);
    path.classList.toggle("is-dim", Boolean(hot) && !on);
  }
  for (const card of els.board.querySelectorAll("[data-card]")) {
    const on = Boolean(hot && hot.has(Number(card.dataset.card)));
    card.classList.toggle("is-hot", on);
    card.classList.toggle("is-dim", Boolean(hot) && !on);
  }
}

function queueHover(id) {
  state.hover = id;
  clearTimeout(hoverTimer);
  hoverTimer = setTimeout(() => {
    if (state.hover !== id) return;
    showDetail(id);
    paintHover();
  }, 80);
}

function relatedIds(id, edges) {
  const set = new Set([id]);
  const down = [id];
  while (down.length) {
    const current = down.pop();
    for (const edge of edges) {
      if (edge.from === current && !set.has(edge.to)) {
        set.add(edge.to);
        down.push(edge.to);
      }
    }
  }
  const up = [id];
  while (up.length) {
    const current = up.pop();
    for (const edge of edges) {
      if (edge.to === current && !set.has(edge.from)) {
        set.add(edge.from);
        up.push(edge.from);
      }
    }
  }
  return set;
}

function showDetail(id) {
  const model = state.model;
  if (!model || !item(id)) {
    els.detail.hidden = true;
    return;
  }
  const need = model.demand.get(id) || 0;
  const incoming = model.edges.filter((edge) => edge.to === id);
  const uses = incoming.length
    ? incoming.map((edge) => `${itemName(edge.from)} ×${edge.qty}`).join("、")
    : "這是清單上的成品";
  const flags = item(id)?.[2] || 0;
  const pinned = state.pins.has(id);
  els.detail.hidden = false;
  els.detailBody.textContent = `${itemName(id)} ×${need}（${chosenRecipe(id) ? jobName(chosenRecipe(id).job) : sourceLabel(flags, pinned)}）。用於：${uses}`;
}

function hideSource() {
  state.sourceId = null;
  if (!els.source) return;
  els.source.hidden = true;
  els.sourceBody.innerHTML = "";
}

const NODE_ICON = { m: 60438, q: 60437, l: 60433, h: 60432, f: 60439, s: 60929 };
const NODE_LABEL = { m: "採掘", q: "碎石", l: "採伐", h: "割草", f: "釣魚", s: "刺魚", b: "商店", t: "兌換" };

function pointParts(point) {
  const [mapId, zone, x, y, spot, kind = "", ae = "", aeX = 0, aeY = 0, detail = ""] = point;
  return {
    mapId,
    zone: zone || "",
    x: Number(x),
    y: Number(y),
    spot: spot || "",
    kind,
    ae: ae || "",
    aeX: Number(aeX) || 0,
    aeY: Number(aeY) || 0,
    detail: detail || "",
    aeBig: point.length > 10 ? Number(point[10]) === 1 : Boolean(ae),
  };
}

function mapUrl(mapId) {
  const [region, index] = String(mapId).split("/");
  if (!region || !index) return "";
  return `https://v2.xivapi.com/api/asset/map/${encodeURIComponent(region)}/${encodeURIComponent(index)}`;
}

function pinStyle(x, y) {
  return `left:${((x / 41) * 100).toFixed(2)}%;top:${((y / 41) * 100).toFixed(2)}%`;
}

function mapHtml(points, bare) {
  if (!points?.length) return "";
  const groups = new Map();
  for (const point of points) {
    const pin = pointParts(point);
    if (!pin.mapId || !Number.isFinite(pin.x)) continue;
    if (!groups.has(pin.mapId)) groups.set(pin.mapId, { zone: pin.zone, pins: [], aes: new Map() });
    const group = groups.get(pin.mapId);
    if (!group.zone && pin.zone) group.zone = pin.zone;
    group.pins.push(pin);
    if (pin.ae && pin.aeX && pin.aeY) {
      group.aes.set(`${pin.ae}|${pin.aeX}|${pin.aeY}`, pin);
    }
  }
  const cards = [...groups.entries()].slice(0, 6).map(([mapId, group]) => {
    const nodes = group.pins.slice(0, 12).map((pin) => {
      const where = `${pin.spot || group.zone}　(${pin.x.toFixed(1)}, ${pin.y.toFixed(1)})`;
      const aeLabel = pin.ae ? (pin.aeBig ? "最近的乙太之光" : "最近的傳送點") : "";
      const ae = pin.ae ? `　${aeLabel}：${pin.ae}` : "";
      const label = escapeHtml(where + ae);
      const icon = NODE_ICON[pin.kind];
      if (icon) {
        return `<span class="map-pin icon" style="${pinStyle(pin.x, pin.y)}" title="${label}"><img src="${iconUrl(icon)}" alt=""></span>`;
      }
      const tone = pin.kind === "t" ? "trade" : pin.kind === "b" ? "shop" : "";
      return `<span class="map-pin ${tone}" style="${pinStyle(pin.x, pin.y)}" title="${label}"></span>`;
    }).join("");
    const crystals = [...group.aes.values()].map((pin) => {
      const kind = pin.aeBig ? "乙太之光" : "傳送點";
      const label = escapeHtml(`${kind}　${pin.ae}　(${pin.aeX.toFixed(1)}, ${pin.aeY.toFixed(1)})`);
      return `<span class="map-pin ae" style="${pinStyle(pin.aeX, pin.aeY)}" title="${label}"><img src="${iconUrl(60453)}" alt=""></span>`;
    }).join("");
    return `<figure class="source-map">
      <figcaption>${escapeHtml(group.zone || "地圖")}</figcaption>
      <div class="map-frame">
        <img src="${mapUrl(mapId)}" alt="${escapeHtml(group.zone || "地圖")}" loading="lazy" referrerpolicy="no-referrer">
        ${nodes}${crystals}
      </div>
    </figure>`;
  }).join("");
  const extra = groups.size - 6;
  const more = extra > 0 ? `<p class="note">另外還有 ${extra} 張地圖，地點列在下面。</p>` : "";
  if (bare) return `${cards}${more}`;
  const legend = `<p class="map-legend"><img src="${iconUrl(60453)}" alt="">乙太之光　<img src="${iconUrl(60438)}" alt="">採集點　<span class="legend-node"></span>商店或兌換</p>`;
  return `<h3>地圖</h3>${legend}${cards}${more}`;
}

function locateCard(pin) {
  const label = NODE_LABEL[pin.kind] || "";
  const icon = NODE_ICON[pin.kind];
  const iconHtml = icon
    ? `<img class="locate-icon" src="${iconUrl(icon)}" alt="">`
    : `<span class="locate-mark ${pin.kind === "t" ? "is-trade" : ""}"></span>`;
  const meta = pin.kind === "b" || pin.kind === "t"
    ? [pin.detail, pin.zone].filter(Boolean).join("　")
    : [label, pin.detail, pin.zone].filter(Boolean).join("　");
  const aeTitle = pin.aeBig ? "最近的乙太之光" : "最近的傳送點";
  const ae = pin.ae
    ? `<div class="locate-ae" title="${aeTitle}"><img src="${iconUrl(60453)}" alt=""><span>${escapeHtml(pin.ae)}</span></div>`
    : "";
  return `<article class="locate">${iconHtml}<div><div class="locate-name">${escapeHtml(pin.spot || pin.zone)}</div><div class="locate-sub">${escapeHtml(meta)}</div><div class="locate-xy"><span>X</span> ${pin.x.toFixed(1)}　<span>Y</span> ${pin.y.toFixed(1)}</div>${ae}</div></article>`;
}

const FOLD_AT = 2;

function locateHtml(points, kinds, foldedExtra = "") {
  const rows = points.filter((point) => kinds.includes(point[5])).map(pointParts);
  if (!rows.length) return foldedExtra;
  const cards = rows.map(locateCard);
  if (kinds.length !== 1 || kinds[0] !== "t" || cards.length <= FOLD_AT) {
    return `<div class="locate-list">${cards.join("")}</div>${foldedExtra}`;
  }
  const extra = cards.length - FOLD_AT;
  return `<div class="locate-list">${cards.slice(0, FOLD_AT).join("")}<details class="fold"><summary><span class="when-closed">展開其餘 ${extra} 處</span><span class="when-open">收合</span></summary>${foldedExtra}<div class="locate-list">${cards.slice(FOLD_AT).join("")}</div></details></div>`;
}

function lineListHtml(rows, fold) {
  if (!rows?.length) return "";
  const items = rows.map((row) => `<li>${escapeHtml(row)}</li>`);
  if (!fold || items.length <= FOLD_AT) return `<ul class="source-list">${items.join("")}</ul>`;
  const extra = items.length - FOLD_AT;
  return `<ul class="source-list">${items.slice(0, FOLD_AT).join("")}<li class="fold-li"><details class="fold"><summary><span class="when-closed">展開其餘 ${extra} 種</span><span class="when-open">收合</span></summary><ul class="source-list">${items.slice(FOLD_AT).join("")}</ul></details></li></ul>`;
}

function sourceHtml(id) {
  const entry = state.db?.sources?.[String(id)];
  const points = entry?.p || [];
  const tradePoints = points.filter((point) => point[5] === "t");
  const otherPoints = points.filter((point) => point[5] !== "t");
  const shownTrade = tradePoints.slice(0, FOLD_AT);
  const visibleMapIds = new Set([...otherPoints, ...shownTrade].map((point) => point[0]));
  const extraMapPoints = tradePoints.slice(FOLD_AT).filter((point) => !visibleMapIds.has(point[0]));
  const tradeCards = locateHtml(tradePoints, ["t"], mapHtml(extraMapPoints, true));
  const shopCards = locateHtml(points, ["b"]);
  const sections = [
    ["採集", locateHtml(points, ["m", "q", "l", "h"]), entry?.g, "", false],
    ["釣魚", locateHtml(points, ["f"]), entry?.f, "", false],
    ["刺魚", locateHtml(points, ["s"]), entry?.s, "", false],
    ["兌換", tradeCards, entry?.t, tradeCards ? "" : "這幾筆兌換沒有對到商人的站點。", true],
    ["潛水艇", "", entry?.u, "客戶端沒有公布掉落機率。下面這些海域的回報裡包含這項素材。", false],
    ["飛空艇", "", entry?.a, "客戶端沒有公布掉落機率。下面這些航點的回報裡包含這項素材。", false],
    ["商店", shopCards, entry?.b, "", false],
  ];
  const blocks = [];
  for (const [title, cards, rows, note, fold] of sections) {
    if (!cards && !rows?.length) continue;
    const items = lineListHtml(rows, fold);
    blocks.push(`<h3>${title}</h3>${note ? `<p class="note">${note}</p>` : ""}${cards}${items}`);
  }
  const maps = mapHtml([...otherPoints, ...shownTrade]);
  if (blocks.length || maps) return `${maps}${blocks.join("")}`;
  if (recipesOf(id).length) {
    return `<p class="note">這是製作產物。點同一條鏈上的基礎素材，可以看採集點、兌換或航行海域。</p>`;
  }
  return `<p class="note">沒有查到採集點、兌換、商店或航行紀錄。</p>`;
}

function refreshSourcePrice(id) {
  if (!els.sourceBody) return;
  const text = marketLine(id);
  let line = els.sourceBody.querySelector(".market-line");
  if (!text) {
    line?.remove();
    return;
  }
  if (!line) {
    line = document.createElement("p");
    line.className = "market-line";
    els.sourceBody.prepend(line);
  }
  line.textContent = text;
}

function showSource(id) {
  if (!els.source || id == null || !item(id)) {
    hideSource();
    return;
  }
  const same = state.sourceId === id && !els.source.hidden && els.sourceBody.childElementCount > 0;
  state.sourceId = id;
  els.source.hidden = false;
  els.sourceTitle.textContent = itemName(id);
  if (!same) {
    els.sourceBody.innerHTML = sourceHtml(id);
    for (const img of els.sourceBody.querySelectorAll(".map-frame img")) {
      img.addEventListener("error", () => {
        const figure = img.closest(".source-map");
        if (!figure) return;
        const note = document.createElement("p");
        note.className = "note";
        note.textContent = `${figure.querySelector("figcaption")?.textContent || "這張地圖"}暫時載入不到。`;
        figure.replaceWith(note);
      });
    }
  }
  refreshSourcePrice(id);
}

function renderTabs() {
  if (!els.tabs) return;
  const tabs = state.lists.map((list) => {
    const active = list.id === state.activeListId;
    const remove = state.lists.length > 1 && active
      ? `<span class="tab-x" data-delete-list="${list.id}" aria-label="刪除清單">×</span>`
      : "";
    return `<button type="button" class="tab ${active ? "is-active" : ""}" data-list="${list.id}" title="點一下切換"><span class="tab-label">${escapeHtml(list.name)}</span>${remove}</button>`;
  }).join("");
  els.tabs.innerHTML = `${tabs}<button type="button" class="tab add" id="add-list" title="新增清單">＋</button>`;
}

function render() {
  const left = els.scroll.scrollLeft;
  const top = els.scroll.scrollTop;
  if (els.hideCrystals) els.hideCrystals.checked = state.hideCrystals;
  if (els.marketWorld && document.activeElement !== els.marketWorld) {
    els.marketWorld.value = state.marketWorld;
  }
  if (els.marketBtn) els.marketBtn.disabled = state.priceBusy;
  if (els.listName && document.activeElement !== els.listName) {
    els.listName.value = currentList()?.name || "";
  }
  renderTabs();
  renderList();
  if (!state.db) return;
  const model = state.targets.length ? compute() : null;
  state.model = model;
  renderBoard(model || { edges: [] });
  els.scroll.scrollLeft = left;
  els.scroll.scrollTop = top;
  if (state.hover != null) showDetail(state.hover);
  if (state.sourceId != null) showSource(state.sourceId);
}

function baseLines() {
  const model = state.model;
  if (!model) return [];
  return (model.layers.get(0) || [])
    .filter((id) => (model.demand.get(id) || 0) > 0 && !crystalHidden(id) && !state.done.has(id))
    .sort((a, b) => itemName(a).localeCompare(itemName(b), "zh-Hant"))
    .map((id) => {
      const flags = item(id)?.[2] || 0;
      const pinned = state.pins.has(id);
      const price = priceText(id);
      const priceBit = price && price !== "沒有掛牌" ? `　${price}` : "";
      return `${itemName(id)} ×${model.demand.get(id)}　${sourceLabel(flags, pinned && recipesOf(id).length > 0)}${priceBit}`;
    });
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function flashButton(button, label) {
  if (!button) return;
  const previous = button.textContent;
  button.textContent = label;
  setTimeout(() => { button.textContent = previous; }, 1200);
}

async function copyName(id, button) {
  const name = itemName(id);
  if (!name) return;
  flashButton(button, await copyText(name) ? "已複製" : "失敗");
}

function pendingBaseIds() {
  const model = state.model;
  if (!model) return [];
  return (model.layers.get(0) || [])
    .filter((id) => (model.demand.get(id) || 0) > 0 && !crystalHidden(id) && !state.done.has(id))
    .sort((a, b) => itemName(a).localeCompare(itemName(b), "zh-Hant"));
}

function pendingRecipeIds() {
  const model = state.model;
  if (!model) return [];
  const levels = [...model.layers.keys()].filter((level) => level > 0).sort((a, b) => b - a);
  const ids = [];
  for (const level of levels) {
    const column = [...(model.layers.get(level) || [])].sort((a, b) => itemName(a).localeCompare(itemName(b), "zh-Hant"));
    for (const id of column) {
      if ((model.demand.get(id) || 0) <= 0 || crystalHidden(id) || state.done.has(id) || state.pins.has(id)) continue;
      if (!chosenRecipe(id)) continue;
      ids.push(id);
    }
  }
  return ids;
}

async function copyNameList(ids, button, emptyLabel) {
  if (!ids.length) {
    flashButton(button, emptyLabel);
    return;
  }
  const ok = await copyText(ids.map((id) => itemName(id)).join("\n"));
  flashButton(button, ok ? "已複製" : "失敗");
}

async function copyBase() {
  const lines = ["基礎素材（尚未蒐集）", ...baseLines()];
  const button = document.querySelector("#copy-base");
  flashButton(button, await copyText(lines.join("\n")) ? "已複製" : "失敗");
}

let lastPayload = null;
let remoteTimer = 0;

function snapshot() {
  syncToList();
  return {
    savedAt: Date.now(),
    hideCrystals: state.hideCrystals,
    marketWorld: state.marketWorld,
    active: state.activeListId,
    lists: state.lists,
  };
}

function writeLocal(payload) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* 瀏覽器拒絕寫入時，仍會寫到 data/lists.json */
  }
}

function pushRemote(payload) {
  fetch("./api/state", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => {});
}

function persist() {
  if (!state.hydrated) return;
  lastPayload = snapshot();
  writeLocal(lastPayload);
  clearTimeout(remoteTimer);
  remoteTimer = setTimeout(() => pushRemote(lastPayload), 200);
}

function flushPersist() {
  if (!state.hydrated) return;
  clearTimeout(remoteTimer);
  lastPayload = snapshot();
  writeLocal(lastPayload);
  pushRemote(lastPayload);
}

function knownItem(id) {
  return Boolean(state.db?.items?.[String(id)]);
}

function sanitizeList(list) {
  const keep = (id) => !state.db || knownItem(id);
  return {
    id: String(list.id || uid()),
    name: String(list.name || "清單").trim().slice(0, 24) || "清單",
    targets: (list.targets || []).filter((target) => target && Number(target.qty) > 0 && keep(target.id)),
    pins: (list.pins || []).map(Number).filter(keep),
    choices: (list.choices || [])
      .map(([id, recipeId]) => [Number(id), Number(recipeId)])
      .filter(([id]) => keep(id)),
    done: (list.done || []).map(Number).filter(keep),
  };
}

function richness(data) {
  if (!data || typeof data !== "object") return -1;
  if (Array.isArray(data.lists)) {
    return data.lists.reduce((sum, list) => sum + ((list.targets || []).length), 0);
  }
  if (Array.isArray(data.targets)) return data.targets.length;
  return -1;
}

function chooseSaved(local, remote) {
  const localScore = richness(local);
  const remoteScore = richness(remote);
  if (remoteScore < 0) return localScore < 0 ? {} : local;
  if (localScore < 0) return remote;
  const remoteAt = remote.savedAt || 0;
  const localAt = local.savedAt || 0;
  if (!localAt && localScore > remoteScore) return local;
  if (remoteAt !== localAt) return remoteAt > localAt ? remote : local;
  return localScore >= remoteScore ? local : remote;
}

async function loadSaved() {
  let local = {};
  try {
    local = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    local = {};
  }
  let remote = null;
  try {
    const response = await fetch("./api/state", { cache: "no-store" });
    if (response.ok) remote = await response.json();
  } catch {
    remote = null;
  }
  return chooseSaved(local, remote);
}

function restore(data = {}) {
  const legacy = !Array.isArray(data.lists);
  const source = legacy
    ? [{
      id: uid(),
      name: "清單 1",
      targets: data.targets || [],
      pins: data.pins || [],
      choices: data.choices || [],
      done: [],
    }]
    : data.lists;
  state.hideCrystals = Boolean(data.hideCrystals);
  state.marketWorld = MARKET_WORLDS.includes(data.marketWorld) ? data.marketWorld : "陸行鳥";
  state.lists = source.map(sanitizeList);
  if (!state.lists.length) state.lists = [blankList("清單 1")];
  state.activeListId = state.lists.some((list) => list.id === data.active)
    ? data.active
    : state.lists[0].id;
  syncFromList();
}

async function loadPrices() {
  if (state.priceBusy) return;
  const button = els.marketBtn;
  const model = state.model;
  if (!model || !state.targets.length) {
    flashButton(button, "沒有清單");
    return;
  }
  const ids = [];
  for (const list of model.layers.values()) {
    for (const id of list) {
      if ((model.demand.get(id) || 0) > 0 && !crystalHidden(id)) ids.push(id);
    }
  }
  const unique = [...new Set(ids)];
  if (!unique.length) {
    flashButton(button, "沒有素材");
    return;
  }
  state.priceBusy = true;
  if (button) button.disabled = true;
  const world = state.marketWorld;
  let got = false;
  let failed = false;
  try {
    for (let index = 0; index < unique.length; index += 100) {
      const chunk = unique.slice(index, index + 100);
      const url = `https://universalis.app/api/v2/aggregated/${encodeURIComponent(world)}/${chunk.join(",")}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json();
      for (const row of data.results || []) {
        if (!row || row.itemId == null) continue;
        state.prices.set(`${world}:${row.itemId}`, row);
        got = true;
      }
      for (const missing of data.failedItems || []) {
        state.prices.set(`${world}:${missing}`, null);
        got = true;
      }
    }
  } catch {
    failed = true;
  }
  state.priceBusy = false;
  render();
  flashButton(button, failed ? "失敗" : (got ? "已更新" : "沒有掛牌"));
}

function bind() {
  els.query.addEventListener("input", renderResults);
  els.form.addEventListener("submit", (event) => {
    event.preventDefault();
    const picked = state.matches[state.activeResult] || state.matches[0];
    if (picked) addTarget(picked.id, Number(els.qty.value));
  });
  els.query.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      state.activeResult = (state.activeResult + delta + state.matches.length) % Math.max(state.matches.length, 1);
      for (const [index, button] of [...els.results.querySelectorAll("button")].entries()) {
        button.classList.toggle("active", index === state.activeResult);
      }
    }
  });
  els.results.addEventListener("mousedown", (event) => event.preventDefault());
  els.results.addEventListener("click", (event) => {
    const button = event.target.closest("[data-pick]");
    if (!button) return;
    addTarget(Number(button.dataset.pick), Number(els.qty.value));
  });
  els.list.addEventListener("change", (event) => {
    const input = event.target.closest("[data-qty]");
    if (!input) return;
    const target = state.targets.find((entry) => entry.id === Number(input.dataset.qty));
    if (!target) return;
    target.qty = Math.max(1, Math.min(9999, Number(input.value) || 1));
    input.value = String(target.qty);
    persist();
    render();
  });
  els.list.addEventListener("click", (event) => {
    const copy = event.target.closest("[data-copy-name]");
    if (copy) {
      copyName(Number(copy.dataset.copyName), copy);
      return;
    }
    const button = event.target.closest("[data-remove]");
    if (!button) return;
    state.targets = state.targets.filter((entry) => entry.id !== Number(button.dataset.remove));
    persist();
    render();
  });
  els.clear.addEventListener("click", () => {
    state.targets = [];
    state.pins.clear();
    state.choices.clear();
    state.done.clear();
    state.hover = null;
    hideSource();
    persist();
    render();
    els.detail.hidden = true;
  });
  els.board.addEventListener("click", (event) => {
    const copy = event.target.closest("[data-copy-name]");
    if (copy) {
      copyName(Number(copy.dataset.copyName), copy);
      return;
    }
    const pin = event.target.closest("[data-pin]");
    if (pin) {
      const id = Number(pin.dataset.pin);
      if (state.pins.has(id)) state.pins.delete(id);
      else state.pins.add(id);
      persist();
      render();
      return;
    }
    const card = event.target.closest("[data-card]");
    if (card) {
      clearTimeout(hoverTimer);
      state.hover = Number(card.dataset.card);
      showDetail(state.hover);
      showSource(state.hover);
      for (const picked of els.board.querySelectorAll(".is-picked")) picked.classList.remove("is-picked");
      card.classList.add("is-picked");
      paintHover();
    }
  });
  els.board.addEventListener("change", (event) => {
    const done = event.target.closest("[data-done]");
    if (done) {
      const id = Number(done.dataset.done);
      if (done.checked) state.done.add(id);
      else state.done.delete(id);
      persist();
      render();
      return;
    }
    const select = event.target.closest("[data-recipe]");
    if (!select) return;
    state.choices.set(Number(select.dataset.recipe), Number(select.value));
    persist();
    render();
  });
  els.board.addEventListener("mouseover", (event) => {
    const card = event.target.closest("[data-card]");
    if (!card) return;
    const id = Number(card.dataset.card);
    if (state.hover === id) return;
    queueHover(id);
  });
  els.board.addEventListener("error", (event) => {
    if (event.target.tagName !== "IMG") return;
    const span = document.createElement("span");
    span.className = "ph";
    span.textContent = event.target.dataset.fallback || "？";
    event.target.replaceWith(span);
  }, true);
  els.hideCrystals.addEventListener("change", () => {
    state.hideCrystals = els.hideCrystals.checked;
    persist();
    render();
  });
  els.marketWorld?.addEventListener("change", () => {
    state.marketWorld = MARKET_WORLDS.includes(els.marketWorld.value) ? els.marketWorld.value : "陸行鳥";
    persist();
    render();
  });
  els.marketBtn?.addEventListener("click", () => {
    loadPrices();
  });
  els.tabs.addEventListener("click", (event) => {
    if (event.target.closest("#add-list")) {
      syncToList();
      const list = blankList(`清單 ${state.lists.length + 1}`);
      state.lists.push(list);
      state.activeListId = list.id;
      syncFromList();
      state.hover = null;
      hideSource();
      els.detail.hidden = true;
      persist();
      render();
      els.listName.focus();
      els.listName.select();
      return;
    }
    const remove = event.target.closest("[data-delete-list]");
    if (remove) {
      if (state.lists.length < 2) return;
      syncToList();
      const index = state.lists.findIndex((list) => list.id === remove.dataset.deleteList);
      if (index < 0) return;
      state.lists.splice(index, 1);
      state.activeListId = state.lists[Math.max(0, index - 1)].id;
      syncFromList();
      state.hover = null;
      hideSource();
      els.detail.hidden = true;
      persist();
      render();
      return;
    }
    const tab = event.target.closest("[data-list]");
    if (!tab || tab.dataset.list === state.activeListId) return;
    syncToList();
    state.activeListId = tab.dataset.list;
    syncFromList();
    state.hover = null;
    hideSource();
    els.detail.hidden = true;
    persist();
    render();
  });
  els.tabs.addEventListener("dblclick", (event) => {
    const tab = event.target.closest("[data-list]");
    if (!tab || event.target.closest("[data-delete-list]")) return;
    const list = state.lists.find((entry) => entry.id === tab.dataset.list);
    if (!list) return;
    const input = document.createElement("input");
    input.className = "tab-rename";
    input.value = list.name;
    input.setAttribute("aria-label", "清單名稱");
    tab.replaceWith(input);
    input.focus();
    input.select();
    let closed = false;
    const finish = () => {
      if (closed) return;
      closed = true;
      list.name = input.value.trim().slice(0, 24) || list.name;
      if (els.listName) els.listName.value = list.name;
      persist();
      renderTabs();
    };
    input.addEventListener("keydown", (keyEvent) => {
      if (keyEvent.key !== "Enter" && keyEvent.key !== "Escape") return;
      keyEvent.preventDefault();
      if (keyEvent.key === "Escape") input.value = list.name;
      input.blur();
    });
    input.addEventListener("blur", finish);
  });
  const applyListName = (commit) => {
    const list = currentList();
    if (!list || !els.listName) return;
    const raw = els.listName.value.slice(0, 24);
    const name = commit ? (raw.trim() || "未命名") : raw;
    list.name = name;
    if (commit) els.listName.value = name;
    const label = els.tabs.querySelector(`[data-list="${list.id}"] .tab-label`);
    if (label) label.textContent = name.trim() || "未命名";
    persist();
  };
  els.listName.addEventListener("input", () => applyListName(false));
  els.listName.addEventListener("blur", () => applyListName(true));
  els.listName.addEventListener("keydown", (event) => {
    if (event.isComposing || event.key !== "Enter") return;
    event.preventDefault();
    els.listName.blur();
  });
  els.copyMaterials.addEventListener("click", () => {
    copyNameList(pendingBaseIds(), els.copyMaterials, "沒有素材");
  });
  els.copyRecipes.addEventListener("click", () => {
    copyNameList(pendingRecipeIds(), els.copyRecipes, "沒有配方");
  });
  els.sourceCopy.addEventListener("click", () => {
    if (state.sourceId == null) return;
    copyName(state.sourceId, els.sourceCopy);
  });
  els.sourceClose.addEventListener("click", () => {
    hideSource();
    for (const picked of els.board.querySelectorAll(".is-picked")) picked.classList.remove("is-picked");
  });
  els.jump.addEventListener("click", () => {
    const column = els.board.querySelector(".is-base");
    if (column) column.scrollIntoView({ inline: "end", block: "nearest", behavior: "smooth" });
  });
  els.board.addEventListener("click", (event) => {
    if (event.target.closest("#copy-base")) copyBase();
  });
  window.addEventListener("pagehide", flushPersist);
  window.addEventListener("resize", () => requestAnimationFrame(drawLinks));
  if (window.ResizeObserver) {
    const observer = new ResizeObserver(() => requestAnimationFrame(drawLinks));
    observer.observe(els.board);
  }
}

async function boot() {
  bind();
  const savedPromise = loadSaved();
  try {
    const response = await fetch("./data/craft.json", { cache: "no-store" });
    if (!response.ok) throw new Error(String(response.status));
    state.db = await response.json();
  } catch {
    els.board.innerHTML = `<div class="empty-board">找不到配方資料。請在專案目錄執行 python scripts/build_data.py 後重新整理。</div>`;
  }
  const saved = await savedPromise;
  if (state.db) {
    state.craftable = Object.entries(state.db.items).map(([id, info]) => ({
      id: Number(id),
      name: info[0],
      craftable: Boolean(state.db.recipes[id]),
      kind: recipeKind(id),
      note: recipeNotes(id),
    }));
    state.craftable.sort((a, b) => Number(b.craftable) - Number(a.craftable) || a.name.localeCompare(b.name, "zh-Hant"));
    els.footnote.textContent = `繁中資料 ${state.db.version} · ${state.db.source}。道具名稱來自遊戲資料，© SQUARE ENIX。本工具為非官方。`;
  }
  restore(saved);
  state.hydrated = true;
  render();
  flushPersist();
}

boot();

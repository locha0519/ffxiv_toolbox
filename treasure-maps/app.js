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
  filter: "all",
  marketWorld: "陸行鳥",
  prices: new Map(),
  includePortal: true,
  portalScale: 1,
  selected: null,
  busy: false,
};

const els = {
  board: document.querySelector("#board"),
  summary: document.querySelector("#summary"),
  tabs: document.querySelector("#tabs"),
  marketWorld: document.querySelector("#market-world"),
  marketBtn: document.querySelector("#market-btn"),
  includePortal: document.querySelector("#include-portal"),
  portalScale: document.querySelector("#portal-scale"),
  status: document.querySelector("#status"),
  detail: document.querySelector("#detail"),
  detailBackdrop: document.querySelector("#detail-backdrop"),
  detailTitle: document.querySelector("#detail-title"),
  detailBody: document.querySelector("#detail-body"),
  detailClose: document.querySelector("#detail-close"),
  footnote: document.querySelector("#footnote"),
};

function closeDetail() {
  state.selected = null;
  els.detail.hidden = true;
  if (els.detailBackdrop) els.detailBackdrop.hidden = true;
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatGil(amount) {
  if (!Number.isFinite(amount)) return "—";
  return `${Math.round(amount).toLocaleString("zh-Hant")} 金幣`;
}

function marketScope() {
  return state.marketWorld === "陸行鳥" ? "dc" : "world";
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
  return {
    price: picked.price,
    hq: !nq,
    worldName: state.marketWorld === "陸行鳥" ? MARKET_WORLD_NAMES[picked.worldId] || "" : "",
  };
}

function priceOf(id) {
  if (!id) return null;
  if (!state.prices.has(id)) return undefined;
  return quoteFrom(state.prices.get(id));
}

function itemName(id) {
  return state.db.items[String(id)] || `道具 ${id}`;
}

function iconUrl(icon = 25930) {
  const name = String(icon).padStart(6, "0");
  return `https://xivapi.com/i/${name.slice(0, 3)}000/${name}.png`;
}

function weightedMateriaAvg() {
  const list = state.db.materiaXi || [];
  let weight = 0;
  let sum = 0;
  let known = 0;
  for (const entry of list) {
    const quote = priceOf(entry.id);
    if (!quote) continue;
    weight += entry.weight;
    sum += quote.price * entry.weight;
    known += 1;
  }
  if (!weight) return { avg: 0, known: 0 };
  return { avg: sum / weight, known };
}

function crystalAvg(ids) {
  let sum = 0;
  let n = 0;
  for (const id of ids) {
    const quote = priceOf(id);
    if (!quote) continue;
    sum += quote.price;
    n += 1;
  }
  return n ? sum / n : 0;
}

function computeEv(map) {
  const model = map.evModel;
  if (!model) return null;

  const mapQuote = priceOf(map.id);
  const mapCost = map.tradeable === false ? 0 : mapQuote?.price ?? null;

  const triple = 1 + 2 * (model.gil?.tripleRate || 0);
  const gilEv = (model.gil?.base || 0) * triple;

  const crystalUnit = crystalAvg(state.db.crystals);
  const clusterUnit = crystalAvg(state.db.clusters);
  const cRate = model.crystalQty?.clusterRate || 0;
  const cQty = model.crystalQty?.avg || 0;
  const crystalEv = cQty * ((1 - cRate) * crystalUnit + cRate * clusterUnit * 1.15);

  const materia = weightedMateriaAvg();
  const materiaEv = (model.materiaRate || 0) * materia.avg;

  const materialEv = model.materialGilEstimate || 0;

  let rareEv = 0;
  const rareLines = [];
  for (const rare of model.rares || []) {
    const quote = priceOf(rare.id);
    const unit = quote?.price;
    const lineEv = unit == null ? null : unit * rare.perMap * (rare.qty || 1);
    if (lineEv != null) rareEv += lineEv;
    rareLines.push({
      ...rare,
      unit,
      lineEv,
      missing: unit == null,
    });
  }

  const portalChance = map.portal?.chance || 0;
  const portalBase = model.portalExtraGil || 0;
  const portalEv = state.includePortal
    ? portalChance * portalBase * state.portalScale
    : 0;

  const gross = gilEv + crystalEv + materiaEv + materialEv + rareEv + portalEv;
  const net = mapCost == null ? null : gross - mapCost;

  const tomestoneQty = (model.tomestone?.qty || 0) * (1 + 2 * (model.tomestone?.tripleRate || 0));

  return {
    mapCost,
    gilEv,
    crystalEv,
    materiaEv,
    materialEv,
    rareEv,
    rareLines,
    portalEv,
    portalChance,
    gross,
    net,
    tomestone: model.tomestone
      ? { id: model.tomestone.id, qty: tomestoneQty, name: itemName(model.tomestone.id) }
      : null,
    missingPrices: rareLines.some((line) => line.missing) || mapCost == null && map.tradeable !== false,
  };
}

function filteredMaps() {
  const maps = state.db.maps;
  if (state.filter === "G") return maps.filter((m) => m.series === "G");
  if (state.filter === "S") return maps.filter((m) => m.series === "S");
  if (state.filter === "current") {
    return maps.filter((m) => m.evModel && (m.grade >= 16 || m.series === "S"));
  }
  return maps;
}

function renderSummary() {
  const withEv = filteredMaps().map((m) => ({ map: m, ev: computeEv(m) })).filter((x) => x.ev);
  const best = [...withEv].sort((a, b) => (b.ev.net ?? -Infinity) - (a.ev.net ?? -Infinity))[0];
  const gCount = state.db.maps.filter((m) => m.series === "G").length;
  const sCount = state.db.maps.filter((m) => m.series === "S").length;
  const current = withEv.filter((x) => x.map.code === "G17" || x.map.code === "G18" || x.map.code === "S5");

  els.summary.innerHTML = `
    <div class="stat"><div class="k">陳舊 G#</div><div class="v">${gCount} 種</div></div>
    <div class="stat"><div class="k">陳舊 S#</div><div class="v">${sCount} 種</div></div>
    <div class="stat"><div class="k">現行可估期望值</div><div class="v">${withEv.length} 張</div></div>
    <div class="stat"><div class="k">目前淨期望最高</div><div class="v">${best ? escapeHtml(best.map.code) : "—"}</div>
      <div class="sub" style="color:var(--muted);font-size:12px;margin-top:4px">${best?.ev.net != null ? formatGil(best.ev.net) : "需先查市場價"}</div>
    </div>
    <div class="stat"><div class="k">G17／G18／S5 平均開箱毛期望</div><div class="v">${current.length ? formatGil(current.reduce((s, x) => s + x.ev.gross - x.ev.portalEv, 0) / current.length) : "—"}</div></div>
  `;
}

function renderBoard() {
  const maps = filteredMaps();
  els.board.innerHTML = maps.map((map) => {
    const ev = computeEv(map);
    const portal = map.portal
      ? `<span class="tag portal">${map.portal.guaranteed ? "必出魔紋" : `魔紋 ${(map.portal.chance * 100).toFixed(0)}%`} · ${escapeHtml(map.portal.name)}</span>`
      : `<span class="tag">無寶庫魔紋</span>`;
    const seriesTag = map.series === "S" ? `<span class="tag s">特殊圖</span>` : "";
    let evBlock = `<div class="ev"><div class="sub">舊圖：列重點獎勵，未建抽樣期望值模型</div></div>`;
    if (ev) {
      const netClass = ev.net == null ? "" : ev.net >= 0 ? "good" : "bad";
      const netText = ev.net == null ? "地圖成本未知" : `淨期望 ${formatGil(ev.net)}`;
      evBlock = `<div class="ev">
        <div class="net ${netClass}">${escapeHtml(netText)}</div>
        <div class="sub">開箱毛期望 ${formatGil(ev.gross - ev.portalEv)}${state.includePortal ? `　＋寶庫 ${formatGil(ev.portalEv)}` : ""}</div>
        <div class="sub">地圖成本 ${ev.mapCost == null ? (map.tradeable === false ? "不可交易" : "沒有掛牌") : formatGil(ev.mapCost)}</div>
      </div>`;
    }
    return `<article class="card" data-code="${escapeHtml(map.code)}" tabindex="0">
      <div class="card-top">
        <div class="code">${escapeHtml(map.code)}</div>
        <div class="meta">Lv${map.level}${map.party > 1 ? ` · ${map.party} 人` : " · 單人"}<br>${escapeHtml(map.patch || "")}</div>
      </div>
      <div class="name">${escapeHtml(map.name)}</div>
      ${evBlock}
      <div class="tags">${seriesTag}${portal}</div>
    </article>`;
  }).join("");
}

function renderDetail(map) {
  if (!map) {
    closeDetail();
    return;
  }
  const ev = computeEv(map);
  els.detail.hidden = false;
  if (els.detailBackdrop) els.detailBackdrop.hidden = false;
  els.detailTitle.textContent = map.name;

  const highlights = (map.highlights || []).map((h) => `<li>${escapeHtml(h)}</li>`).join("");
  let evHtml = "<p>這張圖尚未建立抽樣期望值模型，上方列出已知重點獎勵。</p>";
  if (ev) {
    const rareRows = ev.rareLines.map((line) => {
      const rate = `${(line.perMap * 100).toFixed(1)}%`;
      const unit = line.unit == null ? "沒有掛牌" : formatGil(line.unit);
      const lineEv = line.lineEv == null ? "—" : formatGil(line.lineEv);
      return `<tr><td>${escapeHtml(line.name)}</td><td>${rate}</td><td>${escapeHtml(unit)}</td><td>${escapeHtml(lineEv)}</td></tr>`;
    }).join("");
    evHtml = `
      <h3>期望值拆解</h3>
      <table class="table">
        <tr><th>項目</th><th>期望</th></tr>
        <tr><td>金幣（含三倍）</td><td>${formatGil(ev.gilEv)}</td></tr>
        <tr><td>水晶／晶簇</td><td>${formatGil(ev.crystalEv)}</td></tr>
        <tr><td>魔晶石</td><td>${formatGil(ev.materiaEv)}</td></tr>
        <tr><td>常規素材粗估</td><td>${formatGil(ev.materialEv)}</td></tr>
        <tr><td>稀有掉落</td><td>${formatGil(ev.rareEv)}</td></tr>
        <tr><td>寶庫加權</td><td>${formatGil(ev.portalEv)}（機率 ${(ev.portalChance * 100).toFixed(0)}%）</td></tr>
        <tr><td>開箱＋寶庫毛期望</td><td>${formatGil(ev.gross)}</td></tr>
        <tr><td>地圖成本</td><td>${ev.mapCost == null ? (map.tradeable === false ? "不可交易（成本 0）" : "沒有掛牌") : formatGil(ev.mapCost)}</td></tr>
        <tr><td>淨期望</td><td>${ev.net == null ? "—" : formatGil(ev.net)}</td></tr>
      </table>
      ${ev.tomestone ? `<p>另得約 ${ev.tomestone.qty.toFixed(1)} 個${escapeHtml(ev.tomestone.name)}（不計入金幣期望）。</p>` : ""}
      <h3>稀有掉落（抽樣）</h3>
      <table class="table">
        <tr><th>道具</th><th>每圖機率</th><th>單價</th><th>貢獻期望</th></tr>
        ${rareRows || "<tr><td colspan='4'>無量化稀有列</td></tr>"}
      </table>
      <p>${escapeHtml(map.evModel.source || "")}${map.evModel.sampleSize ? ` · 樣本 ${map.evModel.sampleSize} 枚` : ""}</p>
      ${map.evModel.portalNote ? `<p>${escapeHtml(map.evModel.portalNote)}</p>` : ""}
    `;
  }

  els.detailBody.innerHTML = `
    <p>${escapeHtml(map.name)} · Item #${map.id}${map.mirrorOf ? ` · 對應 ${escapeHtml(map.mirrorOf)}` : ""}</p>
    <h3>重點</h3>
    <ul>${highlights || "<li>無</li>"}</ul>
    ${map.portal ? `<h3>傳送魔紋</h3><p>${map.portal.guaranteed ? "必定出現" : `約 ${(map.portal.chance * 100).toFixed(0)}%`} → ${escapeHtml(map.portal.name)}</p>` : ""}
    ${evHtml}
  `;
}

function render() {
  renderSummary();
  renderBoard();
  if (state.selected) {
    const map = state.db.maps.find((m) => m.code === state.selected);
    renderDetail(map);
  }
  els.footnote.textContent = (state.db.notes || []).join(" ");
}

function collectItemIds() {
  const ids = new Set();
  for (const map of state.db.maps) {
    ids.add(map.id);
    const model = map.evModel;
    if (!model) continue;
    if (model.tomestone?.id) ids.add(model.tomestone.id);
    for (const rare of model.rares || []) ids.add(rare.id);
  }
  for (const id of state.db.crystals || []) ids.add(id);
  for (const id of state.db.clusters || []) ids.add(id);
  for (const entry of state.db.materiaXi || []) ids.add(entry.id);
  return [...ids];
}

async function fetchPrices() {
  const ids = collectItemIds();
  const world = state.marketWorld;
  state.busy = true;
  els.marketBtn.disabled = true;
  els.status.textContent = "查詢 Universalis…";
  try {
    const chunkSize = 50;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const url = `https://universalis.app/api/v2/aggregated/${encodeURIComponent(world)}/${chunk.join(",")}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      for (const row of data.results || []) {
        state.prices.set(row.itemId, row);
      }
    }
    els.status.textContent = `${world} 市場價已更新 · ${new Date().toLocaleTimeString("zh-Hant")}`;
  } catch (err) {
    els.status.textContent = `市場價查詢失敗：${err.message || err}`;
  } finally {
    state.busy = false;
    els.marketBtn.disabled = false;
    render();
  }
}

function bind() {
  els.tabs.addEventListener("click", (event) => {
    const btn = event.target.closest(".tab");
    if (!btn) return;
    state.filter = btn.dataset.series;
    for (const tab of els.tabs.querySelectorAll(".tab")) {
      tab.classList.toggle("is-on", tab === btn);
    }
    render();
  });

  els.board.addEventListener("click", (event) => {
    const card = event.target.closest(".card");
    if (!card) return;
    state.selected = card.dataset.code;
    const map = state.db.maps.find((m) => m.code === state.selected);
    renderDetail(map);
  });

  els.board.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const card = event.target.closest(".card");
    if (!card) return;
    event.preventDefault();
    state.selected = card.dataset.code;
    renderDetail(state.db.maps.find((m) => m.code === state.selected));
  });

  els.detailClose.addEventListener("click", closeDetail);
  els.detailBackdrop?.addEventListener("click", closeDetail);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDetail();
  });

  els.marketWorld.addEventListener("change", () => {
    state.marketWorld = MARKET_WORLDS.includes(els.marketWorld.value) ? els.marketWorld.value : "陸行鳥";
  });

  els.marketBtn.addEventListener("click", () => {
    if (!state.busy) fetchPrices();
  });

  els.includePortal.addEventListener("change", () => {
    state.includePortal = els.includePortal.checked;
    render();
  });

  els.portalScale.addEventListener("change", () => {
    const value = Number(els.portalScale.value);
    state.portalScale = Number.isFinite(value) ? Math.min(3, Math.max(0, value)) : 1;
    els.portalScale.value = String(state.portalScale);
    render();
  });
}

async function main() {
  bind();
  const res = await fetch("./data/maps.json");
  state.db = await res.json();
  render();
  await fetchPrices();
}

main();

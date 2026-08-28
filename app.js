let board = [];
let prevPrices = Object.create(null);
let seconds = 60;
let liveHits = 0;
let loading = false;

const $ = (id) => document.getElementById(id);

function money(n) {
  if (n == null || Number.isNaN(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1000000) return "$" + (n / 1000000).toFixed(2) + "M";
  if (abs >= 10000) return "$" + Math.round(n).toLocaleString("en-US");
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function bestMarket(prices) {
  if (!prices || typeof prices !== "object") return null;
  let best = 0;
  for (const v of Object.values(prices)) {
    if (!v || typeof v !== "object") continue;
    const n = typeof v.market === "number" ? v.market : typeof v.mid === "number" ? v.mid : 0;
    if (n > best) best = n;
  }
  return best || null;
}

async function fetchChunk(ids) {
  const q = ids.map((id) => "id:" + id).join(" OR ");
  const url = API + "?q=" + encodeURIComponent(q) + "&pageSize=" + ids.length;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const json = await res.json();
  return Array.isArray(json.data) ? json.data : [];
}

async function fetchWithRetry(ids) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await fetchChunk(ids); }
    catch (err) {
      if (attempt === 2) return [];
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  return [];
}

function seedRows() {
  const rows = CATALOG.map((c) => ({
    key: c.id, id: c.id, name: c.name, set: c.set, rarity: c.rarity,
    usd: c.fallback, img: c.img, source: "fallback", kind: "live", chg: 0,
    search: (c.name + " " + c.set + " " + c.id).toLowerCase()
  }));
  GRAILS.forEach((g) => {
    rows.push({
      key: g.key, id: g.key, name: g.name, set: g.set, rarity: g.rarity,
      usd: g.usd, img: g.img, source: "auction", kind: "grail", chg: 0,
      search: (g.name + " " + g.set).toLowerCase()
    });
  });
  rows.sort((a, b) => b.usd - a.usd);
  board = rows;
}

async function loadLive() {
  if (loading) return;
  loading = true;
  $("refreshBtn").disabled = true;
  try {
    const found = new Map();
    for (let i = 0; i < CATALOG.length; i += 6) {
      const chunk = CATALOG.slice(i, i + 6);
      const cards = await fetchWithRetry(chunk.map((c) => c.id));
      cards.forEach((card) => { if (card && card.id) found.set(card.id, card); });
    }
    liveHits = 0;
    board = board.map((row) => {
      if (row.kind !== "live") return row;
      const card = found.get(row.id);
      const live = card && card.tcgplayer ? bestMarket(card.tcgplayer.prices) : null;
      const next = live != null ? live : row.usd;
      const prev = prevPrices[row.id];
      const chg = typeof prev === "number" ? next - prev : 0;
      if (live != null) liveHits += 1;
      return Object.assign({}, row, { usd: next, chg: chg, source: live != null ? "live" : row.source });
    });
    board.sort((a, b) => b.usd - a.usd);
    board.forEach((row) => { if (row.kind === "live") prevPrices[row.id] = row.usd; });
    $("liveDot").classList.toggle("off", liveHits === 0);
    $("liveLabel").textContent = liveHits ? ("Live · " + liveHits + " marks") : "Cached marks";
    $("statSync").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    render();
  } catch (err) {
    $("liveDot").classList.add("off");
    $("liveLabel").textContent = "Feed unavailable";
    render();
  } finally {
    loading = false;
    $("refreshBtn").disabled = false;
  }
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function render() {
  const q = $("q").value.trim().toLowerCase();
  const filter = $("filter").value;
  const list = board.filter((r) => {
    if (filter === "live" && r.kind !== "live") return false;
    if (filter === "grail" && r.kind !== "grail") return false;
    if (q && r.search.indexOf(q) === -1) return false;
    return true;
  }).slice(0, 100);

  $("statCount").textContent = String(list.length);
  $("statSum").textContent = money(list.reduce((s, r) => s + r.usd, 0));
  $("statTop").textContent = list[0] ? money(list[0].usd) : "—";

  const root = $("rows");
  root.textContent = "";
  if (!list.length) {
    root.appendChild(el("div", "empty", "No cards match."));
    return;
  }

  list.forEach((r, i) => {
    const row = el("div", "row");
    const rank = el("div", i < 3 ? "rank top" : "rank", String(i + 1).padStart(2, "0"));
    const art = el("div", r.img ? "art" : "art missing");
    if (r.img) {
      const img = document.createElement("img");
      img.alt = r.name;
      img.src = r.img;
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      img.onerror = function () { art.classList.add("missing"); };
      art.appendChild(img);
    }
    art.appendChild(el("div", "ph", "No licensed English scan"));
    const info = document.createElement("div");
    const name = el("div", "name", r.name);
    if (r.kind === "grail") name.appendChild(el("span", "badge grail", "Auction"));
    else if (r.source === "live") name.appendChild(el("span", "badge", "Live"));
    info.appendChild(name);
    info.appendChild(el("div", "meta", r.set + (r.rarity ? " · " + r.rarity : "")));
    const chgCls = r.chg > 0.004 ? "chg up" : r.chg < -0.004 ? "chg dn" : "chg";
    const chgTxt = Math.abs(r.chg) < 0.005 ? "—" : ((r.chg > 0 ? "+" : "\u2212") + money(Math.abs(r.chg)));
    const srcLabel = r.source === "live" ? "TCGPlayer" : r.source === "auction" ? "Public sale" : "Last known";
    row.appendChild(rank);
    row.appendChild(art);
    row.appendChild(info);
    row.appendChild(el("div", "price", money(r.usd)));
    row.appendChild(el("div", chgCls, chgTxt));
    row.appendChild(el("div", "src", srcLabel));
    root.appendChild(row);
  });
}

$("q").addEventListener("input", render);
$("filter").addEventListener("change", render);
$("refreshBtn").addEventListener("click", function () {
  seconds = 60;
  $("countdown").textContent = "60s";
  loadLive();
});

setInterval(function () {
  seconds -= 1;
  if (seconds <= 0) { seconds = 60; loadLive(); }
  $("countdown").textContent = seconds + "s";
}, 1000);

seedRows();
render();
loadLive();

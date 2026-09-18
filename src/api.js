/* Accès aux données : collection, ventes, résolution titre -> carte. */
(() => {
  const WMP = window.WMP;
  const SUPABASE_URL = "https://cyrxjeppjqsxxjayfrur.supabase.co";

  /* ---------- clé publique Supabase (lue dans le bundle du site) ---------- */
  let keyPromise = null;
  function anonKey() {
    if (keyPromise) return keyPromise;
    keyPromise = (async () => {
      try {
        const c = await chrome.storage.local.get("wmp_anon_key");
        if (c.wmp_anon_key) return c.wmp_anon_key;
      } catch (e) {}
      const srcs = [...document.querySelectorAll("script[src]")]
        .map((s) => s.src)
        .filter((u) => u.includes("/_next/static/"));
      for (const u of srcs) {
        try {
          const t = await (await fetch(u)).text();
          const m = t.match(/eyJ[\w-]{10,}\.eyJ[\w-]{20,}\.[\w-]{10,}/);
          if (m) {
            try {
              await chrome.storage.local.set({ wmp_anon_key: m[0] });
            } catch (e) {}
            return m[0];
          }
        } catch (e) {}
      }
      return null;
    })();
    return keyPromise;
  }

  /* ---------- statistiques calculées à partir de l'historique des ventes ---------- */
  /* "*" = toutes raretés confondues */
  WMP.statsFromSales = (sales) => {
    const buckets = {};
    for (const s of sales || []) {
      if (!s || typeof s.final_price !== "number") continue;
      const r = s.rarity || "?";
      (buckets[r] = buckets[r] || []).push(s);
      (buckets["*"] = buckets["*"] || []).push(s);
    }
    const out = {};
    for (const [r, arr] of Object.entries(buckets)) {
      arr.sort((a, b) => new Date(a.settled_at) - new Date(b.settled_at));
      const prices = arr.map((s) => s.final_price);
      const last = arr[arr.length - 1];
      out[r] = {
        n: arr.length,
        last: last.final_price,
        lastAt: last.settled_at,
        avg: prices.reduce((a, b) => a + b, 0) / prices.length,
        min: Math.min(...prices),
        max: Math.max(...prices),
        recent: arr
          .slice(-10)
          .reverse()
          .map((s) => [s.final_price, s.settled_at]),
      };
    }
    return out;
  };

  WMP.statsFor = (entry, rarity) => {
    if (!entry || !entry.r) return null;
    const key = WMP.settings.rarityMode === "all" ? "*" : rarity;
    return entry.r[key] || null;
  };

  /* ---------- API du site ---------- */
  WMP.fetchSales = async (cardId) => {
    const r = await fetch(`/api/marketplace/cards/${cardId}/sales`, {
      credentials: "same-origin",
    });
    if (r.status === 429 || r.status === 503) {
      const e = new Error("rate-limited");
      e.rateLimited = true;
      throw e;
    }
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    return Array.isArray(j.sales) ? j.sales : [];
  };

  /* `page` est indexé à partir de 0. `sort=name` force un ordre alphabétique
     stable : la pagination sans tri explicite peut réordonner les égalités et
     faire sauter des lignes d'une page à l'autre. */
  WMP.fetchCollectionPage = async (page, extra = "") => {
    const r = await fetch(`/api/my-collection?page=${page}&sort=name${extra}`, {
      credentials: "same-origin",
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  };

  WMP.fetchWholeCollection = async (onProgress) => {
    const items = [];
    const seen = new Set();
    const MAX_PAGES = 80;
    let announced = 0;
    for (let p = 0; p < MAX_PAGES; p++) {
      let j;
      try {
        j = await WMP.fetchCollectionPage(p, p === 0 ? "&stats=1" : "");
      } catch (e) {
        break;
      }
      if (p === 0) announced = j.total || 0;
      const rows = j.collection || [];
      if (!rows.length) break;
      for (const it of rows) {
        if (!it || !it.card || seen.has(it.id || it.card.id)) continue;
        seen.add(it.id || it.card.id);
        items.push(it);
      }
      onProgress && onProgress(items.length, Math.max(announced, items.length));
      if (rows.length < 50) break;
    }
    return { items, total: items.length };
  };

  /* ---------- titre -> carte (table publique `cards`) ---------- */
  WMP.resolveTitles = async (titles) => {
    const out = new Map();
    if (!titles.length) return out;
    const key = await anonKey();
    if (!key) return out;
    const CH = 40;
    for (let i = 0; i < titles.length; i += CH) {
      const chunk = titles.slice(i, i + CH);
      const list = chunk
        .map((t) => '"' + String(t).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"')
        .join(",");
      const url =
        `${SUPABASE_URL}/rest/v1/cards` +
        `?select=id,rarity,wikipedia_title,wikipedia_url&lang=eq.fr` +
        `&wikipedia_title=in.(${encodeURIComponent(list)})`;
      try {
        const r = await fetch(url, {
          headers: { apikey: key, Authorization: "Bearer " + key },
        });
        if (!r.ok) continue;
        for (const row of await r.json()) out.set(row.wikipedia_title, row);
      } catch (e) {}
    }
    if (out.size) {
      try {
        await WMP.cache.addTitles(out);
      } catch (e) {}
    }
    return out;
  };

  /* ---------- récupération des prix, avec cache et pool de requêtes ---------- */
  WMP.ensurePrices = async (cardIds, opts = {}) => {
    const { onProgress, signal, force = false } = opts;
    const ids = [...new Set(cardIds.filter(Boolean))];
    const ttl = WMP.settings.ttlHours;
    const have = force ? new Map() : await WMP.cache.getMany(ids);
    const result = new Map();
    const todo = [];
    for (const id of ids) {
      const e = have.get(id);
      if (WMP.cache.fresh(e, ttl)) result.set(id, e);
      else todo.push(id);
    }
    const report = () => onProgress && onProgress(result.size, ids.length);
    report();
    if (!todo.length) return result;

    let idx = 0;
    let conc = Math.max(1, Math.min(8, WMP.settings.concurrency || 5));
    const worker = async () => {
      while (idx < todo.length) {
        if (signal && signal.aborted) return;
        const id = todo[idx++];
        try {
          const sales = await WMP.fetchSales(id);
          const entry = { t: Date.now(), r: WMP.statsFromSales(sales) };
          await WMP.cache.set(id, entry);
          result.set(id, entry);
        } catch (e) {
          if (e && e.rateLimited) {
            idx--; // on refera cette carte
            conc = 1;
            await new Promise((r) => setTimeout(r, 6000));
            continue;
          }
          const entry = { t: Date.now(), r: {}, err: 1 };
          result.set(id, entry);
        }
        report();
      }
    };
    await Promise.all(Array.from({ length: conc }, worker));
    return result;
  };
})();

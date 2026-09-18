/* Détection des cartes dans le DOM, injection des badges de prix,
   totaux par groupe (échanges) et tri de la grille visible. */
(() => {
  const WMP = window.WMP;
  const RARITY_SET = new Set(WMP.RARITIES);

  const isOurs = (n) => String((n && n.className) || "").includes("wmp-");
  const realChildCount = (n) => {
    let c = 0;
    for (const ch of n.children) if (!isOurs(ch)) c++;
    return c;
  };

  /* Un conteneur en ligne (flex-row / grid) ne peut pas accueillir le badge :
     il serait posé À CÔTÉ de la carte, pas dessous. */
  function isRowContainer(el) {
    const cs = getComputedStyle(el);
    const d = cs.display;
    if (d === "flex" || d === "inline-flex") return !cs.flexDirection.startsWith("column");
    return d === "grid" || d === "inline-grid";
  }

  /* La grille = l'ancêtre qui a le plus d'enfants directs contenant une carte.
     Bien plus fiable que de remonter à l'aveugle : marche aussi bien pour la
     collection (tuiles nues) que pour le marché (tuile + bloc enchère). */
  function detectGrid(list) {
    const counts = new Map();
    for (const t of list) {
      let child = t.box;
      let p = t.box.parentElement;
      for (let i = 0; i < 9 && p && p !== document.body; i++) {
        let set = counts.get(p);
        if (!set) counts.set(p, (set = new Set()));
        set.add(child);
        child = p;
        p = p.parentElement;
      }
    }
    let best = null;
    let bestN = 1;
    for (const [el, kids] of counts) {
      if (kids.size > bestN) {
        best = el;
        bestN = kids.size;
      }
    }
    return best;
  }

  function directChildOf(parent, node) {
    let n = node;
    while (n && n.parentElement && n.parentElement !== parent) n = n.parentElement;
    return n && n.parentElement === parent ? n : null;
  }

  WMP.findTiles = () => {
    const list = [];
    const seen = new Set();
    for (const h3 of document.querySelectorAll("h3")) {
      const title = (h3.textContent || "").trim();
      if (!title) continue;
      let box = null;
      let rarity = null;
      let el = h3.parentElement;
      for (let i = 0; i < 7 && el && el !== document.body; i++, el = el.parentElement) {
        let badge = null;
        for (const n of el.querySelectorAll("div,span,p")) {
          if (n.children.length === 0 && RARITY_SET.has((n.textContent || "").trim())) {
            badge = n;
            break;
          }
        }
        if (badge) {
          box = el;
          rarity = (badge.textContent || "").trim();
          break;
        }
      }
      if (!box || seen.has(box)) continue;
      seen.add(box);

      // conteneur propre à cette carte (on ignore nos propres noeuds dans le
      // comptage, sinon le badge déjà posé fausse tout au passage suivant)
      let wrap = box;
      while (
        wrap.parentElement &&
        realChildCount(wrap.parentElement) === 1 &&
        wrap.parentElement !== document.body
      ) {
        wrap = wrap.parentElement;
      }
      list.push({ box, wrap, title, rarity, group: box.parentElement });
    }

    const grid = detectGrid(list);
    for (const t of list) {
      t.grid = grid;
      t.item = grid ? directChildOf(grid, t.box) || t.wrap : t.wrap;
    }
    return list;
  };

  /* ---------- badge ---------- */
  function metricsOf(stats, rarity) {
    const s = WMP.settings;
    const rlabel =
      s.rarityMode === "all" ? "toutes raretés" : WMP.RARITY_LABEL[rarity] || rarity;
    const summary =
      `moy. ${WMP.num1(stats.avg)} · ${WMP.num(stats.min)}–${WMP.num(stats.max)} · ` +
      `${stats.n} vente(s)`;
    const out = [];
    if (s.showLast)
      out.push({
        cls: "wmp-last",
        coin: true,
        txt: WMP.num(stats.last),
        title: `Dernier prix — ${rlabel}\n${WMP.dateTime(stats.lastAt)}\n${summary}`,
      });
    if (s.showAvg)
      out.push({
        cls: "wmp-avg",
        txt: "~" + WMP.num(stats.avg),
        title: `Prix moyen sur ${stats.n} vente(s) — ${rlabel}\n${summary}`,
      });
    if (s.showMinMax)
      out.push({
        cls: "wmp-mm",
        txt: `${WMP.num(stats.min)}–${WMP.num(stats.max)}`,
        title: `Min / Max — ${rlabel}\n${summary}`,
      });
    if (s.showCount)
      out.push({
        cls: "wmp-n",
        txt: `${WMP.num(stats.n)} v.`,
        title: `${stats.n} vente(s) enregistrée(s) — ${rlabel}\n${summary}`,
      });
    return out;
  }

  function buildBar(stats, rarity, compact) {
    const bar = WMP.el("div", "wmp-bar");
    const rlabel =
      WMP.settings.rarityMode === "all"
        ? "toutes raretés"
        : WMP.RARITY_LABEL[rarity] || rarity;

    if (!stats || !stats.n) {
      bar.classList.add("wmp-empty");
      const m = WMP.el("span", "wmp-m wmp-last", "—");
      m.title = `Aucune vente enregistrée (${rlabel})`;
      bar.appendChild(m);
      return bar;
    }

    let metrics = metricsOf(stats, rarity);
    // en superposition sur l'image, une seule pastille : le reste est dans
    // l'infobulle, sinon le badge mange la moitié de la carte
    if (compact) metrics = metrics.slice(0, 1);
    for (const m of metrics) {
      const node = WMP.el("span", "wmp-m " + m.cls);
      if (m.coin) node.appendChild(WMP.el("span", "wmp-coin", "◈"));
      node.appendChild(WMP.el("span", null, m.txt));
      node.title = m.title;
      bar.appendChild(node);
    }
    if (!bar.children.length) bar.classList.add("wmp-hidden");
    return bar;
  }

  /* "under" = un conteneur propre à la carte accepte le badge dessous.
     "over"  = superposition en haut de l'image. */
  function placement(tile) {
    const w = tile.wrap;
    if (WMP.settings.underCard && w && w !== tile.box && !isRowContainer(w)) return "under";
    return "over";
  }

  WMP.renderBadge = (tile, entry, state) => {
    tile.box.querySelectorAll(":scope > .wmp-bar").forEach((n) => n.remove());
    if (tile.wrap !== tile.box) {
      tile.wrap.querySelectorAll(":scope > .wmp-bar").forEach((n) => n.remove());
    }
    if (!WMP.settings.badges) return;

    const mode = placement(tile);
    const bar =
      state === "loading"
        ? (() => {
            const b = WMP.el("div", "wmp-bar wmp-loading");
            b.appendChild(WMP.el("span", "wmp-m", "···"));
            return b;
          })()
        : buildBar(
            WMP.statsFor(entry, tile.rarity),
            tile.rarity,
            mode === "over" && WMP.settings.overlayCompact
          );

    if (mode === "under") {
      tile.wrap.appendChild(bar);
    } else {
      bar.classList.add("wmp-overlay");
      tile.box.appendChild(bar);
    }
  };

  /* ---------- pastilles compactes (liste des échanges) ----------
     Format « SR · Thann » avec le titre complet dans l'attribut title. */
  const CHIP_RE = /^(L|UR|SR|R|PC|C)\s*[·•∙]\s*\S/;

  WMP.findChips = () => {
    const out = [];
    for (const el of document.querySelectorAll("span[title]")) {
      const kids = [...el.children].filter((c) => !isOurs(c));
      if (kids.length) continue;
      const raw = (el.textContent || "").trim();
      const m = CHIP_RE.exec(raw);
      if (!m) continue;
      const title = el.getAttribute("title");
      if (!title) continue;
      out.push({ chip: el, rarity: m[1], title, group: el.parentElement });
    }
    return out;
  };

  WMP.renderChip = (c, entry) => {
    let node = c.chip.querySelector(":scope > .wmp-chipprice");
    if (!WMP.settings.badges) {
      if (node) node.remove();
      return;
    }
    if (!node) {
      node = WMP.el("span", "wmp-chipprice");
      c.chip.appendChild(node);
    }
    const stats = WMP.statsFor(entry, c.rarity);
    const rlabel =
      WMP.settings.rarityMode === "all" ? "toutes raretés" : WMP.RARITY_LABEL[c.rarity] || c.rarity;
    if (!entry) {
      node.textContent = "···";
      node.title = "";
      return;
    }
    if (!stats || !stats.n) {
      node.textContent = "—";
      node.title = `Aucune vente enregistrée (${rlabel})`;
      return;
    }
    node.textContent = "◈ " + WMP.num(stats.last);
    node.title =
      `Dernier prix — ${rlabel}\n${WMP.dateTime(stats.lastAt)}\n` +
      `moy. ${WMP.num1(stats.avg)} · ${WMP.num(stats.min)}–${WMP.num(stats.max)} · ${stats.n} vente(s)`;
  };

  /* ---------- pièces jointes à un échange ----------
     Pastille « <icône> 3 wb » posée dans le même conteneur que les cartes. */
  const COIN_RE = /^\s*([\d\s\u00a0\u202f.,]+)\s*wb\s*$/i;

  WMP.findCoins = () => {
    const out = [];
    for (const el of document.querySelectorAll("span")) {
      const txt = (el.textContent || "").trim();
      if (!txt || txt.length > 24) continue;
      const m = COIN_RE.exec(txt);
      if (!m) continue;
      const amount = parseInt(m[1].replace(/[^\d]/g, ""), 10);
      if (!Number.isFinite(amount)) continue;
      // garder la pastille la plus interne : un span parent qui n'enrobe qu'elle
      // matcherait aussi, et on compterait le montant deux fois
      let nested = false;
      for (const c of el.querySelectorAll("span")) {
        if (COIN_RE.test((c.textContent || "").trim())) {
          nested = true;
          break;
        }
      }
      if (nested) continue;
      out.push({ el, amount, group: el.parentElement });
    }
    return out;
  };

  /* ---------- totaux par groupe (un lot de cartes + pièces échangé) ---------- */
  WMP.renderTotals = (items, getStats, coins) => {
    const groups = new Map();
    const bucket = (host) => {
      let g = groups.get(host);
      if (!g) groups.set(host, (g = { cards: [], coins: 0, hasCoins: false }));
      return g;
    };
    for (const it of items) if (it.group) bucket(it.group).cards.push(it);
    for (const c of coins || []) {
      if (!c.group) continue;
      const g = bucket(c.group);
      g.coins += c.amount;
      g.hasCoins = true;
    }

    for (const [host, g] of groups) {
      let node = host.querySelector(":scope > .wmp-total");
      if (!WMP.settings.badges || (!g.cards.length && !g.hasCoins)) {
        if (node) node.remove();
        continue;
      }
      let sum = 0;
      let priced = 0;
      let missing = 0;
      for (const it of g.cards) {
        const s = getStats(it);
        if (s && s.n) {
          sum += s.last;
          priced++;
        } else missing++;
      }
      const total = sum + g.coins;
      if (!node) {
        node = WMP.el("div", "wmp-total");
        host.appendChild(node);
      }
      node.textContent =
        `Total ◈ ${WMP.num(total)}` +
        (g.hasCoins ? ` · dont ${WMP.num(g.coins)} en pièces` : "") +
        (missing ? ` · ${missing} sans prix` : "");
      node.title =
        `${WMP.num(sum)} en cartes (derniers prix de ${priced} carte(s) sur ${g.cards.length})` +
        (g.hasCoins ? `\n+ ${WMP.num(g.coins)} wb de pièces` : "") +
        (missing ? `\n${missing} carte(s) sans vente enregistrée, non comptée(s)` : "");
    }
  };

  /* Retire tout ce que l'extension a injecté sur les cartes. */
  WMP.clearBadges = () => {
    document
      .querySelectorAll(".wmp-bar, .wmp-chipprice, .wmp-total")
      .forEach((n) => n.remove());
    document.querySelectorAll("[data-wmp-idx]").forEach((n) => {
      n.style.order = "";
      delete n.dataset.wmpIdx;
    });
  };

  /* ---------- tri de la grille visible ---------- */
  WMP.sortVisibleGrid = (tiles, getStats, key, dir) => {
    if (!tiles.length) return;
    const grid = tiles[0].grid;
    if (!grid) return;
    const disp = getComputedStyle(grid).display;
    const useOrder = /flex|grid/.test(disp);

    if (!key || key === "none") {
      for (const t of tiles) if (t.item) t.item.style.order = "";
      if (!useOrder) {
        const orig = tiles
          .filter((t) => t.item && t.item.dataset.wmpIdx != null)
          .sort((a, b) => +a.item.dataset.wmpIdx - +b.item.dataset.wmpIdx);
        for (const t of orig) grid.appendChild(t.item);
      }
      return;
    }
    const scored = tiles
      .filter((t) => t.item)
      .map((t, i) => {
        const s = getStats(t);
        let v = null;
        if (key === "atk" || key === "def") v = t[key] != null ? t[key] : null;
        else if (s) v = s[key];
        return { t, i, v };
      });
    scored.sort((a, b) => {
      const av = a.v,
        bv = b.v;
      if (av == null && bv == null) return a.i - b.i;
      if (av == null) return 1;
      if (bv == null) return -1;
      return dir === "asc" ? av - bv : bv - av;
    });
    if (useOrder) {
      scored.forEach((s, rank) => {
        s.t.item.style.order = String(rank);
      });
    } else {
      scored.forEach((s, i) => {
        if (s.t.item.dataset.wmpIdx == null) s.t.item.dataset.wmpIdx = String(s.i);
      });
      scored.forEach((s) => grid.appendChild(s.t.item));
    }
  };
})();

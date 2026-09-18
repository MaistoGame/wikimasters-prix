/* Orchestration : détection de page, résolution des cartes, badges, tri. */
(async () => {
  const WMP = window.WMP;
  await WMP.loadSettings();

  const state = {
    route: location.pathname,
    sortKey: "none",
    sortDir: "desc",
    listView: false,
    canList: false,
    total: 0,
    rows: [],
    titleMap: new Map(), // titre -> { id, rarity, url }
    rowByTitle: new Map(),
    prices: new Map(),
    collectionLoaded: false,
    pricesPrefetched: false,
  };

  try {
    const stored = await WMP.cache.getTitles();
    for (const [title, v] of Object.entries(stored)) state.titleMap.set(title, v);
  } catch (e) {}

  const isCollection = () => /^\/collection/.test(location.pathname);

  /* Pages où l'on garde les badges sous les cartes mais pas la barre de tri. */
  const NO_TOOLBAR_ROUTES = [/^\/trades/, /^\/pulls/, /^\/profile/];
  const toolbarAllowed = () => !NO_TOOLBAR_ROUTES.some((re) => re.test(location.pathname));
  const isTrades = () => /^\/trades/.test(location.pathname);

  /* ---------------- collection complète ---------------- */
  async function ensureCollection() {
    if (state.collectionLoaded || !isCollection()) return;
    state.collectionLoaded = true;
    try {
      const { items, total } = await WMP.fetchWholeCollection((n, tot) =>
        WMP.ui.setProgress(`cartes ${n}/${tot}`, true)
      );
      state.total = total;
      state.rows = items.map((it) => ({
        cardId: it.card.id,
        title: it.card.wikipedia_title,
        category: it.card.category,
        rarity: it.card.rarity,
        atk: it.card.atk,
        def: it.card.def,
        url: it.card.wikipedia_url,
        count: it.count || 1,
        entry: null,
      }));
      for (const r of state.rows) {
        state.titleMap.set(r.title, { id: r.cardId, rarity: r.rarity, url: r.url });
        state.rowByTitle.set(r.title, r);
      }
      state.canList = true;
      WMP.ui.setProgress("", false);
    } catch (e) {
      state.collectionLoaded = false;
      WMP.ui.setProgress("collection indisponible", false);
    }
  }

  async function prefetchAllPrices(force = false) {
    await ensureCollection();
    if (!state.rows.length) return;
    if (state.pricesPrefetched && !force) return;
    const ids = state.rows.map((r) => r.cardId);
    const got = await WMP.ensurePrices(ids, {
      force,
      onProgress: (n, tot) => {
        WMP.ui.setProgress(`prix ${n}/${tot}`, n < tot);
        if (n === tot) WMP.ui.setProgress(`prix ${tot}/${tot}`, false);
      },
    });
    for (const [id, e] of got) state.prices.set(id, e);
    for (const r of state.rows) r.entry = state.prices.get(r.cardId) || null;
    state.pricesPrefetched = true;
    if (state.listView) WMP.ui.renderList(state);
    scheduleRender();
  }

  /* ---------------- résolution titre -> carte ---------------- */
  function attach(t) {
    const m = state.titleMap.get(t.title);
    if (m) {
      t.cardId = m.id;
      t.url = m.url;
    }
    const row = state.rowByTitle.get(t.title);
    if (row) {
      t.atk = row.atk;
      t.def = row.def;
    }
    return !!t.cardId;
  }

  async function resolveTiles(tiles) {
    let miss = tiles.filter((t) => !attach(t));
    if (miss.length && isCollection()) {
      await ensureCollection();
      miss = tiles.filter((t) => !attach(t));
    }
    if (miss.length) {
      const titles = [...new Set(miss.map((t) => t.title))];
      const map = await WMP.resolveTitles(titles);
      for (const [title, row] of map) {
        state.titleMap.set(title, {
          id: row.id,
          rarity: row.rarity,
          url: row.wikipedia_url || null,
        });
      }
      tiles.forEach(attach);
    }
    return tiles.filter((t) => t.cardId);
  }

  /* ---------------- rendu ---------------- */
  let rendering = false;

  async function render() {
    if (rendering) return;
    rendering = true;
    stopObserver();
    try {
      const tiles = WMP.findTiles();
      const chips = WMP.findChips();
      if (!tiles.length && !chips.length) return;

      const grid = tiles.length ? tiles[0].grid : null;
      const withToolbar = !!tiles.length && toolbarAllowed();
      if (withToolbar) {
        state.canList = isCollection();
        WMP.ui.ensureToolbar(grid, state, handlers);
      } else {
        // page sans barre de tri : on retire la barre/liste d'une page précédente
        state.listView = false;
        WMP.ui.destroy();
      }

      if (state.listView) {
        // la grille est masquée : rien à badger, on garde juste la liste à jour
        WMP.ui.showList(grid, state);
        return;
      }

      await resolveTiles([...tiles, ...chips]);
      const rTiles = tiles.filter((t) => t.cardId);
      const rChips = chips.filter((c) => c.cardId);

      const paint = () => {
        for (const t of rTiles) {
          const e = state.prices.get(t.cardId);
          WMP.renderBadge(t, e, e ? null : "loading");
        }
        for (const c of rChips) WMP.renderChip(c, state.prices.get(c.cardId));
        if (isTrades()) {
          WMP.renderTotals([...rTiles, ...rChips], (x) =>
            WMP.statsFor(state.prices.get(x.cardId), x.rarity)
          );
        }
        if (withToolbar) applyGridSort(rTiles);
      };
      paint();

      const todo = [...rTiles, ...rChips].filter((x) => !state.prices.has(x.cardId));
      if (todo.length) {
        const got = await WMP.ensurePrices(todo.map((x) => x.cardId), {
          onProgress: (n, tot) => WMP.ui.setProgress(`prix ${n}/${tot}`, n < tot),
        });
        for (const [id, e] of got) state.prices.set(id, e);
        paint();
        if (!state.pricesPrefetched) WMP.ui.setProgress("", false);
      }

      if (isCollection() && WMP.settings.autoPrefetch && !state.pricesPrefetched) {
        prefetchAllPrices(false);
      }
    } catch (e) {
      // on ne casse jamais la page
      console.debug("[WMP]", e);
    } finally {
      rendering = false;
      startObserver();
    }
  }

  function applyGridSort(tiles) {
    if (state.listView || !toolbarAllowed()) return;
    WMP.sortVisibleGrid(
      tiles,
      (t) => WMP.statsFor(state.prices.get(t.cardId), t.rarity),
      state.sortKey,
      state.sortDir
    );
  }

  const scheduleRender = WMP.debounce(() => render(), 300);

  /* ---------------- handlers de la barre d'outils ---------------- */
  const handlers = {
    onSort(key) {
      state.sortKey = key;
      WMP.ui.syncToolbar(state);
      if (state.listView) WMP.ui.renderList(state);
      else render();
    },
    onDir() {
      state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      WMP.ui.syncToolbar(state);
      if (state.listView) WMP.ui.renderList(state);
      else render();
    },
    async onList() {
      state.listView = !state.listView;
      WMP.ui.syncToolbar(state);
      const tiles = WMP.findTiles();
      const grid = tiles.length ? tiles[0].grid : null;
      if (!state.listView) {
        WMP.ui.hideList(grid);
        render();
        return;
      }
      await ensureCollection();
      for (const r of state.rows) r.entry = state.prices.get(r.cardId) || null;
      WMP.ui.showList(grid, state);
      if (state.sortKey === "none") {
        state.sortKey = "last";
        WMP.ui.syncToolbar(state);
      }
      await prefetchAllPrices(false);
      for (const r of state.rows) r.entry = state.prices.get(r.cardId) || null;
      WMP.ui.renderList(state);
    },
    async onRefresh() {
      if (state.listView || (isCollection() && state.pricesPrefetched)) {
        state.pricesPrefetched = false;
        state.prices.clear();
        await prefetchAllPrices(true);
        if (state.listView) WMP.ui.renderList(state);
        return;
      }
      const tiles = await resolveTiles(WMP.findTiles());
      const got = await WMP.ensurePrices(tiles.map((t) => t.cardId), {
        force: true,
        onProgress: (n, tot) => WMP.ui.setProgress(`prix ${n}/${tot}`, n < tot),
      });
      for (const [id, e] of got) state.prices.set(id, e);
      for (const t of tiles) WMP.renderBadge(t, state.prices.get(t.cardId));
      applyGridSort(tiles);
      WMP.ui.setProgress("", false);
    },
  };

  WMP.ui.onListSort((key) => handlers.onSort(key));

  /* ---------------- observation du DOM / navigation SPA ---------------- */
  let observer = null;
  function startObserver() {
    if (observer) return;
    observer = new MutationObserver((muts) => {
      for (const m of muts) {
        const nodes = [...m.addedNodes, ...m.removedNodes];
        const relevant = nodes.some((n) => {
          if (n.nodeType !== 1) return false;
          const cls = String(n.className || "");
          return !cls.includes("wmp-");
        });
        if (relevant) {
          scheduleRender();
          return;
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  function stopObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  setInterval(() => {
    if (location.pathname !== state.route) {
      state.route = location.pathname;
      state.listView = false;
      WMP.ui.hideList(null);
      render();
    }
  }, 800);

  WMP.onSettingsChange(() => {
    if (state.listView) WMP.ui.renderList(state);
    render();
  });

  render();
  startObserver();
})();

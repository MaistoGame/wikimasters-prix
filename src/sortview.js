/* Barre d'outils (tri) + vue liste triée sur toute la collection. */
(() => {
  const WMP = window.WMP;

  const SORT_KEYS = [
    { key: "none", label: "Défaut" },
    { key: "last", label: "Dernier" },
    { key: "avg", label: "Moyenne" },
    { key: "min", label: "Min" },
    { key: "max", label: "Max" },
    { key: "n", label: "Ventes" },
  ];

  const ui = (WMP.ui = {});
  let toolbar = null;
  let listWrap = null;

  /* ---------------- barre d'outils ---------------- */
  ui.ensureToolbar = (grid, state, h) => {
    if (!grid || !grid.parentElement) return null;
    if (toolbar && toolbar.isConnected && toolbar.parentElement === grid.parentElement) {
      ui.syncToolbar(state);
      return toolbar;
    }
    if (toolbar) toolbar.remove();

    toolbar = WMP.el("div", "wmp-toolbar");
    toolbar.appendChild(WMP.el("span", "wmp-logo", "◈ Prix"));

    const seg = WMP.el("div", "wmp-seg");
    for (const s of SORT_KEYS) {
      const b = WMP.el("button", "wmp-segbtn", s.label);
      b.dataset.key = s.key;
      b.addEventListener("click", () => h.onSort(s.key));
      seg.appendChild(b);
    }
    toolbar.appendChild(seg);

    const dir = WMP.el("button", "wmp-btn wmp-dir", "↓");
    dir.title = "Ordre décroissant / croissant";
    dir.addEventListener("click", h.onDir);
    toolbar.appendChild(dir);

    if (state.canList) {
      const lb = WMP.el("button", "wmp-btn wmp-listbtn", "Vue liste");
      lb.title = "Trier toute la collection dans une liste";
      lb.addEventListener("click", h.onList);
      toolbar.appendChild(lb);
    }

    const rf = WMP.el("button", "wmp-btn wmp-refresh", "⟳");
    rf.title = "Recharger les prix (ignore le cache)";
    rf.addEventListener("click", h.onRefresh);
    toolbar.appendChild(rf);

    toolbar.appendChild(WMP.el("span", "wmp-progress"));

    grid.parentElement.insertBefore(toolbar, grid);
    ui.syncToolbar(state);
    return toolbar;
  };

  ui.syncToolbar = (state) => {
    if (!toolbar) return;
    toolbar.querySelectorAll(".wmp-segbtn").forEach((b) => {
      b.classList.toggle("is-on", b.dataset.key === state.sortKey);
    });
    const dir = toolbar.querySelector(".wmp-dir");
    if (dir) {
      dir.textContent = state.sortDir === "asc" ? "↑" : "↓";
      dir.classList.toggle("is-off", state.sortKey === "none");
    }
    const lb = toolbar.querySelector(".wmp-listbtn");
    if (lb) {
      lb.classList.toggle("is-on", state.listView);
      lb.textContent = state.listView ? "Vue cartes" : `Vue liste${state.total ? " (" + state.total + ")" : ""}`;
    }
  };

  ui.destroy = () => {
    if (toolbar) {
      toolbar.remove();
      toolbar = null;
    }
    ui.hideList(null);
  };

  ui.setProgress = (text, busy) => {
    if (!toolbar) return;
    const p = toolbar.querySelector(".wmp-progress");
    if (!p) return;
    p.textContent = text || "";
    p.classList.toggle("is-busy", !!busy);
  };

  /* ---------------- vue liste ---------------- */
  const listState = { q: "", rarity: null, hideEmpty: false, expanded: new Set() };

  ui.hideList = (grid) => {
    if (listWrap) {
      listWrap.remove();
      listWrap = null;
    }
    document.querySelectorAll(".wmp-nativehidden").forEach((n) => {
      n.classList.remove("wmp-nativehidden");
    });
    if (grid) grid.classList.remove("wmp-nativehidden");
  };

  ui.showList = (grid, state) => {
    if (!grid || !grid.parentElement) return;
    grid.classList.add("wmp-nativehidden");
    // masque aussi la pagination native pendant la vue liste
    const host = grid.parentElement;
    [...host.children].forEach((n) => {
      if (n !== grid && n !== toolbar && n !== listWrap && /Suivant|Précédent|Page/.test(n.textContent || "")) {
        n.classList.add("wmp-nativehidden");
      }
    });

    if (!listWrap) {
      listWrap = WMP.el("div", "wmp-list");
      buildListShell(listWrap, state);
      host.insertBefore(listWrap, grid);
    }
    ui.renderList(state);
  };

  function buildListShell(root, state) {
    const head = WMP.el("div", "wmp-list-head");

    const search = WMP.el("input", "wmp-search");
    search.type = "search";
    search.placeholder = "Rechercher une carte…";
    search.value = listState.q;
    search.addEventListener("input", () => {
      listState.q = search.value.trim().toLowerCase();
      ui.renderList(state);
    });
    head.appendChild(search);

    const chips = WMP.el("div", "wmp-chips");
    const mk = (label, val) => {
      const c = WMP.el("button", "wmp-chip", label);
      c.dataset.r = val || "";
      c.addEventListener("click", () => {
        listState.rarity = listState.rarity === val ? null : val;
        ui.renderList(state);
      });
      chips.appendChild(c);
    };
    mk("Toutes", null);
    WMP.RARITIES.forEach((r) => mk(r, r));
    head.appendChild(chips);

    const lab = WMP.el("label", "wmp-check");
    const cb = WMP.el("input");
    cb.type = "checkbox";
    cb.checked = listState.hideEmpty;
    cb.addEventListener("change", () => {
      listState.hideEmpty = cb.checked;
      ui.renderList(state);
    });
    lab.appendChild(cb);
    lab.appendChild(WMP.el("span", null, "masquer les cartes sans vente"));
    head.appendChild(lab);

    head.appendChild(WMP.el("span", "wmp-listcount"));
    root.appendChild(head);

    const table = WMP.el("table", "wmp-table");
    const thead = WMP.el("thead");
    const tr = WMP.el("tr");
    const cols = [
      ["#", null],
      ["Rar.", null],
      ["Carte", null],
      ["Dernier", "last"],
      ["Moy.", "avg"],
      ["Min", "min"],
      ["Max", "max"],
      ["Ventes", "n"],
      ["ATK / DEF", "atk"],
      ["", null],
    ];
    for (const [label, key] of cols) {
      const th = WMP.el("th", key ? "wmp-sortable" : null, label);
      if (key)
        th.addEventListener("click", () => {
          if (ui._listSortCb) ui._listSortCb(key);
        });
      tr.appendChild(th);
    }
    thead.appendChild(tr);
    table.appendChild(thead);
    table.appendChild(WMP.el("tbody"));
    root.appendChild(table);
  }

  ui.onListSort = (cb) => {
    ui._listSortCb = cb;
  };

  ui.renderList = (state) => {
    if (!listWrap) return;
    listWrap.querySelectorAll(".wmp-chip").forEach((c) => {
      c.classList.toggle("is-on", (c.dataset.r || null) === (listState.rarity || null));
    });

    const key = state.sortKey === "none" ? "last" : state.sortKey;
    const dir = state.sortDir;

    let rows = state.rows.slice();
    if (listState.rarity) rows = rows.filter((r) => r.rarity === listState.rarity);
    if (listState.q) rows = rows.filter((r) => r.title.toLowerCase().includes(listState.q) || (r.category || "").toLowerCase().includes(listState.q));

    const val = (r) => {
      if (key === "atk") return r.atk;
      if (key === "def") return r.def;
      const s = WMP.statsFor(r.entry, r.rarity);
      return s ? s[key] : null;
    };
    if (listState.hideEmpty) rows = rows.filter((r) => val(r) != null);

    rows.sort((a, b) => {
      const av = val(a),
        bv = val(b);
      if (av == null && bv == null) return a.title.localeCompare(b.title, "fr");
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av === bv) return a.title.localeCompare(b.title, "fr");
      return dir === "asc" ? av - bv : bv - av;
    });

    const count = listWrap.querySelector(".wmp-listcount");
    if (count) {
      const withData = rows.filter((r) => val(r) != null).length;
      count.textContent = `${rows.length} carte(s) · ${withData} avec prix`;
    }

    const tbody = listWrap.querySelector("tbody");
    tbody.textContent = "";
    const frag = document.createDocumentFragment();

    rows.forEach((r, i) => {
      const s = WMP.statsFor(r.entry, r.rarity);
      const tr = WMP.el("tr", "wmp-row");
      tr.appendChild(WMP.el("td", "wmp-rank", String(i + 1)));

      const rt = WMP.el("td");
      rt.appendChild(WMP.el("span", "wmp-rpill wmp-r-" + r.rarity, r.rarity));
      tr.appendChild(rt);

      const nameTd = WMP.el("td", "wmp-name");
      const title = WMP.el("span", "wmp-title", r.title);
      nameTd.appendChild(title);
      if (r.category) nameTd.appendChild(WMP.el("span", "wmp-cat", r.category));
      if (r.count > 1) nameTd.appendChild(WMP.el("span", "wmp-dup", "×" + r.count));
      tr.appendChild(nameTd);

      const cell = (txt, cls) => {
        const td = WMP.el("td", "wmp-numc " + (cls || ""), txt);
        return td;
      };
      tr.appendChild(cell(s ? WMP.num(s.last) : "—", "wmp-c-last"));
      tr.appendChild(cell(s ? WMP.num1(s.avg) : "—"));
      tr.appendChild(cell(s ? WMP.num(s.min) : "—"));
      tr.appendChild(cell(s ? WMP.num(s.max) : "—"));
      tr.appendChild(cell(s ? WMP.num(s.n) : "—"));
      tr.appendChild(cell(`${WMP.num(r.atk)} / ${WMP.num(r.def)}`, "wmp-atk"));

      const act = WMP.el("td", "wmp-act");
      if (s && s.recent && s.recent.length) {
        const chev = WMP.el("button", "wmp-chev", "▾");
        chev.title = "Dernières ventes";
        act.appendChild(chev);
        chev.addEventListener("click", (ev) => {
          ev.stopPropagation();
          toggleDetail(tr, r, s, chev);
        });
      }
      if (r.url) {
        const a = WMP.el("a", "wmp-wiki", "W");
        a.href = r.url;
        a.target = "_blank";
        a.rel = "noreferrer";
        a.title = "Voir l'article Wikipédia";
        act.appendChild(a);
      }
      tr.appendChild(act);
      frag.appendChild(tr);
    });

    tbody.appendChild(frag);
  };

  function toggleDetail(tr, r, s, chev) {
    const next = tr.nextElementSibling;
    if (next && next.classList.contains("wmp-detail")) {
      next.remove();
      chev.textContent = "▾";
      return;
    }
    chev.textContent = "▴";
    const d = WMP.el("tr", "wmp-detail");
    const td = WMP.el("td");
    td.colSpan = 10;
    const box = WMP.el("div", "wmp-detailbox");
    box.appendChild(
      WMP.el(
        "div",
        "wmp-detailhead",
        `${s.n} vente(s) — ${WMP.settings.rarityMode === "all" ? "toutes raretés" : WMP.RARITY_LABEL[r.rarity] || r.rarity}`
      )
    );
    const ul = WMP.el("div", "wmp-sales");
    for (const [price, ts] of s.recent) {
      const row = WMP.el("div", "wmp-sale");
      row.appendChild(WMP.el("span", "wmp-saledate", WMP.dateTime(ts)));
      row.appendChild(WMP.el("span", "wmp-saleprice", "◈ " + WMP.num(price)));
      ul.appendChild(row);
    }
    box.appendChild(ul);
    td.appendChild(box);
    d.appendChild(td);
    tr.parentElement.insertBefore(d, tr.nextSibling);
  }
})();

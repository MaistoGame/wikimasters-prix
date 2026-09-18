/* Réglages partagés + petits utilitaires. Tout vit sous window.WMP. */
(() => {
  const WMP = (window.WMP = window.WMP || {});

  WMP.RARITIES = ["L", "UR", "SR", "R", "PC", "C"];
  WMP.RARITY_LABEL = {
    L: "Légendaire",
    UR: "Ultra Rare",
    SR: "Super Rare",
    R: "Rare",
    PC: "Peu Commune",
    C: "Commune",
  };
  WMP.RARITY_RANK = { L: 0, UR: 1, SR: 2, R: 3, PC: 4, C: 5 };

  WMP.DEFAULTS = {
    badges: true,        // afficher les badges sur les cartes
    showLast: true,      // Dernier
    showAvg: true,       // Moyenne
    showMinMax: true,    // Min / Max
    showCount: true,     // Nombre de ventes
    rarityMode: "card",  // "card" = raretés de la carte | "all" = toutes raretés
    autoPrefetch: true,  // précharger toute la collection (tri global)
    ttlHours: 12,        // durée de vie du cache des prix
    concurrency: 5,      // requêtes simultanées
    underCard: true,     // badge sous la carte quand il y a la place
    overlayCompact: true, // en superposition (pas de place dessous) : dernier prix seul
  };

  WMP.settings = { ...WMP.DEFAULTS };

  WMP.loadSettings = async () => {
    try {
      const got = await chrome.storage.sync.get("settings");
      WMP.settings = { ...WMP.DEFAULTS, ...(got.settings || {}) };
    } catch (e) {
      WMP.settings = { ...WMP.DEFAULTS };
    }
    return WMP.settings;
  };

  WMP.saveSettings = (patch) =>
    chrome.storage.sync.set({ settings: { ...WMP.settings, ...patch } });

  WMP.onSettingsChange = (cb) => {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "sync" && changes.settings) {
        WMP.settings = { ...WMP.DEFAULTS, ...(changes.settings.newValue || {}) };
        cb(WMP.settings);
      }
    });
  };

  const NF = new Intl.NumberFormat("fr-FR");
  WMP.num = (n) => (n == null || Number.isNaN(n) ? "—" : NF.format(Math.round(n)));
  WMP.num1 = (n) =>
    n == null || Number.isNaN(n)
      ? "—"
      : new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(n);
  WMP.date = (iso) => {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleDateString("fr-FR", {
        day: "2-digit",
        month: "short",
        year: "2-digit",
      });
    } catch (e) {
      return "";
    }
  };
  WMP.dateTime = (iso) => {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleString("fr-FR", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (e) {
      return "";
    }
  };

  WMP.debounce = (fn, ms) => {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  };

  WMP.el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
})();

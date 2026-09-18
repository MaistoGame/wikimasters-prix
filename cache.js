/* Cache des prix (chrome.storage.local) + cache mémoire. */
(() => {
  const WMP = window.WMP;
  const PREFIX = "p:";
  const TITLES_KEY = "wmp_titles";
  const mem = new Map();

  WMP.cache = {
    async getMany(cardIds) {
      const out = new Map();
      const missing = [];
      for (const id of cardIds) {
        if (mem.has(id)) out.set(id, mem.get(id));
        else missing.push(id);
      }
      if (missing.length) {
        const keys = missing.map((id) => PREFIX + id);
        // chrome.storage.local.get accepte jusqu'à quelques milliers de clés ; on découpe par sécurité
        for (let i = 0; i < keys.length; i += 500) {
          const slice = keys.slice(i, i + 500);
          let got = {};
          try {
            got = await chrome.storage.local.get(slice);
          } catch (e) {
            got = {};
          }
          for (const k of slice) {
            const v = got[k];
            if (v) {
              const id = k.slice(PREFIX.length);
              mem.set(id, v);
              out.set(id, v);
            }
          }
        }
      }
      return out;
    },

    async set(cardId, entry) {
      mem.set(cardId, entry);
      try {
        await chrome.storage.local.set({ [PREFIX + cardId]: entry });
      } catch (e) {
        /* quota : on garde au moins la version mémoire */
      }
    },

    fresh(entry, ttlHours) {
      return !!entry && Date.now() - entry.t < (ttlHours || 12) * 3600e3;
    },

    async stats() {
      const all = await chrome.storage.local.get(null);
      const keys = Object.keys(all).filter((k) => k.startsWith(PREFIX));
      let newest = 0;
      for (const k of keys) if (all[k] && all[k].t > newest) newest = all[k].t;
      return { count: keys.length, newest };
    },

    async clear() {
      mem.clear();
      const all = await chrome.storage.local.get(null);
      const keys = Object.keys(all).filter((k) => k.startsWith(PREFIX));
      if (keys.length) await chrome.storage.local.remove(keys);
    },

    /* titre -> { id, rarity, wikipedia_url } résolus via la table publique `cards` */
    async getTitles() {
      const got = await chrome.storage.local.get(TITLES_KEY);
      return got[TITLES_KEY] || {};
    },
    async addTitles(map) {
      const cur = await this.getTitles();
      let n = 0;
      for (const [title, row] of map) {
        cur[title] = { id: row.id, rarity: row.rarity, url: row.wikipedia_url || null };
        n++;
      }
      // borne le dictionnaire pour ne pas gonfler indéfiniment
      const keys = Object.keys(cur);
      if (keys.length > 8000) for (const k of keys.slice(0, keys.length - 8000)) delete cur[k];
      if (n) await chrome.storage.local.set({ [TITLES_KEY]: cur });
      return cur;
    },
  };
})();

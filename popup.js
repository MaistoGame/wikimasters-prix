const DEFAULTS = {
  badges: true,
  showLast: true,
  showAvg: true,
  showMinMax: true,
  showCount: true,
  rarityMode: "card",
  autoPrefetch: true,
  ttlHours: 12,
  concurrency: 5,
  underCard: true,
  overlayCompact: true,
};

const BOOLS = ["badges", "showLast", "showAvg", "showMinMax", "showCount", "autoPrefetch", "underCard", "overlayCompact"];
const NUMS = ["ttlHours", "concurrency"];

let settings = { ...DEFAULTS };

function paint() {
  for (const k of BOOLS) document.getElementById(k).checked = !!settings[k];
  for (const k of NUMS) document.getElementById(k).value = settings[k];
  document.getElementById("rarityMode").value = settings.rarityMode;
}

function save(patch) {
  settings = { ...settings, ...patch };
  chrome.storage.sync.set({ settings });
}

async function info() {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith("p:"));
  let newest = 0;
  for (const k of keys) if (all[k] && all[k].t > newest) newest = all[k].t;
  document.getElementById("info").textContent = keys.length
    ? `${keys.length} carte(s) en cache · maj ${new Date(newest).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`
    : "cache vide";
}

(async () => {
  const got = await chrome.storage.sync.get("settings");
  settings = { ...DEFAULTS, ...(got.settings || {}) };
  paint();
  info();

  for (const k of BOOLS) {
    document.getElementById(k).addEventListener("change", (e) => save({ [k]: e.target.checked }));
  }
  for (const k of NUMS) {
    document.getElementById(k).addEventListener("change", (e) => {
      const v = Math.max(1, Math.min(k === "concurrency" ? 8 : 168, parseInt(e.target.value, 10) || DEFAULTS[k]));
      e.target.value = v;
      save({ [k]: v });
    });
  }
  document.getElementById("rarityMode").addEventListener("change", (e) => save({ rarityMode: e.target.value }));

  document.getElementById("clear").addEventListener("click", async () => {
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all).filter((k) => k.startsWith("p:"));
    if (keys.length) await chrome.storage.local.remove(keys);
    info();
  });
})();

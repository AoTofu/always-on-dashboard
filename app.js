const DEFAULT_CONFIG = {
  location: {
    label: "Tokyo",
    latitude: 35.6762,
    longitude: 139.6503,
    timezone: "Asia/Tokyo"
  },
  weather: { refreshMinutes: 30 },
  markets: { refreshMinutes: 5, symbols: [] },
  news: { refreshMinutes: 20, limit: 5 }
};

const CACHE_KEYS = {
  weather: "always-on-dashboard:weather",
  markets: "always-on-dashboard:markets",
  news: "always-on-dashboard:news"
};

const WEATHER_CODES = new Map([
  [0, "快晴"],
  [1, "晴れ"],
  [2, "一部くもり"],
  [3, "くもり"],
  [45, "霧"],
  [48, "霧氷"],
  [51, "弱い霧雨"],
  [53, "霧雨"],
  [55, "強い霧雨"],
  [61, "小雨"],
  [63, "雨"],
  [65, "強い雨"],
  [71, "小雪"],
  [73, "雪"],
  [75, "大雪"],
  [80, "にわか雨"],
  [81, "強いにわか雨"],
  [82, "激しいにわか雨"],
  [95, "雷雨"],
  [96, "雷雨とひょう"],
  [99, "激しい雷雨とひょう"]
]);

const formatters = {
  time: new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }),
  shortTime: new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }),
  date: new Intl.DateTimeFormat("ja-JP", {
    month: "long",
    day: "numeric",
    weekday: "long"
  }),
  sync: new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }),
  weekday: new Intl.DateTimeFormat("ja-JP", {
    weekday: "short"
  })
};

let config = DEFAULT_CONFIG;
let activeLocation = DEFAULT_CONFIG.location;
let timers = [];
let batteryManager = null;
let sunTimes = {
  sunrise: null,
  sunset: null
};

const els = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindElements();
  buildClockMarks();
  updateClock();
  setupNetwork();
  await setupBattery();
  renderCachedData();

  try {
    config = await fetchJson("/api/config");
  } catch (error) {
    config = DEFAULT_CONFIG;
  }

  renderConfig();
  startIntervals();
  await refreshAll();
  setupGeoLocation().then(refreshWeather).catch(() => {});

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    updateClock();
    updateSunCard();
    refreshAll();
  });
}

function bindElements() {
  [
    "networkDot",
    "networkStatus",
    "powerChip",
    "lastSync",
    "dateLine",
    "digitalTime",
    "analogClock",
    "clockFace",
    "weatherUpdated",
    "weatherLocation",
    "weatherTemp",
    "weatherCondition",
    "weatherRange",
    "weatherFeels",
    "weatherWind",
    "forecastList",
    "sunLength",
    "sunEventLabel",
    "sunEventTime",
    "sunAltTime",
    "sunDot",
    "marketsUpdated",
    "marketList",
    "dayMeter",
    "dayPercent",
    "weekMeter",
    "weekPercent",
    "batteryMeter",
    "batteryPercent",
    "newsUpdated",
    "newsList"
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function buildClockMarks() {
  for (let i = 0; i < 12; i += 1) {
    const angle = (i / 12) * Math.PI * 2;
    const mark = document.createElement("span");
    mark.className = i % 3 === 0 ? "clock-mark major" : "clock-mark";
    mark.style.left = `${50 + Math.sin(angle) * 43}%`;
    mark.style.top = `${50 - Math.cos(angle) * 43}%`;
    mark.style.transform = `translate(-50%, -50%) rotate(${i * 30}deg)`;
    els.clockFace.append(mark);
  }
}

function renderConfig() {
  activeLocation = normalizeLocation(config.location);
  renderWeatherLocation(activeLocation, "設定位置");
}

function startIntervals() {
  timers.forEach((timer) => clearInterval(timer));
  timers = [
    setInterval(updateClock, 1000),
    setInterval(() => runWhenVisible(updateSunCard), 60 * 1000),
    setInterval(() => runWhenVisible(refreshWeather), minutesToMs(config.weather?.refreshMinutes, 30)),
    setInterval(() => runWhenVisible(refreshMarkets), minutesToMs(config.markets?.refreshMinutes, 5)),
    setInterval(() => runWhenVisible(refreshNews), minutesToMs(config.news?.refreshMinutes, 20))
  ];
}

function runWhenVisible(task) {
  if (!document.hidden) {
    task();
  }
}

async function refreshAll() {
  await Promise.allSettled([refreshWeather(), refreshMarkets(), refreshNews()]);
}

function updateClock() {
  const now = new Date();
  const seconds = now.getSeconds();
  const minutes = now.getMinutes() + seconds / 60;
  const hours = (now.getHours() % 12) + minutes / 60;

  els.digitalTime.textContent = formatters.time.format(now);
  els.dateLine.textContent = formatters.date.format(now);
  els.analogClock.style.setProperty("--second-deg", `${seconds * 6}deg`);
  els.analogClock.style.setProperty("--minute-deg", `${minutes * 6}deg`);
  els.analogClock.style.setProperty("--hour-deg", `${hours * 30}deg`);

  updateProgressMeters(now);
}

function updateProgressMeters(now) {
  const minutesToday = now.getHours() * 60 + now.getMinutes();
  const dayProgress = clamp((minutesToday / 1440) * 100, 0, 100);
  const mondayFirstDay = (now.getDay() + 6) % 7;
  const weekProgress = clamp(((mondayFirstDay + dayProgress / 100) / 7) * 100, 0, 100);

  setMeter(els.dayMeter, dayProgress);
  setMeter(els.weekMeter, weekProgress);
  els.dayPercent.textContent = `${Math.round(dayProgress)}%`;
  els.weekPercent.textContent = `${Math.round(weekProgress)}%`;
}

async function refreshWeather() {
  try {
    const payload = await fetchJson(weatherUrl());
    writeCache(CACHE_KEYS.weather, payload);
    renderWeather(payload);
    updateLastSync();
  } catch (error) {
    const cached = readCache(CACHE_KEYS.weather);
    if (cached) renderWeather({ ...cached, cacheState: "stale" });
    els.weatherUpdated.textContent = "未取得";
  }
}

function renderWeather(payload) {
  const current = payload.current || {};
  const daily = payload.daily || {};
  const weatherCode = current.weatherCode ?? daily.weatherCode;
  const temp = formatNumber(current.temperature, 0);
  const high = formatNumber(daily.high, 0);
  const low = formatNumber(daily.low, 0);
  const feels = formatNumber(current.apparentTemperature, 0);
  const wind = formatNumber(current.windSpeed, 1);
  const sunrise = daily.sunrise ? new Date(daily.sunrise) : null;
  const sunset = daily.sunset ? new Date(daily.sunset) : null;

  renderWeatherLocation(payload.location || activeLocation, activeLocation.source);
  els.weatherTemp.textContent = temp === "--" ? "--°" : `${temp}°`;
  els.weatherCondition.textContent = WEATHER_CODES.get(weatherCode) || "天気情報";
  els.weatherRange.textContent = `H ${high}° / L ${low}°`;
  els.weatherFeels.textContent = `体感 ${feels}°`;
  els.weatherWind.textContent = `風 ${wind} m/s`;
  els.weatherUpdated.textContent = statusTime(payload.updatedAt, payload.cacheState);
  renderForecast(daily.forecast || []);

  if (sunrise && sunset) {
    sunTimes = { sunrise, sunset };
    updateSunCard();
  }
}

function renderForecast(forecast) {
  els.forecastList.replaceChildren();
  const rows = forecast.slice(0, 7);

  if (!rows.length) {
    els.forecastList.append(emptyLine("週間予報なし"));
    return;
  }

  const lows = rows.map((day) => Number(day.low)).filter(Number.isFinite);
  const highs = rows.map((day) => Number(day.high)).filter(Number.isFinite);
  if (!lows.length || !highs.length) {
    els.forecastList.append(emptyLine("週間予報なし"));
    return;
  }
  const minLow = Math.min(...lows);
  const maxHigh = Math.max(...highs);
  const spread = Math.max(1, maxHigh - minLow);

  rows.forEach((day, index) => {
    const row = document.createElement("div");
    row.className = "forecast-row";

    const name = document.createElement("span");
    name.className = "forecast-day";
    name.textContent = index === 0 ? "Today" : formatters.weekday.format(new Date(`${day.date}T00:00:00`));

    const icon = document.createElement("span");
    icon.className = "forecast-icon";
    icon.textContent = weatherIcon(day.weatherCode);

    const low = document.createElement("span");
    low.className = "forecast-low";
    low.textContent = `${formatNumber(day.low, 0)}°`;

    const range = document.createElement("span");
    range.className = "forecast-range";
    const fill = document.createElement("i");
    const start = clamp(((Number(day.low) - minLow) / spread) * 100, 0, 88);
    const width = clamp(((Number(day.high) - Number(day.low)) / spread) * 100, 10, 100 - start);
    fill.style.left = `${start}%`;
    fill.style.width = `${width}%`;
    range.append(fill);

    const high = document.createElement("span");
    high.className = "forecast-high";
    high.textContent = `${formatNumber(day.high, 0)}°`;

    row.append(name, icon, low, range, high);
    els.forecastList.append(row);
  });
}

function renderSunProgress(sunrise, sunset) {
  const now = new Date();
  const total = sunset.getTime() - sunrise.getTime();
  const elapsed = now.getTime() - sunrise.getTime();
  const progress = total > 0 ? clamp((elapsed / total) * 100, 0, 100) : 0;
  const daylightMinutes = Math.max(0, Math.round(total / 60000));
  const hours = Math.floor(daylightMinutes / 60);
  const minutes = daylightMinutes % 60;

  const isDaytime = now >= sunrise && now < sunset;
  els.sunEventLabel.textContent = isDaytime ? "Sunset" : "Sunrise";
  els.sunEventTime.textContent = formatters.shortTime.format(isDaytime ? sunset : sunrise);
  els.sunAltTime.textContent = isDaytime
    ? `Sunrise: ${formatters.shortTime.format(sunrise)}`
    : `Sunset: ${formatters.shortTime.format(sunset)}`;
  const dotProgress = now < sunrise ? 0 : progress;
  const dot = sunArcPoint(dotProgress);
  els.sunDot.style.left = `${dot.left}%`;
  els.sunDot.style.top = `${dot.top}%`;
  els.sunLength.textContent = `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

function updateSunCard() {
  if (sunTimes.sunrise && sunTimes.sunset) {
    renderSunProgress(sunTimes.sunrise, sunTimes.sunset);
  }
}

function sunArcPoint(progress) {
  const normalized = clamp(progress, 0, 100) / 100;
  const firstHalf = normalized <= 0.5;
  const t = firstHalf ? normalized * 2 : (normalized - 0.5) * 2;
  const points = firstHalf
    ? [
        { x: 18, y: 94 },
        { x: 70, y: 88 },
        { x: 92, y: 34 },
        { x: 150, y: 28 }
      ]
    : [
        { x: 150, y: 28 },
        { x: 211, y: 23 },
        { x: 238, y: 77 },
        { x: 302, y: 88 }
      ];
  const point = cubicBezierPoint(points, t);

  return {
    left: (point.x / 320) * 100,
    top: (point.y / 116) * 100
  };
}

function cubicBezierPoint(points, t) {
  const inverse = 1 - t;
  const a = inverse ** 3;
  const b = 3 * inverse ** 2 * t;
  const c = 3 * inverse * t ** 2;
  const d = t ** 3;

  return {
    x: a * points[0].x + b * points[1].x + c * points[2].x + d * points[3].x,
    y: a * points[0].y + b * points[1].y + c * points[2].y + d * points[3].y
  };
}

function weatherIcon(code) {
  if ([0, 1].includes(code)) return "☀";
  if (code === 2) return "🌤";
  if (code === 3) return "☁";
  if ([45, 48].includes(code)) return "🌫";
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) return "🌧";
  if ([71, 73, 75].includes(code)) return "❄";
  if ([95, 96, 99].includes(code)) return "⛈";
  return "•";
}

async function refreshMarkets() {
  try {
    const payload = await fetchJson("/api/markets");
    writeCache(CACHE_KEYS.markets, payload);
    renderMarkets(payload);
    updateLastSync();
  } catch (error) {
    const cached = readCache(CACHE_KEYS.markets);
    if (cached) renderMarkets({ ...cached, cacheState: "stale" });
    els.marketsUpdated.textContent = "未取得";
  }
}

function renderMarkets(payload) {
  const quotes = Array.isArray(payload.quotes) ? payload.quotes : [];
  els.marketList.replaceChildren();

  if (!quotes.length) {
    els.marketList.append(emptyLine("未取得"));
    return;
  }

  quotes.forEach((quote) => {
    const row = document.createElement("div");
    const change = Number(quote.change);
    row.className = `market-row ${change >= 0 ? "positive" : "negative"}`;

    const name = document.createElement("div");
    name.className = "market-name";
    const label = document.createElement("strong");
    label.textContent = quote.label || quote.symbol;
    const symbol = document.createElement("span");
    symbol.textContent = quote.error ? `${quote.symbol} / 未取得` : quote.symbol;
    name.append(label, symbol);

    const price = document.createElement("div");
    price.className = "market-price";
    const value = document.createElement("strong");
    value.textContent = quote.error ? "--" : formatPrice(quote.price, quote.currency);
    const delta = document.createElement("span");
    delta.textContent = quote.error ? "offline" : formatChange(quote.change, quote.changePercent);
    price.append(value, delta);

    row.append(name, price);
    els.marketList.append(row);
  });

  els.marketsUpdated.textContent = statusTime(payload.updatedAt, payload.cacheState);
}

async function refreshNews() {
  try {
    const payload = await fetchJson("/api/news");
    const items = parseNews(payload.xml, config.news?.limit || 5);
    const normalized = { ...payload, items };
    writeCache(CACHE_KEYS.news, normalized);
    renderNews(normalized);
    updateLastSync();
  } catch (error) {
    const cached = readCache(CACHE_KEYS.news);
    if (cached) renderNews({ ...cached, cacheState: "stale" });
    els.newsUpdated.textContent = "未取得";
  }
}

function parseNews(xml, limit) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const parserError = doc.querySelector("parsererror");
  if (parserError) throw new Error("Invalid RSS");

  return Array.from(doc.querySelectorAll("item")).slice(0, limit).map((item) => ({
    title: textFrom(item, "title"),
    link: textFrom(item, "link"),
    source: textFrom(item, "source"),
    pubDate: textFrom(item, "pubDate")
  }));
}

function renderNews(payload) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  els.newsList.replaceChildren();

  if (!items.length) {
    els.newsList.append(emptyLine("未取得"));
    return;
  }

  items.forEach((item) => {
    const article = document.createElement("a");
    article.className = "news-item";
    article.href = item.link || "#";
    article.target = "_blank";
    article.rel = "noreferrer";

    const title = document.createElement("span");
    title.className = "news-title";
    title.textContent = item.title || "No title";

    const meta = document.createElement("span");
    meta.className = "news-meta";
    meta.textContent = [item.source, relativeNewsTime(item.pubDate)].filter(Boolean).join(" / ");

    article.append(title, meta);
    els.newsList.append(article);
  });

  els.newsUpdated.textContent = statusTime(payload.updatedAt, payload.cacheState);
}

function setupNetwork() {
  const update = () => {
    const online = navigator.onLine;
    els.networkDot.className = `chip-dot ${online ? "online" : "offline"}`;
    els.networkStatus.textContent = online ? "Online" : "Offline";
  };

  update();
  window.addEventListener("online", update);
  window.addEventListener("offline", update);
}

async function setupBattery() {
  if (!("getBattery" in navigator)) {
    els.powerChip.textContent = "Power --";
    els.batteryPercent.textContent = "--";
    setMeter(els.batteryMeter, 0);
    return;
  }

  batteryManager = await navigator.getBattery();
  const update = () => {
    const percent = Math.round(batteryManager.level * 100);
    els.powerChip.textContent = batteryManager.charging ? `Power ${percent}% / AC` : `Power ${percent}%`;
    els.batteryPercent.textContent = `${percent}%`;
    setMeter(els.batteryMeter, percent);
  };

  update();
  batteryManager.addEventListener("chargingchange", update);
  batteryManager.addEventListener("levelchange", update);
}

async function setupGeoLocation() {
  activeLocation = normalizeLocation(config.location);

  if (!("geolocation" in navigator)) {
    renderWeatherLocation(activeLocation, "設定位置");
    return;
  }

  renderWeatherLocation({ label: "現在地を確認中", latitude: activeLocation.latitude, longitude: activeLocation.longitude }, "GPS");

  let resolved = false;
  const fallbackTimer = setTimeout(() => {
    if (!resolved) {
      renderWeatherLocation(activeLocation, "設定位置");
    }
  }, 10000);

  try {
    const position = await getCurrentPosition();
    resolved = true;
    clearTimeout(fallbackTimer);
    const latitude = Number(position.coords.latitude.toFixed(5));
    const longitude = Number(position.coords.longitude.toFixed(5));
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || config.location?.timezone || "Asia/Tokyo";
    const geoLabel = await resolveLocationLabel(latitude, longitude);

    activeLocation = {
      label: geoLabel || `${latitude.toFixed(2)}, ${longitude.toFixed(2)}`,
      latitude,
      longitude,
      timezone,
      source: "GPS"
    };
    renderWeatherLocation(activeLocation, "GPS");
  } catch (error) {
    resolved = true;
    clearTimeout(fallbackTimer);
    activeLocation = normalizeLocation(config.location);
    renderWeatherLocation(activeLocation, "設定位置");
  }
}

function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      maximumAge: 60 * 60 * 1000,
      timeout: 60000
    });
  });
}

async function resolveLocationLabel(latitude, longitude) {
  try {
    const params = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude)
    });
    const payload = await fetchJson(`/api/reverse-geocode?${params}`);
    return payload.label;
  } catch (error) {
    return "";
  }
}

function weatherUrl() {
  const location = activeLocation || normalizeLocation(config.location);
  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    timezone: location.timezone || "Asia/Tokyo",
    label: location.label || "現在地"
  });
  return `/api/weather?${params}`;
}

function normalizeLocation(location = {}) {
  return {
    label: location.label || "Tokyo",
    latitude: Number.isFinite(Number(location.latitude)) ? Number(location.latitude) : 35.6762,
    longitude: Number.isFinite(Number(location.longitude)) ? Number(location.longitude) : 139.6503,
    timezone: location.timezone || "Asia/Tokyo",
    source: location.source || "設定位置"
  };
}

function renderWeatherLocation(location, source = location?.source) {
  const label = location?.label || "現在地";
  const sourceLabel = source ? ` / ${source}` : "";
  els.weatherLocation.textContent = `${label}${sourceLabel}`;
}

function renderCachedData() {
  const weather = readCache(CACHE_KEYS.weather);
  const markets = readCache(CACHE_KEYS.markets);
  const news = readCache(CACHE_KEYS.news);

  if (weather) renderWeather({ ...weather, cacheState: "stale" });
  if (markets) renderMarkets({ ...markets, cacheState: "stale" });
  if (news) renderNews({ ...news, cacheState: "stale" });
}

function updateLastSync() {
  els.lastSync.textContent = `Sync ${formatters.sync.format(new Date())}`;
}

function setMeter(el, percent) {
  const value = `${clamp(percent, 0, 100)}%`;
  el.style.width = value;
  el.style.height = "100%";
}

function minutesToMs(value, fallback) {
  const minutes = Number(value);
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : fallback) * 60 * 1000;
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

function readCache(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
}

function writeCache(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    return null;
  }
}

function formatNumber(value, digits) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return new Intl.NumberFormat("ja-JP", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(number);
}

function formatPrice(value, currency) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  const digits = currency === "JPY" ? 0 : 2;
  return new Intl.NumberFormat("ja-JP", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  }).format(number);
}

function formatChange(change, changePercent) {
  const delta = Number(change);
  const percent = Number(changePercent);
  if (!Number.isFinite(delta) || !Number.isFinite(percent)) return "--";
  const sign = delta >= 0 ? "+" : "";
  return `${sign}${formatNumber(delta, 2)} / ${sign}${formatNumber(percent, 2)}%`;
}

function statusTime(iso, cacheState) {
  if (!iso) return cacheState === "stale" ? "cached" : "--";
  const label = formatters.sync.format(new Date(iso));
  return cacheState === "stale" ? `${label} cached` : label;
}

function relativeNewsTime(pubDate) {
  const time = pubDate ? new Date(pubDate).getTime() : NaN;
  if (!Number.isFinite(time)) return "";
  const diffMinutes = Math.max(0, Math.round((Date.now() - time) / 60000));
  if (diffMinutes < 60) return `${diffMinutes}分前`;
  const hours = Math.round(diffMinutes / 60);
  if (hours < 24) return `${hours}時間前`;
  return `${Math.round(hours / 24)}日前`;
}

function textFrom(parent, selector) {
  return parent.querySelector(selector)?.textContent?.trim() || "";
}

function emptyLine(text) {
  const div = document.createElement("div");
  div.className = "empty-line";
  div.textContent = text;
  return div;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

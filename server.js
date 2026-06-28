const http = require("node:http");
const path = require("node:path");
const { readFile } = require("node:fs/promises");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 4173);
const cache = new Map();

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".ico": "image/x-icon"
};

async function readConfig() {
  const raw = await readFile(path.join(ROOT, "config.json"), "utf8");
  return JSON.parse(raw);
}

function ttlFromMinutes(value, fallbackMinutes) {
  const minutes = Number(value);
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : fallbackMinutes) * 60 * 1000;
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, body, contentType) {
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store"
  });
  res.end(body);
}

async function fetchJson(url, headers = {}) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(10000),
    headers: {
      "User-Agent": "always-on-dashboard/1.0",
      ...headers
    }
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(10000),
    headers: {
      "User-Agent": "always-on-dashboard/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

async function withCache(key, ttlMs, loader) {
  const now = Date.now();
  const existing = cache.get(key);

  if (existing && now - existing.cachedAt < ttlMs) {
    return {
      ...existing.value,
      cacheState: "fresh",
      cachedAt: new Date(existing.cachedAt).toISOString()
    };
  }

  try {
    const value = await loader();
    cache.set(key, { value, cachedAt: now });
    return {
      ...value,
      cacheState: "live",
      cachedAt: new Date(now).toISOString()
    };
  } catch (error) {
    if (existing) {
      return {
        ...existing.value,
        cacheState: "stale",
        cachedAt: new Date(existing.cachedAt).toISOString(),
        warning: error.message
      };
    }

    throw error;
  }
}

async function handleConfig(_req, res) {
  const config = await readConfig();
  sendJson(res, 200, config);
}

async function handleWeather(req, res) {
  const config = await readConfig();
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const latitude = Number(requestUrl.searchParams.get("latitude") ?? config.location.latitude);
  const longitude = Number(requestUrl.searchParams.get("longitude") ?? config.location.longitude);
  const timezone = requestUrl.searchParams.get("timezone") || config.location.timezone;
  const label = requestUrl.searchParams.get("label") || config.location.label;

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    sendJson(res, 400, { error: "Invalid latitude or longitude" });
    return;
  }

  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    timezone,
    forecast_days: "7",
    current: [
      "temperature_2m",
      "apparent_temperature",
      "relative_humidity_2m",
      "weather_code",
      "wind_speed_10m",
      "precipitation"
    ].join(","),
    daily: [
      "sunrise",
      "sunset",
      "temperature_2m_max",
      "temperature_2m_min",
      "weather_code",
      "precipitation_probability_max"
    ].join(",")
  });

  const cacheKey = `weather:${latitude}:${longitude}:${timezone}`;
  const ttlMs = ttlFromMinutes(config.weather?.refreshMinutes, 30);

  const payload = await withCache(cacheKey, ttlMs, async () => {
    const data = await fetchJson(`https://api.open-meteo.com/v1/forecast?${params}`);
    return {
      updatedAt: new Date().toISOString(),
      location: { label, latitude, longitude, timezone },
      current: {
        time: data.current?.time ?? null,
        temperature: data.current?.temperature_2m ?? null,
        apparentTemperature: data.current?.apparent_temperature ?? null,
        humidity: data.current?.relative_humidity_2m ?? null,
        weatherCode: data.current?.weather_code ?? null,
        windSpeed: data.current?.wind_speed_10m ?? null,
        precipitation: data.current?.precipitation ?? null
      },
      daily: {
        sunrise: data.daily?.sunrise?.[0] ?? null,
        sunset: data.daily?.sunset?.[0] ?? null,
        high: data.daily?.temperature_2m_max?.[0] ?? null,
        low: data.daily?.temperature_2m_min?.[0] ?? null,
        weatherCode: data.daily?.weather_code?.[0] ?? null,
        forecast: (data.daily?.time ?? []).map((date, index) => ({
          date,
          high: data.daily?.temperature_2m_max?.[index] ?? null,
          low: data.daily?.temperature_2m_min?.[index] ?? null,
          weatherCode: data.daily?.weather_code?.[index] ?? null,
          precipitationProbability: data.daily?.precipitation_probability_max?.[index] ?? null
        }))
      }
    };
  });

  sendJson(res, 200, payload);
}

async function handleReverseGeocode(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const latitude = Number(requestUrl.searchParams.get("latitude"));
  const longitude = Number(requestUrl.searchParams.get("longitude"));

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    sendJson(res, 400, { error: "Invalid latitude or longitude" });
    return;
  }

  const cacheKey = `reverse:${latitude.toFixed(4)}:${longitude.toFixed(4)}`;
  const payload = await withCache(cacheKey, 24 * 60 * 60 * 1000, async () => {
    const params = new URLSearchParams({
      format: "jsonv2",
      lat: String(latitude),
      lon: String(longitude),
      "accept-language": "ja"
    });
    const data = await fetchJson(`https://nominatim.openstreetmap.org/reverse?${params}`, {
      Accept: "application/json"
    });
    const address = data.address || {};
    const locality =
      address.city ||
      address.town ||
      address.village ||
      address.ward ||
      address.suburb ||
      address.county ||
      "";
    const region = address.state || address.province || "";
    const country = address.country || "";
    const label = [locality, region].filter(Boolean).join(", ") || data.display_name?.split(",").slice(0, 2).join(", ") || `${latitude.toFixed(2)}, ${longitude.toFixed(2)}`;

    return {
      updatedAt: new Date().toISOString(),
      latitude,
      longitude,
      label,
      country
    };
  });

  sendJson(res, 200, payload);
}

async function fetchQuote(item) {
  const symbol = item.symbol;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=5m`;
  const data = await fetchJson(url);
  const result = data.chart?.result?.[0];

  if (!result) {
    const reason = data.chart?.error?.description || "No quote data";
    throw new Error(reason);
  }

  const meta = result.meta ?? {};
  const quote = result.indicators?.quote?.[0] ?? {};
  const closes = Array.isArray(quote.close) ? quote.close.filter(Number.isFinite) : [];
  const fallbackPrice = closes.length ? closes[closes.length - 1] : null;
  const price = Number.isFinite(meta.regularMarketPrice) ? meta.regularMarketPrice : fallbackPrice;
  const previousClose = Number.isFinite(meta.chartPreviousClose) ? meta.chartPreviousClose : closes[0] ?? null;
  const change = Number.isFinite(price) && Number.isFinite(previousClose) ? price - previousClose : null;
  const changePercent = Number.isFinite(change) && previousClose ? (change / previousClose) * 100 : null;

  return {
    symbol,
    label: item.label || meta.shortName || symbol,
    currency: meta.currency || null,
    exchange: meta.fullExchangeName || meta.exchangeName || null,
    price,
    previousClose,
    change,
    changePercent,
    marketTime: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null
  };
}

async function handleMarkets(_req, res) {
  const config = await readConfig();
  const symbols = Array.isArray(config.markets?.symbols) ? config.markets.symbols : [];
  const cacheKey = `markets:${symbols.map((item) => item.symbol).join(",")}`;
  const ttlMs = ttlFromMinutes(config.markets?.refreshMinutes, 5);

  const payload = await withCache(cacheKey, ttlMs, async () => {
    const quotes = await Promise.all(
      symbols.map(async (item) => {
        try {
          return await fetchQuote(item);
        } catch (error) {
          return {
            symbol: item.symbol,
            label: item.label || item.symbol,
            error: error.message
          };
        }
      })
    );

    return {
      updatedAt: new Date().toISOString(),
      quotes
    };
  });

  sendJson(res, 200, payload);
}

async function handleNews(_req, res) {
  const config = await readConfig();
  const rssUrl = config.news?.rssUrl || "https://news.google.com/rss?hl=ja&gl=JP&ceid=JP:ja";
  const ttlMs = ttlFromMinutes(config.news?.refreshMinutes, 20);

  const payload = await withCache(`news:${rssUrl}`, ttlMs, async () => {
    const xml = await fetchText(rssUrl);
    return {
      updatedAt: new Date().toISOString(),
      rssUrl,
      xml
    };
  });

  sendJson(res, 200, payload);
}

async function serveStatic(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(requestUrl.pathname);
  const requestedPath = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = path.resolve(ROOT, requestedPath);
  const relative = path.relative(ROOT, filePath);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    sendText(res, 403, "Forbidden", "text/plain; charset=utf-8");
    return;
  }

  try {
    const body = await readFile(filePath);
    const contentType = MIME_TYPES[path.extname(filePath)] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-cache"
    });
    res.end(body);
  } catch (error) {
    sendText(res, 404, "Not found", "text/plain; charset=utf-8");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);

    if (requestUrl.pathname === "/api/config") {
      await handleConfig(req, res);
      return;
    }

    if (requestUrl.pathname === "/api/weather") {
      await handleWeather(req, res);
      return;
    }

    if (requestUrl.pathname === "/api/reverse-geocode") {
      await handleReverseGeocode(req, res);
      return;
    }

    if (requestUrl.pathname === "/api/markets") {
      await handleMarkets(req, res);
      return;
    }

    if (requestUrl.pathname === "/api/news") {
      await handleNews(req, res);
      return;
    }

    await serveStatic(req, res);
  } catch (error) {
    sendJson(res, 500, {
      error: error.message || "Internal server error"
    });
  }
});

server.listen(PORT, () => {
  console.log(`Always-on dashboard: http://localhost:${PORT}`);
});

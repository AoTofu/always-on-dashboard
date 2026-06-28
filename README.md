# Always-On Dashboard

A modern, low-power ambient dashboard for a second screen, desk monitor, or always-on browser tab.

It combines an Apple-inspired clock and weather experience with live markets, Japanese news headlines, sunrise/sunset tracking, and battery-conscious refresh behavior. The UI is intentionally calm: a white canvas, compact data cards, colorful weather surfaces, and only the second hand in continuous motion.

## Highlights

- Analog + digital clock layout designed for always-on visibility
- Apple Weather-inspired current conditions and 7-day forecast
- Dynamic sunrise/sunset card with a solar arc
- Live market quotes for configurable symbols
- Japanese Google News RSS headlines
- GPS-aware weather with a config-based fallback location
- No frontend framework, no build step, no API keys required
- Low-power behavior: quiet refresh intervals and paused updates while hidden

## Preview

The dashboard is designed around a clean white background with focused information zones:

- Clock on the left
- Weather and forecast in the center
- Sunrise/sunset, markets, and status on the right
- News headlines along the bottom

## Quick Start

```powershell
npm start
```

Then open:

```text
http://localhost:4173
```

## Configuration

Edit `config.json` to change the default location, refresh intervals, market symbols, and news feed.

```json
{
  "location": {
    "label": "Tokyo",
    "latitude": 35.6762,
    "longitude": 139.6503,
    "timezone": "Asia/Tokyo"
  },
  "weather": {
    "refreshMinutes": 30
  },
  "markets": {
    "refreshMinutes": 5
  },
  "news": {
    "refreshMinutes": 20
  }
}
```

When browser geolocation is allowed, weather switches to the current location. If location access is denied or unavailable, the configured location is used.

## Data Sources

- Weather, sunrise, sunset, and 7-day forecast: Open-Meteo
- Market quote data: Yahoo Finance chart endpoint
- News headlines: Google News RSS
- Reverse geocoding: OpenStreetMap Nominatim

## Power-Friendly Design

This dashboard is built for long-running display use:

- The clock updates once per second
- The sun card recalculates once per minute
- Weather refreshes every 30 minutes by default
- Markets refresh every 5 minutes by default
- News refreshes every 20 minutes by default
- Hidden tabs pause background data refreshes

## Project Structure

```text
.
├── app.js        # Browser UI logic
├── config.json   # Location, market, news, and refresh settings
├── index.html    # Dashboard markup
├── server.js     # Local server and API proxy
├── styles.css    # Responsive visual system
└── package.json
```

## License

MIT

# Architecture

This document describes the technical architecture of VEX Match Jumper in depth — how data flows through the system, how each file is structured, and the design decisions behind each layer.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Routing and Entry Points](#2-routing-and-entry-points)
3. [Main Page: Viewer.jsx](#3-main-page-viewerjsx)
4. [Serverless API Layer](#4-serverless-api-layer)
5. [Services Layer](#5-services-layer)
6. [Utility Modules](#6-utility-modules)
7. [Components](#7-components)
8. [State Management and URL Persistence](#8-state-management-and-url-persistence)
9. [Short Link System](#9-short-link-system)
10. [Admin Panel](#10-admin-panel)
11. [Stream Detection Pipeline](#11-stream-detection-pipeline)
12. [Stream-to-Match Matching Algorithm](#12-stream-to-match-matching-algorithm)
13. [Local Development Infrastructure](#13-local-development-infrastructure)
14. [Build and Deployment](#14-build-and-deployment)
15. [Data Models](#15-data-models)

---

## 1. System Overview

```
Browser
  │
  ├── React SPA (Vite + Tailwind)
  │     ├── Viewer.jsx        ← main UI
  │     ├── Admin.jsx         ← route management
  │     └── RouteResolver.jsx ← short link redirects
  │
  └── HTTP
        ├── RobotEvents API v2         (external)
        ├── YouTube Data API v3        (external)
        └── Vercel Serverless Functions (same domain)
              ├── /api/detect-streams    → Vercel KV (Redis cache)
              ├── /api/get-all-routes    → Vercel Edge Config
              ├── /api/save-routes       → Vercel Edge Config + Google Ping
              └── /api/sitemap.xml       → Vercel Edge Config
```

The frontend is a fully client-side React SPA served as static files. All RobotEvents and YouTube API calls are made directly from the browser using keys stored in environment variables or user-supplied localStorage overrides. The serverless functions handle only the operations that cannot be done client-side: web scraping (CORS), persistent storage (routes and cache), and sitemap generation.

---

## 2. Routing and Entry Points

### `src/main.jsx`

The React entry point. Wraps the app in `React.StrictMode` and `NuqsAdapter`. The `NuqsAdapter` is required by the `nuqs` library to synchronize React state with URL search parameters.

### `src/App.jsx`

Defines three routes using React Router:

| Path | Component | Purpose |
|------|-----------|---------|
| `/` | `Viewer` | Main application |
| `/admin` | `Admin` | Route management panel |
| `/:shortCode` | `RouteResolver` | Short link redirect handler |

The catch-all `/:shortCode` must come last to avoid shadowing `/admin`. Any unknown path will be intercepted by `RouteResolver`, which resolves it against the Edge Config route table.

### `vercel.json`

Configures Vercel rewrites so that:
- `/api/*` routes are handled by serverless functions.
- `/sitemap.xml` is served by `api/sitemap.xml.js` (Edge function).
- All other paths fall through to `/index.html`, enabling client-side routing for the SPA.

```json
{ "source": "/(.*)", "destination": "/index.html" }
```

Without this catch-all, direct navigation to `/admin` or `/:shortCode` would 404 on the CDN.

---

## 3. Main Page: Viewer.jsx

`Viewer.jsx` is the largest file in the project (~1,200 lines). It owns the full application state for loading an event and playing matches.

### State Categories

**URL state (nuqs `useQueryState`):**
- `sku` — the RobotEvents event SKU
- `team` — team number for filtering
- `match` — selected match ID
- `vid1`/`vid2`/`vid3` — YouTube video IDs (one per stream slot)
- `live1`/`live2`/`live3` — stream start times as epoch ms strings
- `vid`/`live` — single-stream fallbacks for older links
- `preset` — short link name; triggers preset loading on mount

**Event data:**
- `event` — full RobotEvents event object
- `team` — team object (if team filter is active)
- `matches` — flat sorted array of all matches across all divisions
- `teams`, `rankings`, `skills` — for the team roster panel

**Stream state:**
- `streams` — array of stream objects (see [Data Models](#15-data-models))
- `activeStreamId` — which stream slot is currently shown in the player
- `players` — map of `{ [streamId]: YouTubePlayerInstance }` (refs to each IFrame API player)

**UI state:**
- `activeTab` — `'search'` | `'list'` | `'matches'`
- `matchesTabState` — `{ filter: 'all'|'qual'|'elim', search: '' }`
- `showEventHistory`, `isSettingsOpen`, `showStreamSuccess`
- `isDeepLinking` / `hasDeepLinked` / `isInternalLoading` — flags to prevent infinite loops during URL-driven loading

### Lifecycle: Event Loading

The main loading path (`handleLoadEvent`) runs when the user submits a SKU:

1. Extract SKU from the input (strips full RobotEvents URLs to just the SKU code).
2. Call `getEventBySku(sku)` from `robotevents.js`.
3. Call `getMatchesForEvent(event)` — paginates through all divisions.
4. Call `detectOrFallbackStreams(event, divisions)` — see [Stream Detection Pipeline](#11-stream-detection-pipeline).
5. Optionally call `getTeamsForEvent`, `getRankingsForEvent`, `getSkillsForEvent`.
6. Update all state and encode the SKU into the URL via `setUrlSku(sku)`.
7. Call `saveEventToHistory(event, streams)` to persist to localStorage.

### Deep Link Initialization

On first mount, if `sku` or `preset` is in the URL, `isDeepLinking` is set to `true`. A `useEffect` watching `[urlSku, urlPreset, isDeepLinking]` fires and calls `handleLoadEvent` automatically, then replays stream state from URL params. The `hasDeepLinked` ref prevents this from re-running on subsequent re-renders.

### `detectOrFallbackStreams(event, divisions)`

A module-level async function (defined above the component) that:
1. Calls `GET /api/detect-streams?sku=...&eventStart=...&eventEnd=...&divisions=...`
2. If the API returns streams, uses them.
3. If the API fails or returns nothing, generates blank placeholder stream slots — one per division per event day. These slots show empty URL inputs for the user to fill manually.

The fallback preserves the expected UI structure even when auto-detection fails.

### Match Seeking

`handleMatchClick(match)`:
1. Calls `findStreamForMatch(match, streams, event.start)` from `streamMatching.js` to determine which stream this match belongs to.
2. Sets `activeStreamId` to that stream's ID.
3. Waits for the corresponding player ref in `players` to be available.
4. Calculates `seekTime = (match.started_ms - stream.streamStartTime_ms) / 1000`.
5. Calls `player.seekTo(seekTime)` and `player.playVideo()`.

### YouTube Player Management

Each stream slot renders a `<YouTube>` component (from `react-youtube`). When the player fires `onReady`, its instance is stored in the `players` state map keyed by `streamId`. This allows the Viewer to programmatically control whichever player is active.

Stream start times are loaded via `getStreamStartTime(videoId)` from `youtube.js` whenever a `videoId` is set. This fires the YouTube Data API `videos?part=liveStreamingDetails` endpoint and extracts `actualStartTime`. The result is stored back on the stream object as `streamStartTime` (epoch ms).

---

## 4. Serverless API Layer

All functions live in the `api/` directory and are deployed as Vercel Serverless Functions.

### `api/detect-streams.js` (Node.js runtime)

The most complex backend function. Orchestrates stream detection for a given event SKU.

**Request:** `GET /api/detect-streams?sku=RE-VRC-24-1234&eventStart=...&eventEnd=...&divisions=[...]`

**Pipeline:**

1. **Cache check** — Look up `stream_cache:{sku}` in Vercel KV. Return cached data if found (TTL: 1 hour). Skip with `?nocache=1`.

2. **Scrape RobotEvents** — Fetch `https://www.robotevents.com/robot-competitions/vex-robotics-competition/{sku}.html` using three parallel strategies that race each other:
   - Googlebot user-agent (most permissive crawl access)
   - Standard Chrome user-agent with 8s timeout
   - CORS proxy via `corsproxy.io` with 15s timeout (100ms delayed start to deprioritize it)

   `Promise.any()` returns whichever succeeds first. The HTML is validated to reject Cloudflare challenge pages.

3. **Parse HTML** — `cheerio` loads the HTML. Two extraction strategies run:
   - Regex over the full body text for YouTube URL patterns (`youtu.be`, `youtube.com/watch`, `youtube.com/@`, etc.)
   - CSS selectors targeting `#webcast a`, `.tab-content a`, and `a[href*="youtube.com"]`

   Each link gets a `divisionHint` extracted from surrounding anchor text, parent element text, or `grandparentText` (e.g. "Division A", "HS", "MS").

4. **Classify links** — Separate into `directVideos` (video IDs) and `channelLinks` (channel URLs).

5. **YouTube channel search** — For each channel link, if a YouTube API key is available:
   - Resolve `@username` handles to channel IDs via `search?type=channel`.
   - Run three parallel searches (`completed`, `live`, `upcoming`) filtered to the event date window (±1 day).
   - Deduplicate by `videoId`.
   - Extract division hints from video titles.

6. **Normalize** — `normalizeStreams()` maps discovered videos to stream objects keyed by `divisionId` and `dayIndex`. Division hints are fuzzy-matched against the actual division names from RobotEvents.

7. **Cache result** — Store in Vercel KV with 1-hour TTL.

8. **Return** — `{ streams: [...], cached: bool }`

**Exports:** Named `config` (runtime, maxDuration) + default handler.

---

### `api/get-all-routes.js` (Edge runtime)

Reads the `routes` key from Vercel Edge Config.

**Request:** `GET /api/get-all-routes`
**Response:** `[{ path, label, sku, streams, multiStreams }, ...]`

Uses Edge runtime for sub-millisecond latency since this is called on every short-link resolution.

`Cache-Control: no-store` ensures the admin panel always sees fresh data.

---

### `api/save-routes.js` (Node.js runtime)

Writes the route table back to Edge Config via the Vercel REST API.

**Request:** `POST /api/save-routes` with JSON body (array of route objects)

**Steps:**
1. Validate that `EDGE_CONFIG_ID` and `VERCEL_API_TOKEN` env vars exist.
2. Call `PATCH /v1/edge-config/{id}/items` with an `update` operation for the `routes` key.
3. Await a `fetch('https://www.google.com/ping?sitemap=...')` call to notify Google of updated sitemap content. This is awaited (not fire-and-forget) because Vercel freezes function execution once the response is sent.

---

### `api/sitemap.xml.js` (Edge runtime)

Generates a dynamic XML sitemap from the routes stored in Edge Config.

**Request:** `GET /sitemap.xml` (rewritten from Vercel config)

Reads `routes` from Edge Config and generates standard `<urlset>` XML. The top 3 routes (by reverse insertion order — newest first) get `priority=0.9` and `changefreq=weekly`; older routes get `priority=0.6` and `changefreq=monthly`. XML special characters are escaped.

Returns with `Cache-Control: public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400` for CDN caching.

Falls back to a minimal valid sitemap on error rather than returning invalid XML.

---

## 5. Services Layer

### `src/services/robotevents.js`

Thin wrapper around the RobotEvents API v2. All functions create an axios instance via `getClient()`, which reads a user-supplied API key from `localStorage('robotevents_api_key')` and falls back to `VITE_DEFAULT_ROBOTEVENTS_API_KEY`.

| Export | Endpoint | Notes |
|--------|----------|-------|
| `getEventBySku(sku)` | `GET /events?sku=...` | Returns first matching event |
| `getTeamByNumber(number)` | `GET /teams?number=...` | Exact match with fallback to first result |
| `getMatchesForEvent(event)` | `GET /events/{id}/divisions/{divId}/matches` | Paginates (250/page) across all divisions; sorts by `started` then `scheduled` then alpha |
| `getMatchesForEventAndTeam(eventId, teamId)` | Divisions endpoint with team fallback | Falls back to `GET /teams/{id}/matches?event[]=` if divisions endpoint 404s |
| `getTeamsForEvent(eventId)` | `GET /events/{id}/teams` | Paginates all teams |
| `getRankingsForEvent(eventId, divisions)` | `GET /events/{id}/divisions/{divId}/rankings` | Suppresses 404s (rankings not published yet) |
| `getSkillsForEvent(eventId)` | `GET /events/{id}/skills` | Paginates all skills |
| `getEventsForTeam(teamId, seasonIds)` | `GET /events?team[]=...&season[]=...` | Used for global team search |
| `getActiveSeasons()` | `GET /seasons?active=true` | Used to populate season filter |

Match sorting logic: `started` → `scheduled` → `Infinity` (unplayed), with alphanumeric fallback for ties.

---

### `src/services/youtube.js`

Handles YouTube video metadata. Reads user key from `localStorage('youtube_api_key')` with env var fallback.

**`extractVideoId(url)`** — Regex extraction supporting `youtube.com/watch?v=`, `youtu.be/`, `youtube.com/live/`, `youtube.com/embed/`.

**`getStreamStartTime(videoId)`** — Calls `GET /youtube/v3/videos?part=liveStreamingDetails&id={videoId}`. Returns `{ startTime, status, scheduledTime }` where `status` is `'started'` or `'scheduled'`. Returns `null` if the API key is missing or the video has no streaming details.

---

### `src/services/youtubeAdvanced.js`

Higher-level YouTube operations for channel and playlist discovery.

**`extractChannelId(url)`** — Handles `/channel/ID`, `/@username`, `/c/name`, `/user/name` formats.

**`extractPlaylistId(url)`** — Extracts `list=` query parameter.

**`getChannelLivestreams(channelUrl)`** — Resolves username to channel ID if needed, then searches for `live` and `upcoming` broadcasts.

**`getPlaylistVideos(playlistUrl, eventStartDate)`** — Fetches up to 50 playlist items; optionally filters to videos published within ±1 day of the event start date (with +3 day window for multi-day events).

**`validateVideoUrl(videoUrl)`** — Checks if a video ID is valid and whether it has `liveStreamingDetails`.

These functions are used by `WebcastSelector` and potentially by auto-detection fallback paths.

---

### `src/services/webcastDetection.js`

Classifies URLs scraped from event descriptions and finds webcast candidates.

**`extractUrlsFromText(text)`** — Regex URL extraction with deduplication.

**`classifyUrl(url)`** — Returns `{ type, platform, url }` where `type` is one of `'direct-video'`, `'channel'`, `'playlist'`, `'other'` and `platform` is `'youtube'`, `'twitch'`, `'other'`, or `'unknown'`.

**`findWebcastCandidates(event)`** — Runs a priority-ranked scan:
1. `event.webcast` field (priority 1)
2. URLs in a "webcast:" section of the description (priority 2)
3. All other URLs in the description, excluding `robotevents.com` and `vexrobotics.com` domains (priority 3)

Returns candidates sorted by priority with duplicates removed.

**`isProbablyLivestream(url)`** — Returns `true` if the classified type is `direct-video` or `channel`.

---

### `src/services/eventCache.js`

localStorage-backed persistence layer. Uses two separate storage keys:

- `vex_match_jumper_event_cache` — per-event webcast selection history (keyed by event ID)
- `vex_match_jumper_history` — flat list of recently accessed events (capped at 20)

| Export | Description |
|--------|-------------|
| `getCachedWebcast(eventId)` | Read cached stream for an event |
| `setCachedWebcast(eventId, videoId, url, method)` | Write + append to per-event history |
| `saveEventToHistory(event, streams)` | Upsert event into the 20-entry history list |
| `getAllHistory()` | Return full history array |
| `deleteHistoryEntry(eventId)` | Remove one entry from history |
| `clearAllHistory()` | Wipe history |
| `exportCache()` | Stringify the full cache as JSON |
| `importCache(jsonString)` | Restore cache from JSON string |

History entries store: `eventId`, `eventName`, `eventStart/End`, `eventSku`, `eventProgram`, `eventSeason`, `eventDivisions`, `streams[]` (label, url, videoId, dayIndex, streamStartTime), `lastAccessed`, `firstAccessed`.

---

## 6. Utility Modules

### `src/utils/streamMatching.js`

The core matching logic used at runtime for assigning matches to streams.

**`calculateEventDays(startDate, endDate)`** — Returns the number of calendar days an event spans. Uses `parseCalendarDate` to avoid timezone issues, then `Math.ceil(diff / 86400000) + 1`.

**`getMatchDayIndex(matchDate, eventStartDate)`** — Returns a 0-based day index. Parses both dates at local midnight to avoid timezone shifts (a match at 11 PM UTC that is actually 6 PM local must not cross a day boundary).

**`inferMatchDayFromContext(match, allMatches, eventStartDate)`** — For matches without any timestamp (often elimination matches that haven't been played yet), infers the day by finding the last qualification match with a timestamp in the same division. Falls back to `Day 0`.

**`findStreamForMatch(match, streams, eventStartDate)`** — Given a match and the streams array, finds the best stream:
1. Filter to streams with a valid `streamStartTime`.
2. Filter by `divisionId` if the match has one.
3. Filter to same `dayIndex` if possible.
4. From candidates, select streams that started before the match (`streamStartTime <= matchTimeMs`).
5. Of those, return the one whose start time is closest to the match start (most recent stream that covers the match).
6. If no stream started before the match, return the earliest available stream anyway (allows jumping even if stream detection was slightly off).

**`getGrayOutReason(match, streams, eventStartDate)`** — Returns a human-readable explanation of why a match cannot be jumped to (no streams, no stream for that day, stream not loaded, stream started after the match), or `null` if the match is jumpable.

---

### `src/utils/multiStream.js`

An older utility module, largely superseded by `streamMatching.js`. Contains overlapping implementations of `calculateEventDays`, `getMatchDayIndex`, and match enhancement. Still used by some components for `enhanceMatches()` and `groupMatchesByDay()`.

**`enhanceMatches(matches, streams, streamStartTimes, eventStartDate)`** — Adds `dayIndex`, `assignedStreamIndex`, `grayedOut`, and `grayReason` fields to each match by iterating `streamStartTimes` entries and finding the closest stream that started before each match.

**`groupMatchesByDay(matches, dayLabels)`** — Groups a flat match array into `{ [dayIndex]: { label, matches[] } }`.

---

### `src/utils/dateUtils.js`

Three timezone-safe date helpers.

**`parseCalendarDate(dateString)`** — Extracts `YYYY-MM-DD` from an ISO string and constructs a `Date` at local midnight using `new Date(year, month-1, day)`. This avoids the UTC midnight parse that `new Date("2024-11-21")` would produce, which shifts the date backward in negative-offset timezones.

**`getCalendarDateString(date)`** — Formats a `Date` as `YYYY-MM-DD` using local time components.

**`formatEventDate(dateString, formatStr)`** — Combines `parseCalendarDate` + `date-fns format`. Defaults to `'MMM d'`.

---

## 7. Components

### `src/components/StreamManager.jsx`

The primary interactive stream control surface. Renders per-stream URL input fields and the playback seek controls.

**Props:** `event`, `streams`, `onStreamsChange`, `onWebcastSelect`, `onSeek`, `onJumpToSyncedStart`, `canControl`, `multiDivisionMode`, `onActiveDivisionIdChange`

**Key behaviors:**
- Renders one input group per stream in the `streams` array.
- When a video URL is entered, calls `extractVideoId` and then `getStreamStartTime` to populate `stream.streamStartTime`. Tracks fetched video IDs in a `useRef(Set)` to prevent duplicate API calls.
- **Date mismatch detection** — `validateStreamDate()` compares the stream's actual `streamStartTime` calendar date against its assigned `dayIndex`. If they don't match, it shows a warning banner offering to swap or reassign the stream. This catches the common error of assigning Day 2's recording to Day 1's slot.
- Seek buttons call `onSeek(seconds)` with values `[-300, -30, -5, +5, +30, +300]`.
- Feedback toast (`triggerFeedback`) shows seek delta for 1 second.

### `src/components/EventHistory.jsx`

Renders the recently viewed events panel from `getAllHistory()`. Each entry shows event name, date, program, and the configured stream labels. Clicking an entry emits the event back to the Viewer for reload. Supports individual deletion and full clear.

### `src/components/WebcastSelector.jsx`

Shown after event loading when multiple webcast candidates are found but none auto-confirmed. Lists classified candidates with type badges (direct video / channel / playlist). The user picks one to assign to a stream slot.

### `src/components/TeamList.jsx`

Three-tab panel (Teams / Rankings / Skills) rendered when the full event roster is loaded. Teams tab shows number and name; Rankings tab adds rank, WP, AP, SP; Skills tab shows programming and driving scores. Supports search filtering.

### `src/components/SettingsModal.jsx`

Overlay modal for entering custom API keys. Saves to `localStorage('robotevents_api_key')` and `localStorage('youtube_api_key')`. Shows which keys are currently active (custom vs. default).

### `src/components/WordPressHeader.jsx`

Site navigation bar rendered at the top of the Viewer. Reads link structure from `src/data/headerData.js`. Supports flat links and dropdown menus. Includes a mobile hamburger menu and a "Download iOS App" CTA banner. The component is named "WordPress" for historical reasons — the navigation mirrors the RoboSTEM WordPress site header structure; the data is statically embedded rather than fetched from WordPress.

### `src/components/EventInput.jsx`

A styled text input and submit button for entering the RobotEvents event URL or SKU.

### `src/components/StreamInput.jsx`

A single YouTube URL input that extracts the video ID and emits it upward.

### `src/components/TeamInput.jsx`

A styled text input for team number entry with a search button.

### `src/components/MatchPlayer.jsx`

A legacy single-stream player component. Supports manual sync mode, seek adjustment buttons, and basic match list rendering. Largely replaced by the multi-stream architecture in `Viewer.jsx` but still present in the codebase.

---

## 8. State Management and URL Persistence

All shareable state lives in URL search parameters managed by `nuqs` (`useQueryState` hooks). nuqs uses React context (provided by `NuqsAdapter` in `main.jsx`) to batch URL updates and prevent extra re-renders.

**Why nuqs over `useState` + manual `URLSearchParams`?**
- Atomic updates: multiple params change in one `history.pushState` call.
- Type coercion: strings, numbers, booleans with null serialization.
- SSR-safe (relevant if the app were ever server-rendered).

**Non-shareable state** (form inputs, UI toggles, loading flags) uses standard `useState`.

**Persistent state** (event history, webcast cache) uses `localStorage` via `eventCache.js`.

**Deep linking guard pattern:**
```js
const isDeepLinking = useState(() => !!params.get('sku') || !!params.get('preset'))
const hasDeepLinked = useRef(false)
```

`isDeepLinking` initializes synchronously from `window.location.search` to avoid a flash of the empty input form. `hasDeepLinked` prevents the load from re-triggering if the URL changes after the initial load.

---

## 9. Short Link System

Short links map a friendly path like `/worlds` to a full event configuration.

**Storage:** Vercel Edge Config, under a single `routes` key containing an array:
```json
[
  {
    "path": "worlds",
    "label": "VRC Worlds 2025",
    "sku": "RE-VRC-25-5000",
    "streams": ["https://youtube.com/watch?v=abc123"],
    "multiStreams": {
      "divisionId": { "0": "vid1", "1": "vid2" }
    }
  }
]
```

**Resolution flow:**
1. User visits `jumper.robostem.org/worlds`.
2. Vercel rewrites to `/index.html` (SPA catch-all).
3. React Router matches `/:shortCode` → `RouteResolver`.
4. `RouteResolver` fetches `GET /api/get-all-routes`.
5. Finds entry with `path === 'worlds'`.
6. Calls `navigate('/?preset=worlds', { replace: true })`.
7. `Viewer.jsx` detects `preset` URL param on mount and calls `handleLoadEvent` with the preset config.

**Why Edge Config over a database?**
Edge Config is globally replicated and has sub-millisecond read latency on Vercel's edge network. Since routes are read on every short-link resolution, this avoids the cold start and latency of a database round-trip.

**Sitemap integration:** `/api/sitemap.xml.js` reads the same route table and generates canonical `/?preset=<path>` URLs. After saving routes, `api/save-routes.js` pings `https://www.google.com/ping?sitemap=https://jumper.robostem.org/sitemap.xml` to trigger reindexing.

---

## 10. Admin Panel

`src/pages/Admin.jsx` provides a UI for managing short link routes.

**Authentication:** Session-based, using `sessionStorage('adminAuth')`. Credentials are hardcoded in the component. This is adequate for an internal tool but not suitable for public-facing admin access.

**Features:**
- View all current routes loaded from `GET /api/get-all-routes`
- Add a new route by entering a SKU, which auto-fetches event metadata from RobotEvents
- Assign YouTube stream URLs per division per day (with auto-detect support calling the same `/api/detect-streams` endpoint)
- Edit or delete existing routes
- Copy the shareable short URL to clipboard
- Header version history panel (loads locally stored header snapshots for comparison)

**Save flow:** `POST /api/save-routes` with the full updated routes array, which triggers an Edge Config write + Google sitemap ping.

**Local dev fallback:** In dev mode (`vite-plugin-save-routes.js`), `POST /api/save-routes` writes to `src/data/routes.json` instead of Edge Config.

---

## 11. Stream Detection Pipeline

Stream detection is the most involved server-side workflow.

```
Client calls /api/detect-streams?sku=...
          │
          ▼
    KV Cache Hit? ──YES──► Return cached streams
          │
         NO
          │
          ▼
    Scrape RobotEvents page (3 strategies in parallel)
          │
          ▼
    Parse HTML with cheerio
    ├── Regex extraction (YouTube URL patterns in body)
    └── CSS selector extraction (#webcast, .tab-content, a[href*=youtube])
          │
          ▼
    Classify links:
    ├── Direct video IDs
    └── Channel URLs
          │
          ▼
    YouTube API channel search (if channels found + API key present)
    ├── Resolve @username → channelId via search API
    └── Search completed / live / upcoming videos within event date window
          │
          ▼
    normalizeStreams()
    ├── Group by divisionHint
    ├── Fuzzy-match hints to actual division IDs
    └── Assign dayIndex based on video position within event window
          │
          ▼
    Store in KV (TTL: 1 hour)
          │
          ▼
    Return { streams, cached: false }
```

**Division inference:** Division hints are extracted from anchor text and parent/grandparent element text. The hint (e.g. `"A"`, `"HS"`) is fuzzy-matched against division names returned by RobotEvents (e.g. `"Division A"`, `"High School"`). Unmatched videos fall back to the first division.

**Why three parallel fetch strategies for RobotEvents?**
RobotEvents occasionally rate-limits or Cloudflare-challenges automated requests. Running Googlebot UA, standard Chrome UA, and a CORS proxy in a `Promise.any()` race means whichever succeeds first is used, giving maximum resilience with minimal latency penalty.

---

## 12. Stream-to-Match Matching Algorithm

The matching algorithm (`findStreamForMatch`) maps each match to exactly one stream.

```
Input: match, streams[], eventStartDate

1. Get matchTimeMs = new Date(match.started || match.scheduled).getTime()
2. Filter streams to those with a streamStartTime
3. If match has a divisionId:
   a. Try streams with matching divisionId OR no divisionId
   b. Use this subset if non-empty
4. Try to further restrict to streams on the same dayIndex as the match
5. From candidates, filter to streams where streamStartTime <= matchTimeMs
6. If no stream started before the match:
   - Return the earliest stream anyway (handles late-start recordings)
7. Otherwise return the stream with the largest streamStartTime ≤ matchTimeMs
   (the stream that started most recently before the match)
```

**Why "most recent stream that started before the match"?**
At a multi-day event, Day 2 starts a new stream. A match on Day 2 afternoon should seek into the Day 2 stream, not the Day 1 stream which also has a start time before Day 2 matches. The algorithm naturally handles this because the Day 2 stream start time is much closer to the match time.

**Why fallback to earliest stream if none started before the match?**
Streams sometimes start 30-60 seconds before RobotEvents records the first match. Without this fallback, the very first match of the day would always appear grayed out.

**Gray-out logic (`getGrayOutReason`):**
A match is grayed out in the UI (non-clickable) when:
- No streams are configured at all
- No stream exists for the match's day
- A stream URL is entered but `streamStartTime` hasn't been loaded yet
- The stream started after the match (match was played before recording began)

The gray-out reason string explains exactly which condition applies, shown as a tooltip.

---

## 13. Local Development Infrastructure

### `vite-plugin-save-routes.js`

A custom Vite plugin that adds two API middleware endpoints to the Vite dev server:

- `GET /api/get-all-routes` — reads `src/data/routes.json`
- `POST /api/save-routes` — writes back to `src/data/routes.json`

This mirrors the production Edge Config API surface so that `Admin.jsx` and `RouteResolver.jsx` work identically in local dev. The plugin is registered in `vite.config.js` alongside the standard React plugin.

### `src/data/routes.json`

A local JSON file that acts as the dev-mode equivalent of Vercel Edge Config. Contains the same schema as the production routes array. Committed to the repo so local dev starts with real route data.

### Environment Variable Strategy

`VITE_*` prefixed variables are inlined into the client bundle by Vite at build time. Non-prefixed variables (e.g. `YOUTUBE_API_KEY`, `EDGE_CONFIG_ID`, `VERCEL_API_TOKEN`) are server-side only and never exposed to the browser. Users can override the client-side keys at runtime via the Settings modal (localStorage).

---

## 14. Build and Deployment

**Build:** `vite build` produces a static bundle in `dist/`. Assets are content-hashed.

**Deployment:** Vercel detects the `vite build` output directory and:
1. Serves `dist/` as a global CDN.
2. Deploys `api/*.js` files as serverless functions (Node.js 18 or Edge, per the `config.runtime` export in each file).
3. Applies `vercel.json` rewrites.

**CI/CD:** Vercel auto-deploys on push to `main`.

**Analytics:** `@vercel/analytics/react` injects a `<Analytics />` component in `Viewer.jsx` which automatically tracks page views without additional configuration.

---

## 15. Data Models

### Stream Object

```ts
{
  id: string               // e.g. "stream-div-1-day-0"
  url: string              // YouTube URL entered by user or auto-detected
  videoId: string | null   // Extracted 11-char YouTube video ID
  streamStartTime: number | null  // Epoch milliseconds (from YouTube API actualStartTime)
  divisionId: number       // RobotEvents division ID
  dayIndex: number         // 0-based day within the event
  label: string            // Display label, e.g. "Day 1 - Nov 21"
  date: string             // ISO date string for the stream day
  source?: 'detected' | 'user'  // How the stream was discovered
  originalTitle?: string   // YouTube video title (auto-detected only)
}
```

### Route Object (Edge Config / routes.json)

```ts
{
  path: string             // Short path segment, e.g. "worlds"
  label: string            // Human-readable name, e.g. "VRC Worlds 2025"
  sku: string              // RobotEvents SKU
  streams: string[]        // YouTube URLs (legacy flat array)
  multiStreams: {           // Per-division-per-day stream map (newer format)
    [divisionId: string]: {
      [dayIndex: string]: string  // YouTube URL
    }
  } | null
}
```

### Event History Entry (localStorage)

```ts
{
  eventId: number
  eventName: string
  eventStart: string       // ISO date
  eventEnd: string         // ISO date
  eventSku: string
  eventProgram: object     // RobotEvents program object
  eventSeason: object      // RobotEvents season object
  eventDivisions: object[] // RobotEvents division objects
  streams: {
    label: string
    url: string
    videoId: string | null
    dayIndex: number
    streamStartTime: number | null
  }[]
  lastAccessed: string     // ISO timestamp
  firstAccessed: string    // ISO timestamp
}
```

### Match Object (from RobotEvents API v2)

```ts
{
  id: number
  name: string             // e.g. "Q1", "SF1-1", "F1-1"
  started: string | null   // ISO timestamp when match actually started
  scheduled: string | null // ISO timestamp when match was scheduled
  division: { id: number, name: string }
  alliances: [
    {
      color: 'red' | 'blue'
      score: number
      teams: [
        { team: { id: number, name: string, number: string }, sitting: bool }
      ]
    }
  ]
  // Fields added by enhanceMatches():
  dayIndex?: number
  grayedOut?: boolean
  grayReason?: string | null
  assignedStreamIndex?: number
}
```

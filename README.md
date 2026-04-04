# VEX Match Jumper

![Vercel Analytics Enabled](https://img.shields.io/badge/Vercel%20Analytics-enabled-brightgreen)
![License](https://img.shields.io/badge/license-Apache%202.0-blue)
![Deployed at](https://img.shields.io/badge/deployed-jumper.robostem.org-informational)

> A web app by RoboSTEM Foundation for watching VEX competition livestreams without scrubbing through hours of footage.

VEX Match Jumper lets you load any VEX Robotics Competition event from RobotEvents and jump directly to individual matches inside the official YouTube livestream. It is designed for post-event match review, team scouting, and finding specific games after competition day.

---

## Features

- **Load by URL or SKU** — Paste a RobotEvents event URL or type a SKU directly (e.g. `RE-VRC-24-1234`)
- **Direct match seeking** — Click any match in the list to instantly seek the YouTube player to that moment
- **Multi-day support** — Events spanning multiple days automatically get a stream slot per day
- **Multi-division support** — Events with multiple divisions (e.g. High School / Middle School) track separate streams per division
- **Auto stream detection** — The server scrapes the RobotEvents event page and queries YouTube to find the correct livestream automatically
- **Manual sync tools** — Fine-tune the stream-to-match alignment with ±5s, ±30s, ±5m offset buttons and a manual sync mode
- **Team filtering** — Filter the match list to show only matches played by a specific team number
- **Team search without an event** — Look up a team by number to see their full event schedule across the current season
- **Full event roster** — View all teams registered for the event with rankings and skills scores
- **Event history** — Previously loaded events are stored locally and can be reloaded in one click
- **Shareable deep links** — URLs encode the selected event, team, stream(s), and match so a session can be shared or bookmarked
- **Short links** — Admin-created preset paths (e.g. `jumper.robostem.org/worlds`) expand to full event configurations
- **RobotEvents integration** — Pulls live match schedules, team lists, rankings, and skills results from the RobotEvents API v2

---

## How It Works

### Event Loading

1. The user enters a RobotEvents event URL or SKU.
2. The app calls the RobotEvents API v2 to fetch event metadata (name, dates, divisions, teams).
3. All matches across every division are fetched and sorted by start time.
4. Stream detection runs against `/api/detect-streams`, which scrapes the RobotEvents event page and searches YouTube for matching channel uploads.
5. Detected streams are assigned to division/day slots. If detection fails, blank stream slots are generated as placeholders.

### Match Seeking

When a match is clicked:

```
seekTime (seconds) = (matchStartTime_ms - streamStartTime_ms) / 1000
```

`streamStartTime` comes from the YouTube Data API `liveStreamingDetails.actualStartTime` field on the video. The player then calls `seekTo(seekTimeSec)` via the `react-youtube` IFrame API.

### Stream-to-Match Assignment

Each match is assigned to a stream by comparing the match's `started` timestamp against the `streamStartTime` of available streams. The stream whose start time is closest to (but before) the match is selected. This handles events where a stream starts mid-day or where multiple streams exist.

### Manual Sync

If auto-detection produces an incorrect offset, the user can enter Manual Sync Mode: play the stream to the start of any known match, click that match in the list, and the app back-calculates the stream start time. Fine adjustments are available via seek buttons.

---

## URL Deep Linking

All state is encoded in the URL using [nuqs](https://nuqs.47ng.com/), making sessions fully shareable:

| Parameter | Description |
|-----------|-------------|
| `sku` | RobotEvents event SKU |
| `team` | Team number filter |
| `match` | Selected match ID |
| `vid1`, `vid2`, `vid3` | YouTube video IDs for multi-day streams |
| `live1`, `live2`, `live3` | Stream start times (epoch ms) for multi-day |
| `vid` / `live` | Single-day fallback equivalents |
| `preset` | Short link name; loads a saved route from Edge Config |

Short paths like `/:shortCode` resolve through `RouteResolver.jsx` which fetches the route table from `/api/get-all-routes` and redirects to `/?preset=<code>`.

---

## Tech Stack

### Frontend

| Technology | Purpose |
|-----------|---------|
| [React 18](https://react.dev/) | UI framework |
| [Vite 4](https://vitejs.dev/) | Build tool and dev server |
| [Tailwind CSS 3](https://tailwindcss.com/) | Styling |
| [React Router 7](https://reactrouter.com/) | Client-side routing |
| [nuqs 2](https://nuqs.47ng.com/) | URL search param state management |
| [react-youtube](https://www.npmjs.com/package/react-youtube) | YouTube IFrame API wrapper |
| [date-fns](https://date-fns.org/) | Date formatting and arithmetic |
| [lucide-react](https://lucide.dev/) | Icons |
| [clsx](https://github.com/lukeed/clsx) + [tailwind-merge](https://github.com/dcastil/tailwind-merge) | Conditional class utilities |
| [axios](https://axios-http.com/) | HTTP client for API calls |
| [Vercel Analytics](https://vercel.com/docs/analytics) | Page view tracking |

### Backend (Vercel Serverless Functions)

| Function | Runtime | Purpose |
|----------|---------|---------|
| `api/detect-streams.js` | Node.js | Scrapes RobotEvents and queries YouTube to detect livestream URLs; caches results in Vercel KV |
| `api/get-all-routes.js` | Edge | Reads the short link route table from Vercel Edge Config |
| `api/save-routes.js` | Node.js | Writes the short link route table to Vercel Edge Config (admin only) |
| `api/sitemap.xml.js` | Edge | Generates a dynamic XML sitemap from stored routes |

### Cloud Infrastructure

| Service | Usage |
|---------|-------|
| [Vercel](https://vercel.com/) | Hosting, serverless functions, CI/CD |
| [Vercel KV](https://vercel.com/docs/storage/vercel-kv) | Redis-backed cache for detected stream data (1-hour TTL) |
| [Vercel Edge Config](https://vercel.com/docs/storage/edge-config) | Low-latency store for the short link route table |

### External APIs

| API | Usage |
|-----|-------|
| [RobotEvents API v2](https://www.robotevents.com/api/v2/docs) | Event metadata, matches, teams, rankings, skills |
| [YouTube Data API v3](https://developers.google.com/youtube/v3) | Video `liveStreamingDetails`, channel search, playlist items |

---

## Local Development

### Prerequisites

- Node.js 18+
- A RobotEvents API key ([get one here](https://www.robotevents.com/api/v2/))
- A YouTube Data API v3 key ([Google Cloud Console](https://console.cloud.google.com/))
- Vercel CLI (`npm i -g vercel`) for running serverless functions locally

### Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/axcdeng/live-viewer.git
   cd live-viewer
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Configure environment variables**

   Create a `.env.local` file:

   ```env
   VITE_DEFAULT_ROBOTEVENTS_API_KEY=your_robotevents_key
   VITE_DEFAULT_YOUTUBE_API_KEY=your_youtube_key
   ```

   To run the serverless functions locally (stream detection, routes), use Vercel CLI:

   ```bash
   vercel dev
   ```

   This starts both the Vite frontend and the API functions. The app will be at `http://localhost:3000`.

4. **Frontend only (no API functions)**

   ```bash
   npm run dev
   ```

   The app will be at `http://localhost:5173`. Stream auto-detection will be unavailable, but all client-side features work. The Vite dev plugin (`vite-plugin-save-routes.js`) mocks the routes API from `src/data/routes.json`.

### Build

```bash
npm run build
```

Output goes to `dist/`.

---

## Project Structure

```
.
├── api/                        # Vercel serverless functions
│   ├── detect-streams.js       # Stream auto-detection + KV cache
│   ├── get-all-routes.js       # Read short link routes from Edge Config
│   ├── save-routes.js          # Write short link routes to Edge Config
│   └── sitemap.xml.js          # Dynamic XML sitemap generator
│
├── src/
│   ├── components/             # Shared UI components
│   │   ├── EventHistory.jsx    # Recently viewed events panel
│   │   ├── EventInput.jsx      # Event URL/SKU input field
│   │   ├── MatchPlayer.jsx     # Legacy single-stream player (reference)
│   │   ├── SettingsModal.jsx   # API key settings modal
│   │   ├── StreamInput.jsx     # Single stream URL input
│   │   ├── StreamManager.jsx   # Multi-stream control + seek buttons
│   │   ├── TeamInput.jsx       # Team number input field
│   │   ├── TeamList.jsx        # Team roster with rankings/skills tabs
│   │   ├── WebcastSelector.jsx # Webcast candidate picker
│   │   └── WordPressHeader.jsx # RoboSTEM site navigation header
│   │
│   ├── data/
│   │   ├── headerData.js       # Static navigation link config
│   │   └── routes.json         # Local dev short link data
│   │
│   ├── pages/
│   │   ├── Viewer.jsx          # Main application page
│   │   ├── Admin.jsx           # Route management admin panel
│   │   └── RouteResolver.jsx   # Short link redirect handler
│   │
│   ├── services/
│   │   ├── robotevents.js      # RobotEvents API v2 client
│   │   ├── youtube.js          # YouTube video details + stream start time
│   │   ├── youtubeAdvanced.js  # Channel/playlist queries
│   │   ├── webcastDetection.js # URL classifier and event webcast finder
│   │   └── eventCache.js       # localStorage cache for history and webcasts
│   │
│   ├── utils/
│   │   ├── streamMatching.js   # Core stream-to-match assignment logic
│   │   ├── multiStream.js      # Multi-stream helper utilities
│   │   └── dateUtils.js        # Timezone-safe calendar date parsing
│   │
│   ├── App.jsx                 # Root component and route definitions
│   ├── main.jsx                # React entry point with NuqsAdapter
│   └── index.css               # Tailwind base styles
│
├── public/                     # Static assets (favicon, logo, robots.txt)
├── vite.config.js              # Vite configuration
├── vite-plugin-save-routes.js  # Dev-only plugin to mock the routes API
├── tailwind.config.js          # Tailwind configuration
├── vercel.json                 # Vercel rewrite rules
└── package.json
```

---

## Admin Panel

The admin panel at `/admin` allows creating and managing short link presets that map a friendly path to a full event configuration (SKU + stream URLs per division/day). Routes are stored in Vercel Edge Config and served globally at low latency.

When a route is saved, the server pings Google's sitemap endpoint to prompt reindexing.

Access is session-based and intended for internal use by the RoboSTEM team.

---

## License

This project is licensed under the [Apache License 2.0](LICENSE).

---

> This project is maintained by [RoboSTEM Foundation](https://robostem.org). The Vercel account is personal due to free tier account requirements.

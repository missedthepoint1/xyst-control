# XYST CONTROL

Wired-IP camera control for Canon cinema bodies. See `CLAUDE.md` for architecture.

## Camera firmware versions (KEEP UPDATED — endpoints can change on firmware updates)

| Camera | Firmware | Verified date |
|---|---|---|
| Canon EOS C300 Mark III | _TBD at first test_ | |
| Canon EOS C80 | _TBD at first test_ | |
| Canon EOS R5 C | _TBD (Phase 4)_ | |

## Setup

```bash
pnpm install
pnpm test          # run all tests
pnpm dev           # launch the Electron app
```

Copy `config/cameras.example.json` to `config/cameras.json` and set your camera IP.

## Local API (Companion / Stream Deck)

The app exposes a REST + SSE API on `http://127.0.0.1:8088` (override with the
`XYST_API_PORT` env var). It wraps the same `CameraManager` as the internal IPC —
one command layer. No auth; loopback-only.

### Routes

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Health check |
| GET | `/api/cameras` | List all cameras |
| GET | `/api/cameras/:id` | Camera detail |
| GET | `/api/cameras/:id/status` | Flat status: `id, name, status, model, recording, controls{iso,gain,shutter,iris,wb,wbKelvin,nd}` |
| POST | `/api/cameras/:id/record/start` | Start recording (single camera) |
| POST | `/api/cameras/:id/record/stop` | Stop recording (single camera) |
| POST | `/api/record/start` | REC ALL |
| POST | `/api/record/stop` | STOP ALL |
| POST | `/api/cameras/:id/controls/:control` | Set control — body `{"value": <v>}` |
| GET | `/api/cameras/:id/presets` | List presets |
| POST | `/api/cameras/:id/presets` | Save preset — body `{"name": "..."}` |
| POST | `/api/cameras/:id/presets/:presetId/recall` | Recall preset (single camera) |
| POST | `/api/presets/:presetId/recall` | Recall preset globally by UUID |
| DELETE | `/api/cameras/:id/presets/:presetId` | Delete preset |
| GET | `/api/events` | SSE live state stream (events: `state`, `status`, `presets`) |

### Bitfocus Companion — Generic HTTP examples

```
POST http://127.0.0.1:8088/api/cameras/<id>/record/start
POST http://127.0.0.1:8088/api/record/start          # REC ALL
POST http://127.0.0.1:8088/api/cameras/<id>/controls/iso   body {"value":1600}
POST http://127.0.0.1:8088/api/presets/<presetId>/recall
GET  http://127.0.0.1:8088/api/events                 # SSE live state
```

Use the plain POST/GET routes from Companion. The SSE endpoint (`/api/events`) is
for live state — consumed by the app UI and web clients, not Companion buttons.

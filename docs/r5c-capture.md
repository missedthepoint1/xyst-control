# Capturing the Canon EOS R5 C Browser Remote endpoints (Phase 4)

The R5 C is controlled over Canon's **undocumented Browser Remote** HTTP interface — not
the XC Protocol. There's no spec, so we capture the actual HTTP requests the camera's own
web UI makes, then drop them into `packages/core/src/r5c/endpoints.ts`. The driver
(`R5CBrowserRemoteDriver`) already has all the transport + robustness; this is the only
fill-in.

## 1. Get the R5 C on the LAN

- Connect the R5 C via **USB-C → Ethernet** adapter to the same switch as the laptop.
- On the camera, enable **Browser Remote** (Menu → Network/Wi-Fi → Browser Remote / wired
  network). Note the **IP address** and any **username/password** it shows.
- In a browser on the laptop, open `http://<r5c-ip>/` and confirm the Browser Remote page
  loads and you can change settings / start recording from it.

> The Browser Remote session can be finicky with multiple clients. Keep only **one**
> browser tab open while capturing, and close it before pointing the app at the camera.

## 2. Capture a HAR

1. Open the Browser Remote page in **Chrome**.
2. Open **DevTools → Network**. Tick **Preserve log** and **Disable cache**.
3. Now exercise every function you want, slowly, one at a time (so they're easy to tell
   apart in the log):
   - Start record, then stop record
   - Change **ISO** a couple of steps
   - Change **shutter** and **iris/aperture**
   - Change **white balance** / Kelvin
   - Change **ND** (if shown)
   - Tap to focus (if the UI supports it) — Phase 6
   - Just let it sit for a few seconds (to catch the **status/polling** request)
4. Right-click anywhere in the Network list → **Save all as HAR with content** → save as
   e.g. `r5c.har`.

## 3. Analyze

```bash
node scripts/r5c-capture-analyze.mjs r5c.har --host <r5c-ip>
```

It prints the unique requests grouped by guessed purpose (record/iso/shutter/…/status/
liveView) with method, path, query, request body, and a snippet of each response — plus a
**draft** to paste into `endpoints.ts`. Sanity-check the guesses against what you did in
step 3 (the tool labels by keyword and can mislabel).

## 4. Fill in the driver

Edit `packages/core/src/r5c/endpoints.ts`:

- Set `status`, `recordStart`, `recordStop`, `liveView`, and the `control(id, value)`
  builder from the verified requests.
- Implement `parseStatus(raw)` from the **status response** shape the analyzer showed
  (likely JSON) — map record state, ISO, shutter, iris, WB, etc. into our snapshot.
  Promise only what the camera actually reports (capability rule).
- If the Browser Remote needed a login request first, set `login`.

The driver goes live the moment `status` + `recordStart` + `recordStop` are non-null
(`isConfigured`). No other code changes — REST, the Stream Deck module, and the UI all
work through the common driver interface.

## 5. Test

- Add the camera in the app with **driver `r5c`** and the R5 C's host/credentials
  (`config/cameras.json` → `{ "driver": "r5c", "host": "<ip>", "auth": {…} }`).
- Connect: status should go **connected**, record + exposure should drive the camera, and
  the values should reflect back in the panel and over the REST API / Stream Deck.
- Record the firmware version in `README.md` — the Browser Remote endpoints are the part
  most likely to change on an R5 C firmware update.

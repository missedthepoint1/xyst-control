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

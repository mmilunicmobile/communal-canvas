# AGENTS.md

## Project overview

Communal Canvas is a two-package monorepo: a Python **backend** that drives a 20x15 LED grid (or a simulation image) and an Astro **frontend** that controls it. The two packages are **independent** — each has its own dependency manager, no workspace config links them.

## Commands

### Frontend (`frontend/`)
- `npm run dev` — start Astro dev server
- `npm run build` — production build to `dist/`
- `npm run preview` — preview production build

### Backend (`backend/`)
- `uv run uvicorn main:app --host 0.0.0.0 --port 8000` — start the server
- Python is managed with `uv`. Use `uv run` / `uv add` etc., do not use plain `pip`.

### Deploy
- `./deploy.sh <remote-host>` — builds frontend, then rsyncs backend and `frontend/dist/` → `static/` to the remote host.

## Architecture

```
frontend/   →  Astro 6 + React 19 + Tailwind v4 + shadcn/ui (Radix + RemixIcon)
backend/    →  FastAPI + SQLite + Pillow (+ optional rpi-ws281x for hardware)
```

- **Path aliases (frontend):** `@/*` maps to `frontend/src/*` (defined in `tsconfig.json`).
- **shadcn CLI** uses `components.json` for component generation (to `@/components/ui`).

## Environment / setup gotchas

- **Node** ≥ 22.12.0 required for the frontend.
- The frontend Astro build output goes into `backend/static/` at deploy time, and the backend serves it via `StaticFiles(directory="static", html=True)` mounted at root **after all API routes** — so API/WS routes always win.
- For local frontend dev against a local backend, you need to configure an Astro proxy or set API URL in the frontend (otherwise it hits the same origin on Astro's dev port).

## Hardware vs simulation

`COMMUNAL_CANVAS_USE_HARDWARE` env var (default `"False"`)

- When `False` (default), the LED driver renders to `backend/sim.png` instead of physical NeoPixels. This is the safe default for local dev.
- The `rpi-ws281x` dependency is in `[project.optional-dependencies] dev` and will only install on a Raspberry Pi.
- LED serpentine mapping (`xy_to_index` in `led_driver.py`) is only applied in hardware mode. Simulation uses simple row-major.

## Database & storage

- SQLite database: `backend/canvaslights.db` — created automatically on startup, gitignored.
- Uploaded images: `backend/images/` — also gitignored, created on startup.
- The backend `lifespan` handler calls `database.init_db()` and initializes the LED driver.

## Environment variables

- `COMMUNAL_CANVAS_USE_HARDWARE` — enable physical NeoPixel driver (default `"False"`)
- `COMMUNAL_CANVAS_PASSKEY` — admin Bearer token (default `"changeme"`)

## Permissions

- Default permission settings are in `constants.py` (`DEFAULT_PERMISSION_SETTINGS`). They are inserted into the DB on startup (if not present).
- Auth uses Bearer token matching against the passkey (set via `COMMUNAL_CANVAS_PASSKEY`).

## No CI, lint, or test config

There are no GitHub Actions workflows, no linter/formatter configs, and no test scripts in either package. If adding these, follow repo conventions and add commands to this file.

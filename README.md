# The Infinite Dungeon (prototype)

Browser-based vertical slice of the design in `#THE INFINITE DUNGEON.md`: turn flow, a small floor, JSON-driven cards and monsters, PixiJS rendering, and an asset manifest so you can drop in PNG/WebP art later without changing game code.

## Requirements

- [Node.js](https://nodejs.org/) LTS (includes `npm`)

### If PowerShell says scripts are disabled (Windows)

PowerShell may block `npm.ps1`. Pick one approach:

1. **Easiest:** Double-click **`install.bat`** in this folder (then **`dev.bat`** to run the game), or open **Command Prompt** (not PowerShell) and run `npm install` / `npm run dev` there.
2. **Stay in PowerShell:** run `npm.cmd install` and `npm.cmd run dev` instead of `npm …`.
3. **Change policy for your user only** (one-time): in PowerShell, run  
   `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`  
   then try `npm install` again.

## Run in development

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`). Use the hand controls, click highlighted tiles or adjacent enemies when prompted, then **End turn** to resolve the dungeon card and monster phase.

## Production build

```bash
npm run build
npm run preview
```

`preview` serves the `dist` folder locally. You can also upload the contents of `dist` to any static host (GitHub Pages, Netlify, etc.).

## Artwork (`public/assets/manifest.json`)

Each entry under `sprites` can use:

- **`fallbackColor`**: hex color used with a fast tinted placeholder (no image file required).
- **`texture`** (optional): path under `public`, e.g. `"/assets/sprites/floor.png"`. If the file loads, it replaces the placeholder for that `spriteId`.

Cards and monsters reference `spriteId` only in data (`monsters.json` uses `enemy_slime` by default). Add or change files under `public/assets/`, then adjust the manifest.

## Project layout

| Path | Role |
|------|------|
| `src/engine/` | Grid parsing, orthogonal movement reachability, combat rolls |
| `src/game/` | State shape, reducer (`dispatch`), initial state, JSON loaders |
| `src/content/` | `cards.json`, `monsters.json`, `dungeon_cards.json`, `floor_sample.json` |
| `src/render/` | Pixi grid view, sprite manifest loader |
| `public/assets/` | Manifest and future image assets |

## Roadmap (phased, matches the design doc)

1. **Done (this prototype):** Core turn order (draw → play / discard bonuses / equip → end turn → dungeon card → monsters), starter deck subset, one floor layout, slime AI, Danger/Noise on HUD, dungeon deck stubs, fog toggle support on floors (`fogOfWar: true`), investigate bonus reveals the map when fog is on.
2. **Dungeon identity:** Themed generation, doors and locked-door + key guarantee, richer Dungeon Deck.
3. **Progression loop:** EXP and leveling, Gauntlet + stair room flow, Deck Pedestal draft (pick 1 of 3, trim deck), global Danger scaling on monsters.
4. **Economy:** Merchants as data-driven shops, gold sinks, shard/meta placeholder.
5. **Later:** Boss relics and boss fights, full skill trees, polish and meta progression.

Performance note: the grid redraws on game events only (not every animation frame), and sprites use batched `Texture.WHITE` tints until you swap in real textures.

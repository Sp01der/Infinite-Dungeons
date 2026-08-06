import { Assets, Rectangle, Texture } from "pixi.js";
import { assetUrl } from "../assetUrl";
import bundledManifest from "../content/sprites-manifest.json";

export type SpriteStyle =
  | { kind: "tinted"; tint: number; alpha?: number }
  | { kind: "texture"; texture: Texture; fallbackTint: number; alpha?: number };

export interface ManifestFile {
  sprites: Record<
    string,
    {
      texture?: string;
      /** Optional [x, y, width, height] region within a sprite sheet. */
      frame?: [number, number, number, number];
      fallbackColor?: string;
      alpha?: number;
    }
  >;
}

function parseHex(hex: string): number {
  const h = hex.startsWith("#") ? hex.slice(1) : hex;
  return Number.parseInt(h, 16);
}

/**
 * Start from bundled sprites (always complete), then overlay `/assets/manifest.json`
 * so public textures/overrides win without dropping newer sprite ids.
 */
async function resolveManifest(manifestUrl: string): Promise<ManifestFile> {
  const bundled = bundledManifest as unknown as ManifestFile;
  const merged: ManifestFile = {
    sprites: { ...bundled.sprites },
  };
  try {
    const res = await fetch(manifestUrl);
    if (res.ok) {
      const remote = (await res.json()) as ManifestFile;
      for (const [id, entry] of Object.entries(remote.sprites ?? {})) {
        merged.sprites[id] = { ...(merged.sprites[id] ?? {}), ...entry };
      }
    }
  } catch {
    /* keep bundled */
  }
  return merged;
}

/**
 * Loads `/assets/manifest.json` when served (dev/build), merged over bundled defaults
 * from `src/content/sprites-manifest.json`.
 */
export async function loadSpriteStyles(manifestUrl: string): Promise<Map<string, SpriteStyle>> {
  const manifest = await resolveManifest(manifestUrl);
  const map = new Map<string, SpriteStyle>();

  for (const [id, entry] of Object.entries(manifest.sprites)) {
    const fallbackTint = parseHex(entry.fallbackColor ?? "#888888");
    if (entry.texture) {
      try {
        const texture = await Assets.load<Texture>({
          src: assetUrl(entry.texture),
          data: { scaleMode: "nearest" },
        });
        if (texture.source) texture.source.scaleMode = "nearest";
        const resolvedTexture = entry.frame
          ? new Texture({
              source: texture.source,
              frame: new Rectangle(...entry.frame),
            })
          : texture;
        map.set(id, {
          kind: "texture",
          texture: resolvedTexture,
          fallbackTint,
          alpha: entry.alpha,
        });
        continue;
      } catch {
        /* fall through to tinted */
      }
    }
    map.set(id, { kind: "tinted", tint: fallbackTint, alpha: entry.alpha });
  }

  return map;
}

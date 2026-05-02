import { Assets, Texture } from "pixi.js";
import bundledManifest from "../content/sprites-manifest.json";

export type SpriteStyle =
  | { kind: "tinted"; tint: number; alpha?: number }
  | { kind: "texture"; texture: Texture };

export interface ManifestFile {
  sprites: Record<
    string,
    {
      texture?: string;
      fallbackColor?: string;
      alpha?: number;
    }
  >;
}

function parseHex(hex: string): number {
  const h = hex.startsWith("#") ? hex.slice(1) : hex;
  return Number.parseInt(h, 16);
}

async function resolveManifest(manifestUrl: string): Promise<ManifestFile> {
  try {
    const res = await fetch(manifestUrl);
    if (res.ok) return (await res.json()) as ManifestFile;
  } catch {
    /* use bundled */
  }
  return bundledManifest as ManifestFile;
}

/**
 * Loads `/assets/manifest.json` when served (dev/build). If fetch fails (e.g. file://),
 * uses bundled defaults from `src/content/sprites-manifest.json`.
 */
export async function loadSpriteStyles(manifestUrl: string): Promise<Map<string, SpriteStyle>> {
  const manifest = await resolveManifest(manifestUrl);
  const map = new Map<string, SpriteStyle>();

  for (const [id, entry] of Object.entries(manifest.sprites)) {
    if (entry.texture) {
      try {
        const texture = await Assets.load<Texture>(entry.texture);
        map.set(id, { kind: "texture", texture });
        continue;
      } catch {
        /* fall through to tinted */
      }
    }
    const tint = parseHex(entry.fallbackColor ?? "#888888");
    map.set(id, { kind: "tinted", tint, alpha: entry.alpha });
  }

  return map;
}

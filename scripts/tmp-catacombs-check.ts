import { generateCatacombs } from "../src/engine/catacombsGen";

const t0 = Date.now();
let ok = 0;
for (let i = 0; i < 8; i++) {
  const s = Date.now();
  const layout = generateCatacombs(1000 + i * 97);
  ok++;
  const special = layout.tombs.filter((t) => t.special).length;
  console.log(
    i,
    `${layout.width}x${layout.height}`,
    `tombs ${layout.tombs.length} special ${special}`,
    `doors ${layout.lockedDoors.length}`,
    `bones ${layout.bonelings.length}`,
    `${Date.now() - s}ms`,
  );
}
console.log("ok", ok, "total", Date.now() - t0, "ms");

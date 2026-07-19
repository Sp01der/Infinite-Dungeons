/** Base Magic card id → upgraded id (temporary transforms from Arcane Charge). */
export const MAGIC_UPGRADE: Record<string, string> = {
  magic_missile: "magic_missile_plus",
  fireball: "fireball_plus",
  lightning_bolt: "lightning_bolt_plus",
  arcane_charge: "arcane_charge_plus",
  shining_blade: "shining_blade_plus",
  arcane_shield: "arcane_shield_plus",
};

const MAGIC_DOWNGRADE: Record<string, string> = Object.fromEntries(
  Object.entries(MAGIC_UPGRADE).map(([base, plus]) => [plus, base]),
);

export function upgradedMagicCardId(cardId: string): string | null {
  return MAGIC_UPGRADE[cardId] ?? null;
}

/** Strip a temporary upgrade so discard / end-of-turn restore the base card. */
export function baseMagicCardId(cardId: string): string {
  return MAGIC_DOWNGRADE[cardId] ?? cardId;
}

export function isUpgradedMagicCard(cardId: string): boolean {
  return cardId in MAGIC_DOWNGRADE;
}

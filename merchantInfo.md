# Merchants — Complete Reference

Everything the game currently implements about stair-chamber merchants: shared rules, then full details for **Shifty** and **Mr. Robert Obamly**.

---

## Overview

Merchants are NPCs that appear in the **stair chamber** after you clear the floor’s **gauntlet**. You talk to them in **peace** phase, browse a shop of cards and consumables, and pay with **gold**.

There are two merchant IDs:


| ID       | Display name      | Shop title         |
| -------- | ----------------- | ------------------ |
| `shifty` | Shifty            | Shifty's wares     |
| `obamly` | Mr. Robert Obamly | Mr. Obamly's wares |


Only one merchant spawns per stair chamber. Stock and prices are rolled when they appear and stay until you leave the floor (`merchantState` is cleared on floor descent).

---



## When merchants spawn

1. Clear all living monsters in the **gauntlet** room (`processGauntletVictory`).
2. A **4×4 stair room** is attached flush to the **east** of the gauntlet (`attachStairRoom`).
3. The merchant is spawned (`spawnMerchantAfterGauntlet`).
4. Phase becomes **peace**. Deck is reshuffled. Log:
  `"The gauntlet falls silent. A stair chamber opens — peace. Your deck is reshuffled."`



### Which merchant?

`pickStairMerchantId()`:

- **25%** → Shifty  
- **75%** → Mr. Robert Obamly

Spawn log lines:

- Shifty: `"Shifty sets up shop in the stair chamber."`
- Obamly: `"Mr. Robert Obamly sets up shop in the stair chamber."`

---



## Placement in the stair room

Stair features (`StairFeaturePositions`), east-attached room origin `(x0, y0)`:


| Feature         | Position                    |
| --------------- | --------------------------- |
| Pedestal        | `(x0, y0)`                  |
| **Merchant**    | `(x0 + 1, y0)`              |
| Exit door cells | east column of the 4×4 room |
| Corner tile     | `(x0 + 3, y0 + 3)`          |


The merchant tile is occupied (cannot place other props there). Sprites:


| Merchant | Sprite key        | Texture                       | Fallback color |
| -------- | ----------------- | ----------------------------- | -------------- |
| Shifty   | `merchant_shifty` | `/assets/merchant_shifty.png` | `#7b3db8`      |
| Obamly   | `merchant_obamly` | `/assets/merchant_obamly.png` | `#2c5aa0`      |


Dialogue box backgrounds:

- Shifty: `/assets/shifty_dialogue.png` (CSS class `.shifty-dialogue-box`)
- Obamly: `/assets/obamly_dialogue.png` (class `.shifty-dialogue-box.merchant-obamly`)

---



## Shared interaction rules



### Requirements to talk

- Phase is `peace`
- `merchantState` is non-null
- Player is in the **same room** as the merchant (stair room)

Click the merchant sprite → `TALK_TO_MERCHANT`.

### Merchant UI phases (`ShiftyMerchantState.phase`)


| Phase      | Meaning                                               |
| ---------- | ----------------------------------------------------- |
| `idle`     | On the map; no overlay                                |
| `dialogue` | Dialogue box open (opening / sold-out / broke / etc.) |
| `shop`     | Shop panel open                                       |
| `confirm`  | Confirm purchase dialogue                             |


While phase is `dialogue`, `confirm`, or `shop`, **merchant UI blocks** other progression (`merchantUiBlocks`). Attempting other actions logs:  
`"Finish talking with {name} first."`

### Flow

1. **Talk** → opening dialogue (depends on met-before / left-shop-this-floor).
2. Choose **open shop** or **leave**.
3. In shop: click a listing → confirm dialogue → **Buy** or **Cancel**.
4. On buy: gold checked; if enough, deduct gold, grant item, reduce stock; remove listing if stock hits 0.
5. Close shop (Leave button, backdrop click, or Escape) → phase `idle`, sets `leftShopThisFloor: true`.
6. Talk again after leaving → “come back” style dialogue (merchants still have remaining stock).

Escape:

- Shop open → `CLOSE_MERCHANT_SHOP`
- Dialogue open → `RESOLVE_MERCHANT_DIALOGUE` with `leave`



### Run persistence (across floors)

Carried into the next floor (`advanceFloor` / equivalent):


| Flag / field        | Purpose                                                 |
| ------------------- | ------------------------------------------------------- |
| `shiftyMet`         | True after first conversation with Shifty this run      |
| `obamlyMet`         | True after first conversation with Obamly this run      |
| `obamlyRestockKeys` | Catalog keys sold out at Obamly (for next Obamly visit) |


**Not** carried: `merchantState` (reset to `null` on descend). Fresh listings are rolled when a merchant spawns on a later floor.

First conversation marks the matching `*Met` flag so later openings use the “Hello again” lines.

### Game commands


| Command                     | Role                                                                  |
| --------------------------- | --------------------------------------------------------------------- |
| `TALK_TO_MERCHANT`          | Open opening dialogue                                                 |
| `RESOLVE_MERCHANT_DIALOGUE` | Choice in dialogue/confirm (`open_shop`, `leave`, `buy`, `cancel`, …) |
| `SELECT_MERCHANT_ITEM`      | Pick a shop listing → confirm                                         |
| `CLOSE_MERCHANT_SHOP`       | Close shop; mark left this floor                                      |




### Listing model (`ShiftyListing`)

Shared shape for both merchants:


| Field         | Meaning                                                                                        |
| ------------- | ---------------------------------------------------------------------------------------------- |
| `id`          | Unique listing id for this shop instance                                                       |
| `kind`        | `card` | `bread` | `herb` | `gem` | `cheese` | `stew` | `flame`                                |
| `name`        | Display name                                                                                   |
| `basePrice`   | Catalog / computed base                                                                        |
| `price`       | Actual gold cost this visit                                                                    |
| `stock`       | Remaining units                                                                                |
| `cardId?`     | When `kind === "card"`                                                                         |
| `gemId?`      | When `kind === "gem"` — one of `strength` | `speed` | `luck` | `cards` | `healing` | `defense` |
| `catalogKey?` | Obamly only — restock tracking key                                                             |




### What buying grants


| Kind     | Effect                                                                     |
| -------- | -------------------------------------------------------------------------- |
| `card`   | Card id added to **discard pile**; log `"Bought {name} for {price} gold."` |
| `bread`  | `player.bread += 1`                                                        |
| `herb`   | `player.herb += 1`                                                         |
| `cheese` | `player.cheese += 1`                                                       |
| `stew`   | `player.stew += 1`                                                         |
| `flame`  | `player.flameOfDestruction += 1`                                           |
| `gem`    | `player.gems[gemId] += 1`                                                  |


Not enough gold:

- **Shifty:** `"You don't have enough gold! You trying to rip me off?"` → choice **Back to shop**
- **Obamly:** see Obamly broke dialogue below

Shop UI shows each line as: `{price}G · stock {stock}`.

---



## Item effects (consumables merchants sell)

These are inventory uses after purchase (player phase), not buy-time effects.

### Piece of Bread

- Use: `USE_BREAD`
- Restores **2 HP** (+ skill bread heal bonus), capped at missing HP
- Cannot use at full HP (`"You're not hungry."`)



### Healing Herb

- Use: `USE_HERB`
- Restores **1 HP**
- Cannot use at full HP



### Cheese

- Use: `USE_CHEESE`
- Restores up to **3 HP**
- Cannot use at full HP



### Obamly's Special Stew (Obamly only)

- Use: `USE_STEW`
- **+1 max HP**, then heal **6 HP** (capped at new max)
- Usable even at full HP (unlike bread/herb/cheese)
- UI title: `"Obamly's Special Stew — +1 max HP and heal 6 (capped)"`



### Flame of Destruction (Obamly shop; also appears as world loot)

- Use: `USE_FLAME_OF_DESTRUCTION`
- Opens picker to **destroy one card from the discard pile**
- Requires non-empty discard; can cancel (`RESOLVE_FLAME_DESTROY` with `null`) without consuming the flame
- On success: removes card from discard, consumes one flame



### Gems (`ShiftyGemId`)


| Gem          | Use effect                                                                |
| ------------ | ------------------------------------------------------------------------- |
| **Strength** | Next physical attack deals **×1.5** damage                                |
| **Speed**    | Next movement range is **doubled**                                        |
| **Luck**     | Chance mode set to **Highest** for the rest of this turn (restored after) |
| **Cards**    | **Draw 2**                                                                |
| **Healing**  | Heal **10% of max HP** (floored, min 1)                                   |
| **Defense**  | **+4** defense for the rest of this turn                                  |


---



# Shifty



## Character

- First merchant in the Infinite Dungeon (design intent from early notes).
- Friendly but opportunistic trader — “quality wares,” half-price boasts, accused rip-offs if you lack gold.
- Display name: **Shifty**



## Shop composition

Each visit: **3 unique cards** + **3 unique consumables** from his catalogs (6 listings total).

Shop note: `"Three cards and three consumables. Prices shift each visit."`

### Card catalog

All stock **1**. Price shift modes applied at shop creation.


| Card id             | Name              | Base price | Shift mode |
| ------------------- | ----------------- | ---------- | ---------- |
| `quickstep`         | Quickstep         | 9          | normal     |
| `tactical_approach` | Tactical Approach | 10         | normal     |
| `dash`              | Dash              | 15         | normal     |
| `knockback_punch`   | Knockback Punch   | 7          | normal     |
| `bow`               | Bow               | 8          | normal     |
| `loot_and_scoot`    | Loot and Scoot    | 12         | **up**     |
| `poisoned_blade`    | Poisoned Blade    | 11         | normal     |
| `mace_smash`        | Mace Smash        | 11         | normal     |
| `shield`            | Shield            | 7          | normal     |
| `stealthy_advance`  | Stealthy Advance  | 7          | normal     |
| `knife`             | Knife             | 9          | normal     |
| `spear`             | Spear             | 8          | normal     |
| `parry`             | Parry             | 5          | **none**   |
| `axe`               | Axe               | 8          | normal     |
| `focus`             | Focus             | 14         | **up**     |
| `potion_of_harming` | Potion of Harming | 12         | normal     |




### Consumable catalog


| Kind           | Name            | Base price | Stock | Shift     | Notes |
| -------------- | --------------- | ---------- | ----- | --------- | ----- |
| bread          | Piece of Bread  | 3          | 5     | normal    |       |
| herb           | Healing Herb    | 2          | 5     | **lowHp** |       |
| cheese         | Cheese          | 4          | 3     | normal    |       |
| gem / strength | Gem of Strength | 8          | 2     | normal    |       |
| gem / speed    | Gem of Speed    | 8          | 2     | normal    |       |
| gem / luck     | Gem of Luck     | 10         | 2     | normal    |       |
| gem / cards    | Gem of Cards    | 8          | 2     | normal    |       |
| gem / healing  | Gem of Healing  | 8          | 2     | normal    |       |
| gem / defense  | Gem of Defense  | 8          | 2     | normal    |       |


Shifty does **not** sell stew or Flame of Destruction.

### Price shifting (`shiftPrice`)

Final price is at least **1**.


| Mode     | Behavior                                                                    |
| -------- | --------------------------------------------------------------------------- |
| `none`   | Always exactly `basePrice` (e.g. Parry)                                     |
| `up`     | `base + rollInt(0, 5)` — only increases or stays                            |
| `normal` | `base ± rollInt(0, 5)` (random sign)                                        |
| `lowHp`  | If player HP **< 50%** of max HP: same as `normal`; otherwise fixed at base |


Prices are rolled once when Shifty’s shop is created for that stair visit.

### Listing ids

Examples: `shifty_{i}_{cardId}`, `shifty_{i}_gem_{gemId}`, `shifty_{i}_{kind}`.

## Dialogue



### Opening

**First meeting** (`!shiftyMet`, not left shop this floor):

> Greetings! You may address me as Shifty. I am a merchant who has set up shop here in the Infinite Dungeon. It's pretty dangerous down here, but there's loads of treasure!

Choices: **Let's trade** (`open_shop`) · **Maybe later** (`leave`)

**Met before:**

> Hello again. Care to have a look at my quality wares?

Choices: **Show me** · **Not now**

**Left shop this floor, talking again:**

> Changed your mind? I still have plenty of goods!

Choices: **Browse wares** · **Leave**

### Purchase confirm

Prefix: `"Ahh, thats a fine choice. "` then flavor:

- **25%** chance: `"You can't go wrong with buying a {itemName}"`
- Otherwise one of:
  - `"I see you have an eye for quality!"`
  - `"I risked my life getting that one!"`
  - `"I'm sellin' it at half price. Normally its way more expensive!"`

Choices: **Buy** · **Cancel**

### Broke

> You don't have enough gold! You trying to rip me off?

Choice: **Back to shop**

### Sold out

No special sold-out monologue — listings simply disappear when stock reaches 0. No restock tracking.

---



# Mr. Robert Obamly



## Character

- Formal, polite British-ish merchant (“good chap,” “I say,” “Great Scott!”).
- Display name: **Mr. Robert Obamly**
- Emphasizes: `"I have the best prices in the Infinite Dungeon!"`
- Exclusive goods: **Obamly's Special Stew**, and sells **Flame of Destruction** in shop.



## Shop composition

Each visit:

- **6 consumables** (from catalog + restock guarantees)
- **2 cards** (rarity-weighted from all playable deck cards)

Shop note: `"Six consumables and two cards. Prices stay put."`

Prices are **fixed** at catalog / rarity values (no Shifty-style shift).

### Consumable catalog


| Catalog key    | Kind   | Name                  | Base price (= price) | Base stock |
| -------------- | ------ | --------------------- | -------------------- | ---------- |
| `bread`        | bread  | Piece of Bread        | 3                    | 5          |
| `herb`         | herb   | Healing Herb          | 2                    | 5          |
| `cheese`       | cheese | Cheese                | 4                    | 3          |
| `gem_strength` | gem    | Gem of Strength       | 5                    | 2          |
| `gem_speed`    | gem    | Gem of Speed          | 5                    | 2          |
| `gem_healing`  | gem    | Gem of Healing        | 5                    | 2          |
| `gem_defense`  | gem    | Gem of Defense        | 5                    | 2          |
| `gem_cards`    | gem    | Gem of Cards          | 6                    | 2          |
| `gem_luck`     | gem    | Gem of Luck           | 7                    | 2          |
| `stew`         | stew   | Obamly's Special Stew | 8                    | 3          |
| `flame`        | flame  | Flame of Destruction  | 6                    | 1          |


Compared to Shifty, Obamly’s gems are cheaper (5–7 vs 8–10). He has stew and flame; Shifty has none of those.

### Restock system (`obamlyRestockKeys`)

Only for **non-card** (“consumable”) listings that hit stock 0 after a purchase:

1. Listing’s `catalogKey` is appended to `obamlyRestockKeys` (if not already present).
2. Sold-out dialogue plays (see below).
3. On the **next Obamly shop creation**:
  - Each pending key is **guaranteed** a slot among the 6 consumables.
  - That entry gets **stock = baseStock + 1**.
  - Remaining slots filled by random unique picks from the rest of the catalog.
  - Consumed keys are removed from `obamlyRestockKeys` for that visit (`nextRestockKeys`).

Cards do **not** enter the restock queue.

### Card offers

Two independent rolls via `pickObamlyCard`:

1. Collect playable cards: `isPlayableDeckCard` — excludes bonus/penalty chits and rarity `"Merchant"`.
2. Roll rarity pool:
  - **0–40%:** Basic (fallback Common → Uncommon)
  - **40–80%:** Common (fallback Basic → Uncommon)
  - **80–100%:** Uncommon (fallback Common → Basic)
3. Pick uniform random card from chosen pool.
4. Empty fallback: Move for 5 gold.

Card prices by rarity:


| Rarity                                            | Price |
| ------------------------------------------------- | ----- |
| Basic                                             | 5     |
| Common                                            | 7     |
| Uncommon (and any other handled as Uncommon tier) | 9     |


Card stock: always **1**. Listing ids: `obamly_card_{0|1}_{cardId}`.

Consumable listing ids: `obamly_{index}_{catalogKey}`.

## Dialogue



### Opening

Shared browse choices when coming back / “best prices” lines: **Browse wares** · **Leave**.

**Left shop this floor:**

- **25%:** `"I have the best prices in the Infinite Dungeon!"`
- Else: `"I say, my goods are still fine as ever! Care to have a look?"`

**Met before (first talk this floor):**

- **25%:** best-prices line (Browse / Leave)
- Else: `"Hello again good chap! Care to browse my wares?"` — **Show me** · **Not now**

**First meeting:**

> Good day to you, sir! I am Mr. Robert Obamly, here to sell my wares. Care to browse my fine selection?

Choices: **Let's trade** · **Maybe later**

### Purchase confirm (by listing kind)


| Situation             | Text                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------ |
| Bread / herb / cheese | `"Always good to keep your food supplies high down in this Dungeon."`                      |
| Gem of Strength       | `"As they always say, a good offense is the best defense! Or is it the otherway round..."` |
| Gem of Speed          | `"A chap could outrun a raging beast with one of those!"`                                  |
| Gem of Healing        | `"Always good to stay healthy."`                                                           |
| Gem of Defense        | `"It's like they all ways say, a good defense is the best offense!"`                       |
| Gem of Cards          | `"A Gem of Cards is a fine choice. That'll be six gold."`                                  |
| Gem of Luck           | `"That'll be seven gold, cause seven is a lucky number!"`                                  |
| Stew                  | `"That's my own secret recipe! Finest stew in all the world, if I do say so myself!"`      |
| Flame                 | `"Very useful for burning cardboard you don't want, isn't it?"`                            |
| Card (default)        | `"Having some spare cardboard on hand is always useful."`                                  |


Choices: **Buy** · **Cancel**

### Sold out (consumable stock → 0)

> Great Scott! You've bought all of my {itemName}. I'll have to restock.

Choice: **Back to shop**

### Broke

> I say! Seems like you don't have enough money old chap. Better come back later with more.

Choice: **Back to shop**

---



## UI / player-facing hints

Hints while merchant is active (peace):

- Dialogue: `"{name} is talking — choose a reply."`
- Shop: `"Browse {name}'s shop, or leave when you're done."`
- Idle on map: `"Peace — click {name} to talk, the pedestal first, then the east stair to descend."`

Display names from `merchantDisplayName`: `Shifty` / `Mr. Robert Obamly` / fallback `"the merchant"`.

---



## Implementation map


| Concern                            | Source files                                                              |
| ---------------------------------- | ------------------------------------------------------------------------- |
| Shared commands, grant, spawn pick | `src/game/merchantRuntime.ts`                                             |
| Shifty catalogs, prices, dialogue  | `src/game/shifty.ts`                                                      |
| Obamly catalogs, restock, dialogue | `src/game/obamly.ts`                                                      |
| Types / flags                      | `src/game/types.ts`                                                       |
| Gauntlet → stair → spawn           | `src/game/reducer.ts` (`processGauntletVictory`), `src/game/stairRoom.ts` |
| Floor persistence of met/restock   | `src/game/initialState.ts`                                                |
| UI sync, shop notes                | `src/main.ts`                                                             |
| Sprites                            | `src/content/sprites-manifest.json`, `src/render/gridView.ts`             |
| Styles                             | `src/style.css` (`.shifty-dialogue`, `.shifty-shop-*`)                    |
| Consumable / gem use effects       | `src/game/reducer.ts` (`USE_*`)                                           |


---



## Quick comparison


|                   | Shifty                  | Obamly                                   |
| ----------------- | ----------------------- | ---------------------------------------- |
| Spawn chance      | 25%                     | 75%                                      |
| Listings          | 3 cards + 3 consumables | 6 consumables + 2 cards                  |
| Card pool         | Fixed 16-card catalog   | All playable deck cards, rarity-weighted |
| Prices            | Shift each visit        | Fixed                                    |
| Exclusive stock   | —                       | Stew, Flame of Destruction               |
| Gem prices        | Higher (8–10)           | Lower (5–7)                              |
| Sold-out tracking | None                    | Restock queue + bonus stock              |
| Broke tone        | Accusatory              | Polite                                   |
| Price pitch       | Half-price boasts       | “Best prices in the dungeon”             |



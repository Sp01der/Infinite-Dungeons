# Merchants — Complete Reference

Everything the game currently implements about stair-chamber merchants: shared rules, then full details for **Shifty**, **Mr. Robert Obamly**, and **Sennis the Wizard**.

---

## Overview

Merchants are NPCs that appear in the **stair chamber** after you clear the floor’s **gauntlet**. You talk to them in **peace** phase, browse a shop of cards and consumables, and pay with **gold**.

There are three merchant IDs:


| ID       | Display name      | Shop title         |
| -------- | ----------------- | ------------------ |
| `shifty` | Shifty            | Shifty's wares     |
| `obamly` | Mr. Robert Obamly | Mr. Obamly's wares |
| `sennis` | Sennis            | Sennis's wares     |


Only one merchant spawns per stair chamber. Stock and prices are rolled when they appear and stay until you leave the floor (`merchantState` is cleared on floor descent).

---



## When merchants spawn

1. Clear all living monsters in the **gauntlet** room (`processGauntletVictory`).
2. A **4×4 stair room** is attached flush to the **east** of the gauntlet (`attachStairRoom`).
3. The merchant is spawned (`spawnMerchantAfterGauntlet`).
4. Phase becomes **peace**. Deck is reshuffled. Log:
  `"The gauntlet falls silent. A stair chamber opens — peace. Your deck is reshuffled."`



### Which merchant?

`pickStairMerchantId()` — equal chance among the three:

- **1/3** → Shifty  
- **1/3** → Mr. Robert Obamly  
- **1/3** → Sennis the Wizard  

Spawn log lines:

- Shifty: `"Shifty sets up shop in the stair chamber."`
- Obamly: `"Mr. Robert Obamly sets up shop in the stair chamber."`
- Sennis: `"Sennis the Wizard sets up shop in the stair chamber."`

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
| Sennis   | `merchant_sennis` | `/assets/merchant_sennis.png` | `#3d6ed8`      |


Dialogue box backgrounds:

- Shifty: `/assets/shifty_dialogue.png` (CSS class `.shifty-dialogue-box`)
- Obamly: `/assets/obamly_dialogue.png` (class `.shifty-dialogue-box.merchant-obamly`)
- Sennis: `/assets/sennis_dialogue.png` (class `.shifty-dialogue-box.merchant-sennis`)

---



## Shared interaction rules



### Requirements to talk

- Phase is `peace`
- `merchantState` is non-null
- Player is in the **same room** as the merchant (stair room)

Click the merchant sprite → `TALK_TO_MERCHANT`.

### Merchant UI phases (`ShiftyMerchantState.phase`)


| Phase       | Meaning                                               |
| ----------- | ----------------------------------------------------- |
| `idle`      | On the map; no overlay                                |
| `dialogue`  | Dialogue box open (opening / sold-out / broke / etc.) |
| `shop`      | Shop panel open                                       |
| `confirm`   | Confirm purchase dialogue                             |
| `tome_hub`  | Sennis only — Magic Tome hub                          |
| `tome_buy`  | Sennis only — buy unbound Tome                        |
| `tome_bind` | Sennis only — bind unbound Tome                       |
| `tome_sell` | Sennis only — sell unbound / bound Tomes              |


While phase is `dialogue`, `confirm`, `shop`, or any `tome_*` phase, **merchant UI blocks** other progression (`merchantUiBlocks`). Attempting other actions logs:  
`"Finish talking with {name} first."`

### Flow

1. **Talk** → opening dialogue (depends on met-before / left-shop-this-floor).
2. Choose **open shop** or **leave**.
3. In shop: click a listing → confirm dialogue → **Buy** or **Cancel**.
4. On buy: gold checked; if enough, deduct gold, grant item, reduce stock; remove listing if stock hits 0.
5. **Sennis only:** shop also has **Discuss Magic Tomes** (`OPEN_MERCHANT_TOMES`) → tomes flow (see Sennis).
6. Close shop (Leave button, backdrop click, or Escape) → phase `idle`, sets `leftShopThisFloor: true`.
7. Talk again after leaving → “come back” style dialogue (merchants still have remaining stock).

Escape:

- Shop open → `CLOSE_MERCHANT_SHOP`
- Dialogue open → `RESOLVE_MERCHANT_DIALOGUE` with `leave`



### Run persistence (across floors)

Carried into the next floor (`advanceFloor` / equivalent):


| Flag / field          | Purpose                                                       |
| --------------------- | ------------------------------------------------------------- |
| `shiftyMet`           | True after first conversation with Shifty this run            |
| `obamlyMet`           | True after first conversation with Obamly this run            |
| `obamlyRestockKeys`   | Catalog keys sold out at Obamly (for next Obamly visit)       |
| `sennisMet`           | True after first conversation with Sennis this run            |
| `sennisTomeExplained` | True after first Magic Tomes explanation from Sennis this run |


**Not** carried: `merchantState` (reset to `null` on descend). Fresh listings are rolled when a merchant spawns on a later floor.

First conversation marks the matching `*Met` flag so later openings use the “Hello again” lines.

### Game commands


| Command                     | Role                                                                  |
| --------------------------- | --------------------------------------------------------------------- |
| `TALK_TO_MERCHANT`          | Open opening dialogue                                                 |
| `RESOLVE_MERCHANT_DIALOGUE` | Choice in dialogue/confirm (`open_shop`, `leave`, `buy`, `cancel`, …) |
| `SELECT_MERCHANT_ITEM`      | Pick a shop listing → confirm                                         |
| `OPEN_MERCHANT_TOMES`       | Sennis only — open Magic Tomes flow from shop                         |
| `CLOSE_MERCHANT_SHOP`       | Close shop; mark left this floor                                      |



### Listing model (`ShiftyListing`)

Shared shape for all merchants:


| Field         | Meaning                                   |
| ------------- | ----------------------------------------- |
| `id`          | Unique listing id for this shop instance  |
| `kind`        | See kinds below                           |
| `name`        | Display name                              |
| `basePrice`   | Catalog / computed base                   |
| `price`       | Actual gold cost this visit               |
| `stock`       | Remaining units                           |
| `cardId?`     | When `kind === "card"`                    |
| `gemId?`      | When `kind === "gem"` — one of `strength` |
| `catalogKey?` | Obamly (restock) / Sennis (listing id)    |


Kinds: `card` | `bread` | `herb` | `gem` | `cheese` | `stew` | `flame`.

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
- **Sennis:** see Sennis broke dialogue below (same line for shop buys and Tome bind/buy)

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



### Flame of Destruction (Obamly / Sennis shops; also appears as world loot)

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



### Magic Tomes (Sennis services; also appear as world loot)

- **Unbound Magic Tome** (`player.unboundTomes`): stackable. Player can bind themselves in combat (`USE_UNBOUND_TOME` → discard a Magic card from hand → Bound with 3 charges). Sennis can also bind for gold without spending a card from the player.
- **Bound Magic Tome** (`player.boundTomes[]`): does not stack. Each has `id`, `cardId`, `charges` (starts at 3). Cast via `USE_BOUND_TOME` like playing that spell; each cast consumes a charge.



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



# Sennis the Wizard



## Character

- Merchant from the **Mage Guild**. Calm, direct, magic-focused.
- Display name: **Sennis**
- Exclusive services: **Magic Tomes** (buy / bind / sell). Sells Mage Guild spell cards and magical consumables (gems, Flame of Destruction).
- Does **not** sell food, stew, or Gem of Speed.



## Shop composition

Each visit, randomly one of:

- **2 consumables + 3 cards**, or  
- **3 consumables + 2 cards**

Shop note: `"Magic goods from the Mage Guild. Discuss Magic Tomes below."`

Prices are **fixed** at catalog values (no Shifty-style shift). Shop panel includes a **Discuss Magic Tomes** button (`OPEN_MERCHANT_TOMES`).

### Consumable catalog

Unique picks (no duplicates in one shop). Gems roll stock **1–2** each visit; Flame always stock **2**.


| Catalog key    | Kind  | Name                 | Price | Stock      |
| -------------- | ----- | -------------------- | ----- | ---------- |
| `gem_strength` | gem   | Gem of Strength      | 6     | 1–2 random |
| `gem_healing`  | gem   | Gem of Healing       | 6     | 1–2 random |
| `gem_defense`  | gem   | Gem of Defense       | 6     | 1–2 random |
| `gem_cards`    | gem   | Gem of Cards         | 6     | 1–2 random |
| `gem_luck`     | gem   | Gem of Luck          | 7     | 1–2 random |
| `flame`        | flame | Flame of Destruction | 6     | 2          |


Sennis does **not** sell bread, herb, cheese, stew, or Gem of Speed.

### Card catalog

Weighted unique picks (no duplicates in one shop). All stock **1**. **Arcane Charge** is weighted **twice** as common as the others.


| Card id          | Name          | Price | Weight |
| ---------------- | ------------- | ----- | ------ |
| `shining_blade`  | Shining Blade | 6     | 1      |
| `arcane_shield`  | Arcane Shield | 7     | 1      |
| `fireball`       | Fireball      | 8     | 1      |
| `magic_missile`  | Magic Missile | 9     | 1      |
| `arcane_charge`  | Arcane Charge | 10    | **2**  |
| `lightning_bolt` | Lightning Bolt| 14    | 1      |


### Listing ids

Examples: `sennis_{i}_{catalogKey}`, `sennis_{i}_{cardId}`.

## Dialogue



### Opening

**First meeting** (`!sennisMet`, not left shop this floor):

> Hello. My name is Sennis of the Mage Guild. I would be willing to trade with you, for I offer powerful magic items.

Choices: **Let's trade** (`open_shop`) · **Maybe later** (`leave`)

**Met before:**

> Hello. Would you be willing to trade? Perhaps I could interest you in a Magic Tome.

Choices: **Show me** · **Not now**

**Left shop this floor, talking again:**

> I'm always willing to trade.

Choices: **Browse wares** · **Leave**

### Purchase confirm (by listing)



| Situation                         | Text                                                                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Gem (any)                         | `"These Gems contain concentrated magical energy. Simply break it to release its power."`                                         |
| Flame of Destruction              | `"These Flames were created with magic, and thus can permanently destroy cards in the dungeon. Very useful."`                     |
| Shining Blade / Arcane Shield     | `"Basic Spells in card form. The simplest of magic. But even the simplest magic can be highly effective."`                        |
| Fireball                          | `"Beware. The rash mage will throw fireballs with no regard, and in doing so burn themselves."`                                   |
| Magic Missile                     | `"Simple and powerful. The same attack Mystic Cores use."`                                                                        |
| Arcane Charge                     | `"A specialty of the Mage Guild. Charging your magic makes it far more effective."`                                               |
| Lightning Bolt                    | `"Such magic is dangerous, and rare. Can you wield the power of thunder?"`                                                        |


Choices: **Buy** · **Cancel**

### Sold out

No special sold-out monologue — listings simply disappear when stock reaches 0. No restock tracking.

### Broke

Used for shop purchases, buying unbound Tomes, and binding Tomes:

> You'll need a bit more gold than that. Magic is expensive, you know.

Choice returns to the prior menu (**Back to shop**, **Back**, etc.).

---



## Magic Tomes (Sennis-only service)

Entered from the shop via **Discuss Magic Tomes** (`OPEN_MERCHANT_TOMES`).

### First explanation (`!sennisTomeExplained`)

> Magic Tomes a books that can be imbued with magical energy from cards. This is called Binding. Once Bound, they can expel the energy to achieve various effects. Doing so does damage the Tome though, so they don't last forever.

Choice: **Continue** (`tome_hub`) — sets `sennisTomeExplained = true`, then opens the hub.

### Hub (`tome_hub`)

> What would you like to do with Magic Tomes?

Choices:

- **Buy Magic Tomes** (`tome_buy_offer`)
- **Bind Magic Tomes** (`tome_bind_menu`)
- **Sell Magic Tomes** (`tome_sell_menu`)
- **Back to shop** (`open_shop`)

### Buy Magic Tomes (`tome_buy`)

> I will sell you an unbound Tome for 4 gold.

Choices: **Buy** (`buy_unbound_tome`) · **Cancel** (`tome_hub`)

On buy: deduct **4** gold, `unboundTomes += 1`. Stay on the buy offer so another can be purchased. Broke → broke dialogue, then back to hub.

### Bind Magic Tomes (`tome_bind`)

Intro:

> You may give me an Unbound Tome and I can Bind it for you.

Requires `unboundTomes > 0`. If none: same text plus *"You don't have an Unbound Tome right now."* → **Back** to hub.

Otherwise choose a spell (player spends **Unbound Tome + gold only** — no card from hand/discard). Bound tome granted with **3 charges**.


| Spell           | Bind cost |
| --------------- | --------- |
| Shining Blade   | 3G        |
| Arcane Shield   | 3G        |
| Fireball        | 4G        |
| Magic Missile   | 4G        |
| Lightning Bolt  | 5G        |
| Arcane Charge   | 5G        |


On success:

> There! This book now contains the magic of {card name}. It has three charges.

Choice: **Continue** → hub.

Broke → broke dialogue, then back to bind menu.

### Sell Magic Tomes (`tome_sell`)

> I will buy an Unbound Tome for 3 gold. If you have a Bound Tome, I'll give you an extra gold for each Charge remaining.

Sell options listed as choices:

- Unbound: **3G** each (`sell_unbound`)
- Bound: **3G + remaining charges** (`sell_bound_{tomeId}`)

Choice: **Done** (`tome_hub`). If nothing to sell, dialogue notes that and offers **Back**.

---



## UI / player-facing hints

Hints while merchant is active (peace):

- Dialogue: `"{name} is talking — choose a reply."`
- Shop: `"Browse {name}'s shop, or leave when you're done."`
- Idle on map: `"Peace — click {name} to talk, the pedestal first, then the east stair to descend."`

Display names from `merchantDisplayName`: `Shifty` / `Mr. Robert Obamly` / `Sennis` / fallback `"the merchant"`.

Sennis shop extras:

- Title: `"Sennis's wares"`
- Note: `"Magic goods from the Mage Guild. Discuss Magic Tomes below."`
- Button: **Discuss Magic Tomes** (hidden for other merchants)

---



## Implementation map


| Concern                            | Source files                                                              |
| ---------------------------------- | ------------------------------------------------------------------------- |
| Shared commands, grant, spawn pick | `src/game/merchantRuntime.ts`                                             |
| Shifty catalogs, prices, dialogue  | `src/game/shifty.ts`                                                      |
| Obamly catalogs, restock, dialogue | `src/game/obamly.ts`                                                      |
| Sennis catalogs, tomes, dialogue   | `src/game/sennis.ts`                                                      |
| Types / flags                      | `src/game/types.ts`                                                       |
| Gauntlet → stair → spawn           | `src/game/reducer.ts` (`processGauntletVictory`), `src/game/stairRoom.ts` |
| Floor persistence of met/restock   | `src/game/initialState.ts`                                                |
| UI sync, shop notes, Tomes button  | `src/main.ts`, `index.html`                                               |
| Sprites                            | `src/content/sprites-manifest.json`, `src/render/gridView.ts`             |
| Styles                             | `src/style.css` (`.shifty-dialogue`, `.merchant-sennis`, `.shifty-shop-*`) |
| Consumable / gem / tome use        | `src/game/reducer.ts` (`USE_*`)                                           |


---



## Quick comparison


|                   | Shifty                  | Obamly                                   | Sennis                                              |
| ----------------- | ----------------------- | ---------------------------------------- | --------------------------------------------------- |
| Spawn chance      | 1/3                     | 1/3                                      | 1/3                                                 |
| Listings          | 3 cards + 3 consumables | 6 consumables + 2 cards                  | 2+3 or 3+2 (consumables/cards)                      |
| Card pool         | Fixed 16-card catalog   | All playable deck cards, rarity-weighted | Fixed 6 Magic / Mage Guild cards (Arcane Charge ×2) |
| Prices            | Shift each visit        | Fixed                                    | Fixed                                               |
| Exclusive stock   | —                       | Stew                                     | Magic Tomes service; Mage Guild spell catalog       |
| Flame in shop     | No                      | Yes (stock 1)                            | Yes (stock 2)                                       |
| Gem prices        | Higher (8–10)           | Lower (5–7)                              | Mid (6–7); no Speed                                 |
| Sold-out tracking | None                    | Restock queue + bonus stock              | None                                                |
| Broke tone        | Accusatory              | Polite                                   | Matter-of-fact (“Magic is expensive”)               |
| Extra service     | —                       | —                                        | Buy / bind / sell Magic Tomes                       |


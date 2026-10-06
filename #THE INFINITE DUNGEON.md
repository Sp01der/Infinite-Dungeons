#THE INFINITE DUNGEON
The Infinite Dungeon is a rouge-like game where you explore a procedurally generated dungeon using cards. The game is played on a 2d grid and turn based. You draw
cards from your deck and play them. These cards can be used to move, attack, or interact with the environment. Each card has an effect that happens when played.

Additionally, each card can be discarded to preform a bonus action. You can punch an enemy, or move one space. You may also investigate.
More advanced cards are move, or short sword, which allow you to move two spaces, or attack an enemy with a sword. Your goal is to go as deep as you
can without dying to the monsters and hazards in the dungeon, collecting as much treasure as you can.
Each floor has a randomly selected theme, which determines how it is generated. It also effects the Dungeon Deck, which is a deck of cards which cause negative effects.

##TURN ORDER
First, the game updates any necessary effects, and draws three cards from the deck to add to your hand. You can then play any number of cards, either for their
effect or to discard for a basic action. You may also choose to equip a card. Equipped cards are not played this turn, but until they are unequipped,
they will automatically be put on the top of your deck instead of being discarded each turn. Once you've played all the cards you want to and used any consumables or
abilities, you can end your turn. Any remaining cards in your hand are discarded, and the dungeon draws its card from the Dungeon Deck. The Monsters then take their move.

##DUNGEON LAYOUT
Once a player descends to a new floor, the dungeon layout is generated. It will be a series of rooms of varous shapes and sizes, connected by corridors.
These rooms will spawn monsters, treasure chests, pots, loot on the ground, and other items. Some rooms will also have special tiles.

the tiles themselves can be special, water, lava, holes, rocks etc.

You cannot see rooms until discovered. to discover a room you must land on a space in another room that connects to it, which allows the player to see the room and its contents. Investigating using a bonus action allows you to discover a room without going next to it. Rooms on that floor always exist, but only can be seen when discovered. their can also be a door between two rooms. Doors can be moved through, but block attacks, ranged and melee, as well as discovering rooms and other adjacent effects. (Basically, their walls you can move through) Doors can also be locked, but if there is a locked door there MUST always be a key spawned on that floor before the room. 

Each floor has a starting room, a treasure room, the guantlet room and the stair room. The starting room is always the first room on the floor. The treasure room is
somewhere random on the floor, often blocked by a breakable wall, locked door or a tough fight, but it contains the best loot.
The Gauntlet is the second last room on the floor with one entrance. The Gauntlet room and the corridor that leads into it are **empty at floor setup**: no monsters, pots, chests, or other ground loot spawn there. Upon first entry into the Gauntlet chamber, the approach corridor is sealed (blocked off), and a wave of monsters is placed at random valid floor tiles in the Gauntlet only. Spawn positions never include the player’s tile and never include a tile orthogonally adjacent to the player (if there are too few such tiles, placement may relax the adjacency rule so the wave can still appear). Each monster has a **power level**; the **total power of all monsters in that Gauntlet wave is always 10**. For now: most monsters count as **3**, **skeletons** as **4**, **cave bats** as **2** (other monster types will get explicit values later). Once every monster
is dead, the exit unlocks, leading you to the stair room. The stair room is the last room on the floor, and the only way to descend to the next floor. It is small,
but it contains money and a Deck Pedastool. The Deck pedastool automatically reshuffles your deck and gives you the option to pick one new card to add
to your deck from three options. The Stair room also has the exit door, the stair leading down and a random merchant.
There are a number of merchants each with their own unique wares and services.

###Merchants
Shifty - a shady merchant who will sell and buy cards, as well as other wares.
Mr Obamly - Primarily sells consumables like food, potions and keys, but he has good prices and lots of options'=,
Sennis the Wizard - a wizard who will sell you magic cards, and also has a few unique items.
A Wandering Trader - a merchant who will sell you a large variety of common items and cards.
Fancy Business Slime - a special slime who will sell you some... interesting items and cards.
Unnamed Merchant (unlike everything else you can't see his name on text boxes or when hovering over him) - sells various risky items and cards that may
have negative effects.
Sensei Tenori - a wise master who will sell you experience points and unique abilites.
Dalin Anvil - a dwarve blacksmith who upgrades your cards for a price.
Count Fendalis Bloodeye - a vampire who will sell you special items and cards, but instead of money, he takes health.

You are more likely to encounter certain merchants on deeper levels, and also no merchants. You cannot encounter the same merchant twice in a run unless otherwise stated.

##PLAYER PROGRESSION
You start at level 1 with 10 health, 0 EXP 0 noise, 0 gold and a basic deck. Cards can be found in various ways and added to your deck. Everytime you 
defeat a monster you gain EXP. With enough EXP, you level up, gaining +5 health and skill points based on your level. Skill points are spent in the skill tree.
But beware, as monsters will also level up to. This is tracked by a global counter called 'Danger'. Each time you descend a to a new floor,
Danger is increased by 1. There is also a card near the bottom of the Dungeon Deck called 'The Dungeon is Deadlier' which increases Danger by 1 and reshuffles the Dungeon Deck.
All monsters not active and all monsters that are spawned from now on have a level equal to Danger. Additionally, certain effects escalate with Danger.
Noise is another thing which increases over time.

The skill tree is an important mechanic to upgrade yourself. It offers five small trees, Attack, Defense, Mobility, Vitality and Deck.
Attack offers abilities like extra damage, additional knockback etc. Defense is primarily for raising your minimum and maximum defense, but also has other skills later on. Mobility gives you additional move points you can spend without playing cards, as well as useful skills for exploring and looting.
Vitality raises your HP on one branch, but also offers boosts to items like food, potions and more. Deck is the most expensive tree, it offers skills like extra card draws on your turn, new cards, more equipments slots, low chances of negating the Dungeon Card etc.

## MONSTERS
there are a lot of monsters you'll encounter on your journey. From slimes to skeletons, from crystals to wild beasts, from dust sprites to dragons.
Monsters all have set actions they'll go through based on their behaviour. Their stats do get stronger as Danger rises, and deeper levels have stronger monsters by default. An example is that past a certain point you'll encounter Dwellers of the Abyss, horrid creatures that can darken the dungeon just by being in it.
Monsters have a chance to drop loot as well.
Monsters have two states: Active and Inactive. Inactive monsters do not move or do anything. Active monsters pursue the player, attempting to kill them. Monster only become active if: 1 you enter the same room as them, 2 there is a clear, direct line between you and the monster or 3: You are less than Noise*2 spaces away from them, no matter what is in between. At first, option 3 won't matter much, and 1 and maybe 2 will be the main way monsters activate. But as you amass noise delving deeper into the Dungeon, you will find that the monsters start coming for you much earlier. Additionally, once noise gets to high in deeper levels terrible creatures will start awaking.

Noise is accumalted from cards, some you play and some the Dungeon draws from the Dungeon Deck.

##LOOT
Loot can spawn on the floor or be dropped by monsters. It can also be found in chests or pots, or generated by cards.
Loot generated by cards spawns only in discovered rooms. Pots can be broken and have a 40% chance of spawning loot. They can be broken by moving onto them or being attacked. the things they drop fall on the floor. Loot on the floor is picked up just by being adjacent to it. If you move onto a chest, it is opened by moving onto them. They have a 100% chance of giving you some form of loot, but their are tiers of chests and also tiers of pots.
Gold is currency spent on shops inside the dungeon. Cards are cards. Items are generaly consumables, not always. Shards are a special resource not used in the Dungeon, but are the main currency outside it.
More on the Meta-game later.

##STATUS EFFECTS
Status effects are persistent conditions that affect a creature over multiple turns.

**Fire** — After the inflicted creature takes its turn, the Fire level on that creature decreases by 1, and the creature takes damage equal to 20% of its maximum HP. This repeats each turn until the Fire level reaches 0. Multiple sources of Fire stack by adding to the current Fire level.

**Freezing** — While a creature has any Freezing, it gains +2 defense and cannot act. At the end of each of its turns, Freezing decreases by 1. Levels stack. A frozen creature's sprite is tinted light blue.

##CARDS
In this deck-building, dungeon crawling, treasure-hunting rouglike cards are the most important thing. They are how you do everything.
To reiterate, you draw cards at the start of your turn, three is the basic amount, but as you gain skills you can draw more.
You may play any number of cards on your turn, and must carry out the full effect of the card before doing anything else. You may discard cards to perform a bonus action. Or equip them. You can only have one card equipped at a time. You can use as many cards as you have in your hand, and there is no limit to how many plays you have or how many bonus actions.

Cards have types which determine when and how they interact with other effects and skills.
Card Types: Move, Attack, Magic, Protection, Aid, Skill, Deck, Alchemy, Penalty

Cards also have rarity:
Basic / Common / Uncommon / Rare / Legendary / Merchant / Bonus / Celestial

Source of truth: `src/content/cards.json` (player) and `src/content/dungeon_cards.json` (dungeon).
Magic upgrades via Arcane Charge: Magic Missile / Fireball / Lightning Bolt / Arcane Charge / Shining Blade / Arcane Shield → their `+` versions for the turn.

### Card List

#### Move
**Move** — Basic / Move
Move up to 2 spaces (orthogonal).

**Quickstep** — Common / Move
Draw a card, then move 1 space.

**Dash** — Rare / Move
Move up to 4 spaces (orthogonal).

**Loot and Scoot** — Rare / Move, Skill
Randomly spawn 0–2 coins in the dungeon. Move up to 2 spaces. If you land on a pot, gain 1 gold plus its loot.

**Stealthy Advance** — Uncommon / Aid
Move 1 space. −1 Noise. +1 defense this turn.

**Stay on the Move** — Uncommon / Skill, Move · Special
Choose a Move card from your discard pile which is immediately played.

**Flying Kick** — Common / Attack, Move · physical melee
Move 2 spaces in one direction. Targets in your path take 3–6 physical damage and 1 knockback. If the full move is blocked, nothing happens.

**Card Seeker** — Legendary / Skill, Move
Move 1 space. Drop 2 random cards as ground loot in rooms you can see.

#### Attack
**Copper Sword** — Basic / Attack · physical melee
Deal 3–5 damage to a target on an adjacent tile.

**Knife** — Common / Attack · physical melee
Deal 1–4 damage to a target on an adjacent tile, then draw a card.

**Spear** — Common / Attack · physical melee/ranged
Deal 3–5 damage along a 2-tile line. Choose an adjacent direction. Walls stop the line.

**Axe** — Common / Attack · physical melee
Deal 4–8 damage to a target on an adjacent tile. Add a Weariness card on top of your deck.

**Bow** — Common / Attack · physical ranged
Deal 3–4 damage to a target on a tile within 8 spaces. Requires line of sight. Cannot target adjacent tiles.

**Knockback Punch** — Uncommon / Attack · punch, physical melee
Deal 3–4 damage to a target on an adjacent tile (counts as a punch). Knock survivors back 2 spaces, plus any primed knockback.

**Poisoned Blade** — Uncommon / Attack · physical melee
Deal 2–5 damage to an adjacent target. If it takes more than 1 damage, it gains 3 levels of Poison.

**Mace Smash** — Uncommon / Attack · physical melee
Deal 6–10 damage to an adjacent target. Ignores 1 defense. Add two Weariness cards on top of your deck.

**Broadsword** — Uncommon / Attack · physical melee
Choose an adjacent direction. Deal 3–6 damage to the three tiles facing that way. Walls are skipped.

**Reckless Assault** — Uncommon / Attack · physical melee
Deal 3–6 damage to an adjacent target. Before dealing damage, choose to lose any amount of health. For every health you lose, the attack gains 2 damage.

**Thieving Strike** — Uncommon / Attack · physical melee
Deal 1–4 damage to an adjacent target. 25% chance of gaining one gold, or 100% if you kill the target with this attack. +1 gold if the target is hit with knockback this turn.

**Executioner's Axe** — Uncommon / Attack · physical melee · Catacombs only
Deal 4–8 damage to an adjacent target. If it dies, this card stays in your hand and you gain a movement token. Otherwise, it is discarded and two Weariness cards are added on top of your deck.

**Ancient Knife** — Rare / Attack · physical melee · Catacombs only
The Knife thirsts for blood… Deal 1–2 damage to an adjacent target and draw a card. If you kill the target, the Knife's power will grow.

**Icicle Lance** — Rare / Attack · physical melee
Deal 3–5 damage along a 3-tile line. Choose an adjacent direction. Walls stop the line. Apply 1 Freezing to each creature hit.

**Perfected Strike** — Rare / Attack · physical melee · Special
Discard any number of Attack cards from your hand. If you discard at least one, attack an adjacent target dealing 5 damage plus 5 more for each card discarded.

**Great Sword** — Legendary / Attack · physical melee
Choose an adjacent target for 7–12 damage, or a target 2 spaces away in a cardinal or diagonal line for 2–5 damage if nothing is between you.

**Weariness** — Bonus / Penalty
Playing this card destroys it. Cannot be used for bonus actions.

#### Magic / Attack
**Magic Missile** — Rare / Magic, Attack · ranged
Deal 1–6 damage to a target on one tile in a straight or diagonal line from you. Ignores defense.

**Magic Missile+** — Rare / Magic, Attack · ranged · Arcane Charge upgrade
Deal 5–6 damage to a target on one tile in a straight or diagonal line from you. Ignores defense.

**Fireball** — Uncommon / Magic, Attack · ranged
Choose a square within 8 spaces (line of sight). Deal 4–6 damage in a 3×3 blast and inflict 1–2 Fire levels on everything hit.

**Fireball+** — Uncommon / Magic, Attack · ranged · Arcane Charge upgrade
Choose a square within 8 spaces (line of sight). Deal 5–7 damage in a 3×3 blast and inflict 5 Fire levels on everything hit.

**Lightning Bolt** — Legendary / Magic, Attack · ranged
Hit a target on a tile within 5 spaces for 5 damage, then chain to new targets for 4, 3, 2, 1 damage. Ignores defense. Cannot hit the same tile twice.

**Lightning Bolt+** — Legendary / Magic, Attack · ranged · Arcane Charge upgrade
Hit a target on a tile within 8 spaces for 8 damage, then chain to new targets for 7, 6, 5… damage. Ignores defense. Cannot hit the same tile twice.

**Shining Blade** — Uncommon / Magic, Attack · melee
Deal 4–5 damage to everything on the tiles orthogonally adjacent to you.

**Shining Blade+** — Uncommon / Magic, Attack · melee · Arcane Charge upgrade
Deal 6 damage to everything on the tiles orthogonally and diagonally adjacent to you.

**Potion of Harming** — Merchant / Alchemy, Attack · ranged
Select a tile within 5 spaces. Creatures on it take 5 damage. That tile gains a harming cloud for 3 turns. Entering a harming cloud deals 5 damage.

#### Protection / Aid / Skill / Deck
**Parry** — Common / Protection
Gain +3 defense until you take damage (the next attack against you is reduced by 3).

**Shield** — Common / Protection
Gain +5 defense for this turn.

**Flurry of Blows** — Uncommon / Skill
For the rest of this turn, each punch you throw hits twice.

**Haste** — Rare / Skill
For this turn, all player movement from every source is doubled. You cannot play Attack, Protection, Aid, or Deck cards for the rest of this turn.

**Arcane Charge** — Merchant / Magic, Skill
You may only play Magic cards for the rest of this turn. Magic cards in your hand are upgraded for this turn.

**Arcane Charge+** — Merchant / Magic, Skill · Arcane Charge upgrade
Same as Arcane Charge, then draw a card.

**Arcane Shield** — Uncommon / Magic, Aid
Gain 7 Resistance this turn. Resistance absorbs incoming damage (ignoring defense) until depleted.

**Arcane Shield+** — Uncommon / Magic, Aid · Arcane Charge upgrade
Gain 10 Resistance this turn. Resistance absorbs incoming damage (ignoring defense) until depleted.

**Fortify** — Uncommon / Aid · Special
For this turn your defense and resistance is doubled.

**Heal** — Rare / Aid · Special
Heal 10% of your max health. Cannot be played if you have played any cards this turn, and you may not play any cards after this.

**Focus** — Rare / Deck
Draw 2 cards.

**Tactical Approach** — Uncommon / Deck
Draw a card and gain two Bonus Cards.

**Threefold Gift** — Legendary / Deck
Draw 3 cards.

**Dual Wield** — Rare / Deck
Play an Attack, then choose another physical melee Attack from your discard pile and play it immediately.

**Evaluate** — Rare / Deck · Special
Draw a card. Discard any number of cards and draw one for each discarded.

**Bonus Card** — Bonus / Aid
Cannot be played. Discard for Move +1, Punch, or Scout — then this card is destroyed.

The Card pedestal gives you the choice between three cards, and allows you to destroy one card in your deck. There's always one in the stair room and sometimes one in the Treasure Room instead of a chest. Certain items, like the Silver Flame which allows you destroy a card in your deck also exist. Treasure chests can give you choices between three cards like the Card pedestal.

*Defence lowers incoming damage by its amount.

### Dungeon Cards
Source: `src/content/dungeon_cards.json`. Drawn at end of turn after the player discards.

**The Dungeon is Still** — Nothing happens.
**Noisy Adventurer** — Gain 1 noise.
**The Dungeon Knows You're Here** — Gain 2 noise.
**Trap!** — Random damage.
**Falling Rocks** — Rocks may fall into rooms.
**Monsters from the Deep** — Something stirs elsewhere.
**THE DUNGEON IS DEADLIER** — Danger increases; the dungeon deck is reshuffled.
**Stability** — The next dungeon card may not activate (except Deadlier).
**The Dust Settles** — You cannot scout this turn.
**Collapse** — A random room is marked — it collapses at the end of your next turn.
**Lights Out** — Darkness falls for several turns.
**Targeted Collapse** — The squares around you are marked — they collapse at the end of your next turn.
**You Are Not Alone** — (no description in data).
**Overgrowth** — Greenhouses surge with life.
**Flooding** — Water rises in a marked chamber.
**Stalactites Fall** — The ceiling groans — watch your footing.

##BOSSES
Certain items can be found deeper down. Certain Boss Relics can be found, which when activated turn the Gauntlet room into a boss room. Each boss has a their own unique relic, but bosses will be worked on later.

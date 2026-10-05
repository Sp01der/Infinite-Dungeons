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
Card Types: Movement, Attack, Magic Attack, Protection, Aid, Skill, Deck

Cards also have rarity:
Basic / Common / Uncommon / Rare / Legendary / Celestial

###Card List
**Move** — Basic / Movement
Move two spaces.

**Dash** — Rare / Movement
Move 4 spaces.

**Copper Sword** — Basic / Attack
Deal 3-5 damage to an adjacent creature.

**Spear** — Common / Attack
Deal 3-5 damage along a 2-tile line. Choose an adjacent direction. Walls stop the line.

**Axe** — Common / Attack
Deal 4-8 damage to an adjacent creature. Add a Weariness card on top of your deck.

**Broadsword** — Uncommon / Attack
Choose an adjacent direction. Deal 3-6 damage to the three tiles facing that way (the tile directly ahead and the two beside it). Walls are skipped.

**Executioner's Axe** — Uncommon / Attack
Deal 4-8 damage to an adjacent creature. If it dies, this card stays in your hand and you gain a movement token. Otherwise, it is discarded and two Weariness cards are added on top of your deck. Found only in the Catacombs (not offered until that floor exists).

**Ancient Knife** — Rare / Attack
The Knife thirsts for blood… Deal 1-2 damage to an adjacent creature and draw a card. Each kill with this copy adds +2 damage, and the card text updates to show it. Found in Catacombs treasure rooms (not offered until that floor exists).

**Icicle Lance** — Rare / Attack
Deal 3-5 damage along a 3-tile line. Choose an adjacent direction. Walls stop the line. Apply 1 Freezing to each creature hit.

**Mace Smash** — Uncommon / Attack
Deal 6-10 damage to an adjacent creature. Ignores 1 defense. Add two Weariness cards on top of your deck.

**Weariness** — Penalty
Playing this card destroys it. It cannot be discarded for a bonus action.

**Bow** — Common / Attack
Deal 3-4 damage to a target within 8 spaces. Requires line of sight. Cannot hit targets directly adjacent to you.

**Knockback Punch** — Uncommon / Attack
Deal 3-4 damage to an adjacent creature. Counts as a punch for Flurry of Blows and other skills. Knocks the target back 2 spaces.

**Lightning Bolt** — Legendary / Magic Attack
Hit a target within 5 spaces for 5 damage. Then select a new target within 4 spaces of the last target hit for 4 damage, then 3, then 2, then 1. You cannot hit the same target twice. If no valid targets exist within the current radius, the chain ends.

**Fireball** — Uncommon / Magic Attack
Choose a square within 8 spaces (requires line of sight). That square is the center of a 3×3 blast dealing 4-6 damage to everything within the area. Inflicts 1-2 levels of Fire on everything hit.

**Haste** — Rare / Skill
For the rest of this turn, any time you move you may move twice as far (2 becomes 4, 1 becomes 2). You cannot play any Attack, Protection, Aid, or Deck cards for the rest of this turn.

**Shield** — Common / Protection
Gain +5 defense for this turn.

**Stealthy Advance** — Uncommon / Aid
Move 1 space. -1 Noise. Gain +1 defense for this turn.

**Focus** — Common / Deck
Draw 2 cards.

**Loot & Scoot** — Common / Movement
Generate 0-2 gold. Move two spaces. Any pots or chests opened with this movement yield +1 gold.

**Magic Missile** — Uncommon / Magic Attack
Deal 1-6 damage to a target in a straight or diagonal line from you. Ignores defence.

**Careful Descent** — Common / Deck
Skip drawing a dungeon card this turn. -1 Noise.

The Card pesastool gives you the choice between three cards, and allows you to destroy one card in your deck. There's always one in the stair room and sometimes one in the Treasure Room instead of a chest. Certain items, like the Silver Flame which allows you destroy a card in your deck also exist. Treasure chests can give youc choices between three cards like the Card pedastool.

*Defence lowers incoming damage by its amount.

##BOSSES
Certain items can be found deeper down. Certain Boss Relics can be found, which when activated turn the Gauntlet room into a boss room. Each boss has a their own unique relic, but bosses will be worked on later.

# Game art & UI style guide (D167)

All six games share one look: **soft matte clay toys in warm dawn light** (direction A, owner 11/01).
The mascot is the shop logo come to life: a **toast-shaped bunny face** (`public/brand/logo.webp`) — cream
head shaped like a slice of bread with two long ears, two dot eyes, a small "ω" mouth, rosy cheeks,
a cocoa apron. The owner's bread photos stay the heroes inside every game; art frames them.

## Palette (game art only; customer pages keep the globals.css tokens)
| Role | Hex |
| --- | --- |
| Cream (base, panels) | `#F6EEDC` |
| Paper (cards) | `#FFF8EC` |
| Dough (highlights, coins) | `#E7BF7F` / gold `#F2C14E` |
| Terracotta (primary action) | `#C8866C` |
| Cocoa (text on art, outlines of UI) | `#745742` / ink `#3B2A1F` |
| Sage (secondary, success) | `#A6B39A` |
| Berry (danger, low time) | `#D9604A` |

## Shapes
- Everything is rounded and molded: radii ≥ 14 px on cards, pills for buttons, no hard 1 px lines on art.
- Clay depth = a solid darker "base" under the shape (`0 4px 0 <darker>`), plus a soft top highlight; no blurred glows except FX.
- Buttons: primary = terracotta pill with cocoa base, cream text, press = translate 3 px + base shrinks.
  Secondary = cream pill with tan base. Icon buttons = 44 px round cream with base.
- Panels: paper card, 20 px radius, tan base shadow; sheets slide up with a slight overshoot.

## Type
`font-display` (思源黑体 900) for titles and buttons; `font-num` (Fraunces) for every number. Minimal text: one title, one line.

## Motion
- Durations: tap 90 ms, UI 180–260 ms, celebrations 600–900 ms. Easing: `cubic-bezier(.2,.9,.3,1.2)` for pops, ease-out for exits.
- Numbers roll up (score, coins). Rewards fly to their HUD counter. Every success has a sound + small haptic.
- Reduced motion: fades only.

## Screens (every game)
1. **Menu**: full-bleed key art (per game) with the title over the empty top area, a big primary "开始" pill,
   secondary "排行榜", "? 玩法介绍"; prize line on a small paper tag.
2. **Form**: same key art dimmed behind a paper card.
3. **Play**: game-specific board on a clay backdrop; HUD chips (cream pills with an icon + `font-num` value).
4. **Result**: celebration art (bunny cheering / bunny sad-but-cute), big rolling score, stars/crown for records,
   primary "再来一局", secondary "排行榜".
5. **Hub**: hero art header + six illustrated cards (each card = that game's mini key art).

## Asset rules
WebP, transparent where layered, ≤ 160 KB per key art, ≤ 40 KB per icon/sprite. Sources in `assets-src/art/`,
delivered to `public/brand/art/`. No text inside images.

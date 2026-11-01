# Bunbunny Bakes — production clay art

Generated with the built-in image_gen tool on 2026-11-01. Direction A: soft matte clay toys, warm dawn light, limited GAME_ART.md palette. No application code changed.

## Sources and identity

- Style guide: `docs/GAME_ART.md` (this worktree).
- Authoritative face: `public/brand/logo.webp`.
- Approved style references inspected: codex-art0 `assets-src/art-directions/A-clay/{hub,run-menu,td-menu,ui-kit}.png`.
- Existing game references inspected: `public/brand/run3d/preview.png`, `assets-src/td/preview.png`.
- First generation: `sources/hub-hero.png`, referenced the logo and approved A-clay hub. It corrects the earlier round rabbit face to the required toast silhouette.
- Every subsequent generation references that same hero PNG to lock the toast head, ears, dot eyes, omega mouth, cheeks, apron, material and palette. The user-approved A-clay reference supplied style; the new hero is a production identity anchor, not a separate claim of user approval.
- Original selected PNG outputs are preserved in `sources/`. `manifest.json` records exact prompts, generation source paths, target dimensions and alpha requirements. One discarded card-tu draft was replaced to make square tiles explicit.

## Export

Delivered WebPs: `../../public/brand/art/`. PNG sources resized with Pillow Lanczos; opaque scenes fitted to the target aspect ratio, transparent artwork contained with transparent padding. Encoded with `cwebp -q 82 -m 6`; generated alpha preserved. No background removal or drawn substitutes used.

`contact.png` shows all 32 final exports on cream without labels, following this row-major order (six columns):

1. hub-hero, menu-big, menu-tu, menu-m3, menu-grab, menu-run
2. menu-td, card-big, card-tu, card-m3, card-grab, card-run
3. card-td, result-win, result-record, result-lose, icon-coin, icon-star
4. icon-crown, icon-bread, icon-clock, icon-moves, icon-trophy, icon-gift
5. icon-help, icon-sound-on, icon-sound-off, icon-back, icon-pause, bg-kitchen
6. bg-counter, bg-tray

## Exact generation prompts

### hub-hero

Source: `sources/hub-hero.png`; export: 1080 × 720; transparent: false.

Use case: stylized-concept. Create final Bunbunny Bakes hub hero, landscape 1080x720 ratio 3:2. Reference 1 logo is authoritative mascot identity: cream TOAST SLICE shaped head, flat bottom, nearly vertical rounded sides, two upper bread shoulders, two long bunny ears, dark dot eyes, tiny omega mouth and rosy cheeks. Reference 2 approved clay style only: replace its round head with the toast-shaped logo head. Bunny in cocoa apron waving behind a low counter displaying three sculpted breads. Bunny on right half, generous empty cream top-left area for UI title, no title rendered. Soft matte molded clay toys, clean silhouette, warm dawn light from upper left, modest texture, restrained cream #F6EEDC, paper #FFF8EC, dough #E7BF7F, terracotta #C8866C, cocoa #745742, sage #A6B39A. Quiet bakery suggestion, no visual clutter. No text, letters, numbers, watermark, logo printing. No round rabbit head, no fur, no glossy plastic.

### menu-big

Source: `sources/menu-big.png`; export: 1080 × 1200; transparent: false.

Use case: stylized-concept. Production Bunbunny Bakes clay toy art. Reference image is the locked mascot identity and clay material: copy exactly its cream TOAST-SLICE head silhouette with flat bottom, bread shoulders, long ears with cocoa inner ears, dot eyes, small omega mouth, rosy cheeks, small cream body and cocoa apron. Never use round rabbit head. Soft matte molded clay, clean readable silhouettes, warm dawn upper-left illumination. Restrained palette #F6EEDC #FFF8EC #E7BF7F #F2C14E #C8866C #745742 #A6B39A #D9604A. No text, letters, numerals, watermarks, signage or printed logos. Portrait 9:10. Empty cream top 35 percent reserved for title. Below: bunny dropping small breads which visibly converge into one giant golden loaf on bakery counter; a few suspended small buns lead toward giant loaf. Sparse clay bakery.

### menu-tu

Source: `sources/menu-tu.png`; export: 1080 × 1200; transparent: false.

Use case: stylized-concept. Production Bunbunny Bakes clay toy art. Reference image is the locked mascot identity and clay material: copy exactly its cream TOAST-SLICE head silhouette with flat bottom, bread shoulders, long ears with cocoa inner ears, dot eyes, small omega mouth, rosy cheeks, small cream body and cocoa apron. Never use round rabbit head. Soft matte molded clay, clean readable silhouettes, warm dawn upper-left illumination. Restrained palette #F6EEDC #FFF8EC #E7BF7F #F2C14E #C8866C #745742 #A6B39A #D9604A. No text, letters, numerals, watermarks, signage or printed logos. Portrait 9:10. Empty cream top 35 percent. Below: bunny holding open a kraft paper bag catching a neat falling stack of thick rounded bread tiles, each embossed with a bread shape. Sparse bakery.

### menu-m3

Source: `sources/menu-m3.png`; export: 1080 × 1200; transparent: false.

Use case: stylized-concept. Production Bunbunny Bakes clay toy art. Reference image is the locked mascot identity and clay material: copy exactly its cream TOAST-SLICE head silhouette with flat bottom, bread shoulders, long ears with cocoa inner ears, dot eyes, small omega mouth, rosy cheeks, small cream body and cocoa apron. Never use round rabbit head. Soft matte molded clay, clean readable silhouettes, warm dawn upper-left illumination. Restrained palette #F6EEDC #FFF8EC #E7BF7F #F2C14E #C8866C #745742 #A6B39A #D9604A. No text, letters, numerals, watermarks, signage or printed logos. Portrait 9:10. Empty cream top 35 percent. Below: bunny proudly holding a tilted sage baking tray displaying colourful bread tiles in neat rows, muted dough, sage and berry bread shapes. Sparse bakery.

### menu-grab

Source: `sources/menu-grab.png`; export: 1080 × 1200; transparent: false.

Use case: stylized-concept. Production Bunbunny Bakes clay toy art. Reference image is the locked mascot identity and clay material: copy exactly its cream TOAST-SLICE head silhouette with flat bottom, bread shoulders, long ears with cocoa inner ears, dot eyes, small omega mouth, rosy cheeks, small cream body and cocoa apron. Never use round rabbit head. Soft matte molded clay, clean readable silhouettes, warm dawn upper-left illumination. Restrained palette #F6EEDC #FFF8EC #E7BF7F #F2C14E #C8866C #745742 #A6B39A #D9604A. No text, letters, numerals, watermarks, signage or printed logos. Portrait 9:10. Empty cream top 35 percent. Below: bunny using long rounded cocoa tongs reaching toward one fresh golden bun on a plate with gentle warm glow and steam. Clear tongs silhouette. Sparse bakery.

### menu-run

Source: `sources/menu-run.png`; export: 1080 × 1200; transparent: false.

Use case: stylized-concept. Production Bunbunny Bakes clay toy art. Reference image is the locked mascot identity and clay material: copy exactly its cream TOAST-SLICE head silhouette with flat bottom, bread shoulders, long ears with cocoa inner ears, dot eyes, small omega mouth, rosy cheeks, small cream body and cocoa apron. Never use round rabbit head. Soft matte molded clay, clean readable silhouettes, warm dawn upper-left illumination. Restrained palette #F6EEDC #FFF8EC #E7BF7F #F2C14E #C8866C #745742 #A6B39A #D9604A. No text, letters, numerals, watermarks, signage or printed logos. Portrait 9:10. Empty cream dawn sky top 35 percent. Below: bunny running with kraft bread bag in a toy dawn town, a small wooden ramp and sage bread delivery van behind. Terracotta awnings, cream walls, sage trees. Dynamic joyful stride.

### menu-td

Source: `sources/menu-td.png`; export: 1600 × 900; transparent: false.

Use case: stylized-concept. Production Bunbunny Bakes clay toy art. Reference image is the locked mascot identity and clay material: copy exactly its cream TOAST-SLICE head silhouette with flat bottom, bread shoulders, long ears with cocoa inner ears, dot eyes, small omega mouth, rosy cheeks, small cream body and cocoa apron. Never use round rabbit head. Soft matte molded clay, clean readable silhouettes, warm dawn upper-left illumination. Restrained palette #F6EEDC #FFF8EC #E7BF7F #F2C14E #C8866C #745742 #A6B39A #D9604A. No text, letters, numerals, watermarks, signage or printed logos. Landscape 16:9. Empty cream wall upper 35 percent. Below: bunny guarding a sage plate of breads with a rolling pin, two cute small mice and three ants approaching from right along wood counter. Gentle playful defense, no violence.

### result-win

Source: `sources/result-win.png`; export: 800 × 640; transparent: true.

Use case: stylized-concept. Production Bunbunny Bakes clay toy art. Reference image is the locked mascot identity and clay material: copy exactly its cream TOAST-SLICE head silhouette with flat bottom, bread shoulders, long ears with cocoa inner ears, dot eyes, small omega mouth, rosy cheeks, small cream body and cocoa apron. Never use round rabbit head. Soft matte molded clay, clean readable silhouettes, warm dawn upper-left illumination. Restrained palette #F6EEDC #FFF8EC #E7BF7F #F2C14E #C8866C #745742 #A6B39A #D9604A. No text, letters, numerals, watermarks, signage or printed logos. Landscape 5:4 result illustration: bunny jumping with joy holding a golden loaf aloft, a few confetti-like bread crumbs flying around. Entire character and ears visible, centered within 80% canvas, generous transparent padding. Genuine transparent background, no floor or environment.

### result-lose

Source: `sources/result-lose.png`; export: 800 × 640; transparent: true.

Use case: stylized-concept. Production Bunbunny Bakes clay toy art. Reference image is the locked mascot identity and clay material: copy exactly its cream TOAST-SLICE head silhouette with flat bottom, bread shoulders, long ears with cocoa inner ears, dot eyes, small omega mouth, rosy cheeks, small cream body and cocoa apron. Never use round rabbit head. Soft matte molded clay, clean readable silhouettes, warm dawn upper-left illumination. Restrained palette #F6EEDC #FFF8EC #E7BF7F #F2C14E #C8866C #745742 #A6B39A #D9604A. No text, letters, numerals, watermarks, signage or printed logos. Landscape 5:4 result illustration: bunny sitting with slightly lowered ears and a gentle sad-but-cute expression, holding a single small crumb, no tears. Entire character and ears visible, centered within 80% canvas, generous transparent padding. Genuine transparent background, no floor or environment.

### result-record

Source: `sources/result-record.png`; export: 800 × 640; transparent: true.

Use case: stylized-concept. Production Bunbunny Bakes clay toy art. Reference image is the locked mascot identity and clay material: copy exactly its cream TOAST-SLICE head silhouette with flat bottom, bread shoulders, long ears with cocoa inner ears, dot eyes, small omega mouth, rosy cheeks, small cream body and cocoa apron. Never use round rabbit head. Soft matte molded clay, clean readable silhouettes, warm dawn upper-left illumination. Restrained palette #F6EEDC #FFF8EC #E7BF7F #F2C14E #C8866C #745742 #A6B39A #D9604A. No text, letters, numerals, watermarks, signage or printed logos. Landscape 5:4 result illustration: bunny wearing a little golden crown holding a trophy made from a golden loaf on a small cup pedestal. Entire character and ears visible, centered within 80% canvas, generous transparent padding. Genuine transparent background, no floor or environment.

### card-big

Source: `sources/card-big.png`; export: 600 × 600; transparent: true.

Use case: stylized-concept. Production Bunbunny Bakes clay toy art. Reference image is the locked mascot identity and clay material: copy exactly its cream TOAST-SLICE head silhouette with flat bottom, bread shoulders, long ears with cocoa inner ears, dot eyes, small omega mouth, rosy cheeks, small cream body and cocoa apron. Never use round rabbit head. Soft matte molded clay, clean readable silhouettes, warm dawn upper-left illumination. Restrained palette #F6EEDC #FFF8EC #E7BF7F #F2C14E #C8866C #745742 #A6B39A #D9604A. No text, letters, numerals, watermarks, signage or printed logos. Square 1:1 hub card. A small self-contained clay diorama of a giant golden loaf and two little merging buns, bunny dropping one bun. Entire bunny, ears, and all objects visible within central 84% canvas with generous transparent margins, clear at thumbnail size. Genuine transparent background, no environment, no backdrop, no text.

### card-tu

Source: `sources/card-tu.png`; export: 600 × 600; transparent: true.

Use case: stylized-concept. Production Bunbunny Bakes clay toy art. Reference image is the locked mascot identity and clay material: copy exactly its cream TOAST-SLICE head silhouette with flat bottom, bread shoulders, long ears with cocoa inner ears, dot eyes, small omega mouth, rosy cheeks, small cream body and cocoa apron. Never use round rabbit head. Soft matte molded clay, clean readable silhouettes, warm dawn upper-left illumination. Restrained palette #F6EEDC #FFF8EC #E7BF7F #F2C14E #C8866C #745742 #A6B39A #D9604A. No text, letters, numerals, watermarks, signage or printed logos. Square transparent hub card diorama. Bunny holds open a kraft paper bag catching a visibly stacked vertical column of THREE thick rounded SQUARE bread game tiles. Each tile has square toast geometry and a simple bread silhouette embossed on its flat face. Do not replace tiles with round buns or baguettes. Entire bunny and ears visible within central 84% canvas. Simple clear silhouette, genuine alpha transparency, no backdrop.

### card-m3

Source: `sources/card-m3.png`; export: 600 × 600; transparent: true.

Use case: stylized-concept. Production Bunbunny Bakes clay toy art. Reference image is the locked mascot identity and clay material: copy exactly its cream TOAST-SLICE head silhouette with flat bottom, bread shoulders, long ears with cocoa inner ears, dot eyes, small omega mouth, rosy cheeks, small cream body and cocoa apron. Never use round rabbit head. Soft matte molded clay, clean readable silhouettes, warm dawn upper-left illumination. Restrained palette #F6EEDC #FFF8EC #E7BF7F #F2C14E #C8866C #745742 #A6B39A #D9604A. No text, letters, numerals, watermarks, signage or printed logos. Square 1:1 hub card. A small self-contained clay diorama of a sage baking tray with colourful bread tiles arranged in three clear rows, bunny holding tray. Entire bunny, ears, and all objects visible within central 84% canvas with generous transparent margins, clear at thumbnail size. Genuine transparent background, no environment, no backdrop, no text.

### card-grab

Source: `sources/card-grab.png`; export: 600 × 600; transparent: true.

Use case: stylized-concept. Production Bunbunny Bakes clay toy art. Reference image is the locked mascot identity and clay material: copy exactly its cream TOAST-SLICE head silhouette with flat bottom, bread shoulders, long ears with cocoa inner ears, dot eyes, small omega mouth, rosy cheeks, small cream body and cocoa apron. Never use round rabbit head. Soft matte molded clay, clean readable silhouettes, warm dawn upper-left illumination. Restrained palette #F6EEDC #FFF8EC #E7BF7F #F2C14E #C8866C #745742 #A6B39A #D9604A. No text, letters, numerals, watermarks, signage or printed logos. Square 1:1 hub card. A small self-contained clay diorama of long cocoa tongs held by bunny reaching for one fresh golden bun on a small plate. Entire bunny, ears, and all objects visible within central 84% canvas with generous transparent margins, clear at thumbnail size. Genuine transparent background, no environment, no backdrop, no text.

### card-run

Source: `sources/card-run.png`; export: 600 × 600; transparent: true.

Use case: stylized-concept. Production Bunbunny Bakes clay toy art. Reference image is the locked mascot identity and clay material: copy exactly its cream TOAST-SLICE head silhouette with flat bottom, bread shoulders, long ears with cocoa inner ears, dot eyes, small omega mouth, rosy cheeks, small cream body and cocoa apron. Never use round rabbit head. Soft matte molded clay, clean readable silhouettes, warm dawn upper-left illumination. Restrained palette #F6EEDC #FFF8EC #E7BF7F #F2C14E #C8866C #745742 #A6B39A #D9604A. No text, letters, numerals, watermarks, signage or printed logos. Square 1:1 hub card. A small self-contained clay diorama of running bunny holding kraft bread bag, miniature ramp and sage bread van behind on tiny cobblestone diorama base. Entire bunny, ears, and all objects visible within central 84% canvas with generous transparent margins, clear at thumbnail size. Genuine transparent background, no environment, no backdrop, no text.

### card-td

Source: `sources/card-td.png`; export: 600 × 600; transparent: true.

Use case: stylized-concept. Production Bunbunny Bakes clay toy art. Reference image is the locked mascot identity and clay material: copy exactly its cream TOAST-SLICE head silhouette with flat bottom, bread shoulders, long ears with cocoa inner ears, dot eyes, small omega mouth, rosy cheeks, small cream body and cocoa apron. Never use round rabbit head. Soft matte molded clay, clean readable silhouettes, warm dawn upper-left illumination. Restrained palette #F6EEDC #FFF8EC #E7BF7F #F2C14E #C8866C #745742 #A6B39A #D9604A. No text, letters, numerals, watermarks, signage or printed logos. Square 1:1 hub card. A small self-contained clay diorama of bunny guarding a plate of breads with rolling pin, one tiny mouse and two ants approaching on a tiny counter base. Entire bunny, ears, and all objects visible within central 84% canvas with generous transparent margins, clear at thumbnail size. Genuine transparent background, no environment, no backdrop, no text.

### icon-coin

Source: `sources/icon-coin.png`; export: 256 × 256; transparent: true.

Use case: stylized-concept. Production Bunbunny Bakes clay toy art. Reference image is the locked mascot identity and clay material: copy exactly its cream TOAST-SLICE head silhouette with flat bottom, bread shoulders, long ears with cocoa inner ears, dot eyes, small omega mouth, rosy cheeks, small cream body and cocoa apron. Never use round rabbit head. Soft matte molded clay, clean readable silhouettes, warm dawn upper-left illumination. Restrained palette #F6EEDC #FFF8EC #E7BF7F #F2C14E #C8866C #745742 #A6B39A #D9604A. No text, letters, numerals, watermarks, signage or printed logos. Single isolated clay game UI icon: one gold coin with an embossed toast-shaped bunny face and long ears matching reference. Square canvas. Object centered, fills 76% canvas, generous transparent margins. Chunky simple geometry, readable at 32px. Actual transparent background, no environment, no bunny body, no extra decorations.

### icon-star

Source: `sources/icon-star.png`; export: 256 × 256; transparent: true.

Use case: stylized-concept. Production Bunbunny Bakes clay toy art. Reference image is the locked mascot identity and clay material: copy exactly its cream TOAST-SLICE head silhouette with flat bottom, bread shoulders, long ears with cocoa inner ears, dot eyes, small omega mouth, rosy cheeks, small cream body and cocoa apron. Never use round rabbit head. Soft matte molded clay, clean readable silhouettes, warm dawn upper-left illumination. Restrained palette #F6EEDC #FFF8EC #E7BF7F #F2C14E #C8866C #745742 #A6B39A #D9604A. No text, letters, numerals, watermarks, signage or printed logos. Single isolated clay game UI icon: one plump rounded five-point gold star. Square canvas. Object centered, fills 76% canvas, generous transparent margins. Chunky simple geometry, readable at 32px. Actual transparent background, no environment, no bunny body, no extra decorations.

### icon-crown

Source: `sources/icon-crown.png`; export: 256 × 256; transparent: true.

Use case: stylized-concept. Production Bunbunny Bakes clay toy art. Reference image is the locked mascot identity and clay material: copy exactly its cream TOAST-SLICE head silhouette with flat bottom, bread shoulders, long ears with cocoa inner ears, dot eyes, small omega mouth, rosy cheeks, small cream body and cocoa apron. Never use round rabbit head. Soft matte molded clay, clean readable silhouettes, warm dawn upper-left illumination. Restrained palette #F6EEDC #FFF8EC #E7BF7F #F2C14E #C8866C #745742 #A6B39A #D9604A. No text, letters, numerals, watermarks, signage or printed logos. Single isolated clay game UI icon: one little gold crown with three soft rounded tips. Square canvas. Object centered, fills 76% canvas, generous transparent margins. Chunky simple geometry, readable at 32px. Actual transparent background, no environment, no bunny body, no extra decorations.

### icon-bread

Source: `sources/icon-bread.png`; export: 256 × 256; transparent: true.

Use case: stylized-concept. Production Bunbunny Bakes clay toy art. Reference image is the locked mascot identity and clay material: copy exactly its cream TOAST-SLICE head silhouette with flat bottom, bread shoulders, long ears with cocoa inner ears, dot eyes, small omega mouth, rosy cheeks, small cream body and cocoa apron. Never use round rabbit head. Soft matte molded clay, clean readable silhouettes, warm dawn upper-left illumination. Restrained palette #F6EEDC #FFF8EC #E7BF7F #F2C14E #C8866C #745742 #A6B39A #D9604A. No text, letters, numerals, watermarks, signage or printed logos. Single isolated clay game UI icon: one golden scored bread loaf. Square canvas. Object centered, fills 76% canvas, generous transparent margins. Chunky simple geometry, readable at 32px. Actual transparent background, no environment, no bunny body, no extra decorations.

### icon-clock

Source: `sources/icon-clock.png`; export: 256 × 256; transparent: true.

Use case: stylized-concept. Production Bunbunny Bakes clay toy art. Reference image is the locked mascot identity and clay material: copy exactly its cream TOAST-SLICE head silhouette with flat bottom, bread shoulders, long ears with cocoa inner ears, dot eyes, small omega mouth, rosy cheeks, small cream body and cocoa apron. Never use round rabbit head. Soft matte molded clay, clean readable silhouettes, warm dawn upper-left illumination. Restrained palette #F6EEDC #FFF8EC #E7BF7F #F2C14E #C8866C #745742 #A6B39A #D9604A. No text, letters, numerals, watermarks, signage or printed logos. Single isolated clay game UI icon: one cream and sage round clock with two cocoa hands and tiny plain tick marks, absolutely no numerals. Square canvas. Object centered, fills 76% canvas, generous transparent margins. Chunky simple geometry, readable at 32px. Actual transparent background, no environment, no bunny body, no extra decorations.

### icon-moves

Source: `sources/icon-moves.png`; export: 256 × 256; transparent: true.

Use case: stylized-concept. Production Bunbunny Bakes clay toy art. Reference image is the locked mascot identity and clay material: copy exactly its cream TOAST-SLICE head silhouette with flat bottom, bread shoulders, long ears with cocoa inner ears, dot eyes, small omega mouth, rosy cheeks, small cream body and cocoa apron. Never use round rabbit head. Soft matte molded clay, clean readable silhouettes, warm dawn upper-left illumination. Restrained palette #F6EEDC #FFF8EC #E7BF7F #F2C14E #C8866C #745742 #A6B39A #D9604A. No text, letters, numerals, watermarks, signage or printed logos. Single isolated clay game UI icon: two little cream bunny footprint impressions arranged as walking steps on two cocoa sole shapes. Square canvas. Object centered, fills 76% canvas, generous transparent margins. Chunky simple geometry, readable at 32px. Actual transparent background, no environment, no bunny body, no extra decorations.

### icon-trophy

Source: `sources/icon-trophy.png`; export: 256 × 256; transparent: true.

Use case: stylized-concept. Production Bunbunny Bakes clay toy art. Reference image is the locked mascot identity and clay material: copy exactly its cream TOAST-SLICE head silhouette with flat bottom, bread shoulders, long ears with cocoa inner ears, dot eyes, small omega mouth, rosy cheeks, small cream body and cocoa apron. Never use round rabbit head. Soft matte molded clay, clean readable silhouettes, warm dawn upper-left illumination. Restrained palette #F6EEDC #FFF8EC #E7BF7F #F2C14E #C8866C #745742 #A6B39A #D9604A. No text, letters, numerals, watermarks, signage or printed logos. Single isolated clay game UI icon: one gold trophy cup with a miniature bread loaf nestled in it. Square canvas. Object centered, fills 76% canvas, generous transparent margins. Chunky simple geometry, readable at 32px. Actual transparent background, no environment, no bunny body, no extra decorations.

### icon-gift

Source: `sources/icon-gift.png`; export: 256 × 256; transparent: true.

Use case: stylized-concept. Production Bunbunny Bakes clay toy art. Reference image is the locked mascot identity and clay material: copy exactly its cream TOAST-SLICE head silhouette with flat bottom, bread shoulders, long ears with cocoa inner ears, dot eyes, small omega mouth, rosy cheeks, small cream body and cocoa apron. Never use round rabbit head. Soft matte molded clay, clean readable silhouettes, warm dawn upper-left illumination. Restrained palette #F6EEDC #FFF8EC #E7BF7F #F2C14E #C8866C #745742 #A6B39A #D9604A. No text, letters, numerals, watermarks, signage or printed logos. Single isolated clay game UI icon: one cream gift box with terracotta ribbon and rounded bow. Square canvas. Object centered, fills 76% canvas, generous transparent margins. Chunky simple geometry, readable at 32px. Actual transparent background, no environment, no bunny body, no extra decorations.

### icon-help

Source: `sources/icon-help.png`; export: 256 × 256; transparent: true.

Use case: stylized-concept. Production Bunbunny Bakes clay toy art. Reference image is the locked mascot identity and clay material: copy exactly its cream TOAST-SLICE head silhouette with flat bottom, bread shoulders, long ears with cocoa inner ears, dot eyes, small omega mouth, rosy cheeks, small cream body and cocoa apron. Never use round rabbit head. Soft matte molded clay, clean readable silhouettes, warm dawn upper-left illumination. Restrained palette #F6EEDC #FFF8EC #E7BF7F #F2C14E #C8866C #745742 #A6B39A #D9604A. No text, letters, numerals, watermarks, signage or printed logos. Single isolated clay game UI icon: one small open cream recipe book with cocoa cover, blank pages decorated only by a tiny molded bread silhouette; no text, no question mark, no question-shaped swirl. Square canvas. Object centered, fills 76% canvas, generous transparent margins. Chunky simple geometry, readable at 32px. Actual transparent background, no environment, no bunny body, no extra decorations.

### icon-sound-on

Source: `sources/icon-sound-on.png`; export: 256 × 256; transparent: true.

Use case: stylized-concept. Production Bunbunny Bakes clay toy art. Reference image is the locked mascot identity and clay material: copy exactly its cream TOAST-SLICE head silhouette with flat bottom, bread shoulders, long ears with cocoa inner ears, dot eyes, small omega mouth, rosy cheeks, small cream body and cocoa apron. Never use round rabbit head. Soft matte molded clay, clean readable silhouettes, warm dawn upper-left illumination. Restrained palette #F6EEDC #FFF8EC #E7BF7F #F2C14E #C8866C #745742 #A6B39A #D9604A. No text, letters, numerals, watermarks, signage or printed logos. Single isolated clay game UI icon: one sage rounded speaker with two curved raised sound-wave arcs. Square canvas. Object centered, fills 76% canvas, generous transparent margins. Chunky simple geometry, readable at 32px. Actual transparent background, no environment, no bunny body, no extra decorations.

### icon-sound-off

Source: `sources/icon-sound-off.png`; export: 256 × 256; transparent: true.

Use case: stylized-concept. Production Bunbunny Bakes clay toy art. Reference image is the locked mascot identity and clay material: copy exactly its cream TOAST-SLICE head silhouette with flat bottom, bread shoulders, long ears with cocoa inner ears, dot eyes, small omega mouth, rosy cheeks, small cream body and cocoa apron. Never use round rabbit head. Soft matte molded clay, clean readable silhouettes, warm dawn upper-left illumination. Restrained palette #F6EEDC #FFF8EC #E7BF7F #F2C14E #C8866C #745742 #A6B39A #D9604A. No text, letters, numerals, watermarks, signage or printed logos. Single isolated clay game UI icon: one sage rounded speaker with a single diagonal terracotta mute slash, no sound-wave arcs. Square canvas. Object centered, fills 76% canvas, generous transparent margins. Chunky simple geometry, readable at 32px. Actual transparent background, no environment, no bunny body, no extra decorations.

### icon-back

Source: `sources/icon-back.png`; export: 256 × 256; transparent: true.

Use case: stylized-concept. Production Bunbunny Bakes clay toy art. Reference image is the locked mascot identity and clay material: copy exactly its cream TOAST-SLICE head silhouette with flat bottom, bread shoulders, long ears with cocoa inner ears, dot eyes, small omega mouth, rosy cheeks, small cream body and cocoa apron. Never use round rabbit head. Soft matte molded clay, clean readable silhouettes, warm dawn upper-left illumination. Restrained palette #F6EEDC #FFF8EC #E7BF7F #F2C14E #C8866C #745742 #A6B39A #D9604A. No text, letters, numerals, watermarks, signage or printed logos. Single isolated clay game UI icon: one thick rounded terracotta left-pointing arrow. Square canvas. Object centered, fills 76% canvas, generous transparent margins. Chunky simple geometry, readable at 32px. Actual transparent background, no environment, no bunny body, no extra decorations.

### icon-pause

Source: `sources/icon-pause.png`; export: 256 × 256; transparent: true.

Use case: stylized-concept. Production Bunbunny Bakes clay toy art. Reference image is the locked mascot identity and clay material: copy exactly its cream TOAST-SLICE head silhouette with flat bottom, bread shoulders, long ears with cocoa inner ears, dot eyes, small omega mouth, rosy cheeks, small cream body and cocoa apron. Never use round rabbit head. Soft matte molded clay, clean readable silhouettes, warm dawn upper-left illumination. Restrained palette #F6EEDC #FFF8EC #E7BF7F #F2C14E #C8866C #745742 #A6B39A #D9604A. No text, letters, numerals, watermarks, signage or printed logos. Single isolated clay game UI icon: two thick rounded terracotta vertical pause bars. Square canvas. Object centered, fills 76% canvas, generous transparent margins. Chunky simple geometry, readable at 32px. Actual transparent background, no environment, no bunny body, no extra decorations.

### bg-kitchen

Source: `sources/bg-kitchen.png`; export: 1080 × 1920; transparent: false.

Use case: stylized-concept. Production Bunbunny Bakes clay toy art. Reference image is the locked mascot identity and clay material: copy exactly its cream TOAST-SLICE head silhouette with flat bottom, bread shoulders, long ears with cocoa inner ears, dot eyes, small omega mouth, rosy cheeks, small cream body and cocoa apron. Never use round rabbit head. Soft matte molded clay, clean readable silhouettes, warm dawn upper-left illumination. Restrained palette #F6EEDC #FFF8EC #E7BF7F #F2C14E #C8866C #745742 #A6B39A #D9604A. No text, letters, numerals, watermarks, signage or printed logos. Portrait 9:16 full-bleed play-area backdrop, 1080x1920 target. Show a soft blurred bakery interior, cream wall and low sage tiles; barely suggested shelving at extreme edges, center 80% uninterrupted soft cream, no objects in focus. Very low contrast, quiet pale colors so game board remains readable. Match reference material and palette ONLY. No bunny, characters, text, numbers, sharp focal subjects or UI.

### bg-counter

Source: `sources/bg-counter.png`; export: 1080 × 1920; transparent: false.

Use case: stylized-concept. Production Bunbunny Bakes clay toy art. Reference image is the locked mascot identity and clay material: copy exactly its cream TOAST-SLICE head silhouette with flat bottom, bread shoulders, long ears with cocoa inner ears, dot eyes, small omega mouth, rosy cheeks, small cream body and cocoa apron. Never use round rabbit head. Soft matte molded clay, clean readable silhouettes, warm dawn upper-left illumination. Restrained palette #F6EEDC #FFF8EC #E7BF7F #F2C14E #C8866C #745742 #A6B39A #D9604A. No text, letters, numerals, watermarks, signage or printed logos. Portrait 9:16 full-bleed play-area backdrop, 1080x1920 target. Show a light warm wooden bakery counter top seen straight from above, very subtle broad wood grain and faint plank seams, no props, no food, no strong shadows, clean central playing area. Very low contrast, quiet pale colors so game board remains readable. Match reference material and palette ONLY. No bunny, characters, text, numbers, sharp focal subjects or UI.

### bg-tray

Source: `sources/bg-tray.png`; export: 1080 × 1920; transparent: false.

Use case: stylized-concept. Production Bunbunny Bakes clay toy art. Reference image is the locked mascot identity and clay material: copy exactly its cream TOAST-SLICE head silhouette with flat bottom, bread shoulders, long ears with cocoa inner ears, dot eyes, small omega mouth, rosy cheeks, small cream body and cocoa apron. Never use round rabbit head. Soft matte molded clay, clean readable silhouettes, warm dawn upper-left illumination. Restrained palette #F6EEDC #FFF8EC #E7BF7F #F2C14E #C8866C #745742 #A6B39A #D9604A. No text, letters, numerals, watermarks, signage or printed logos. Portrait 9:16 full-bleed play-area backdrop, 1080x1920 target. Show a cream tablecloth seen straight from above, very subtle fabric texture and a little flour dust only at far corners, no tray, no objects, no distinct motifs, uninterrupted clean central playing area. Very low contrast, quiet pale colors so game board remains readable. Match reference material and palette ONLY. No bunny, characters, text, numbers, sharp focal subjects or UI.

## Validation

All 32 exports decode at the requested dimensions. All 22 layered assets retain genuine alpha (transparent and opaque pixels). Key art is below 160 KB each; icons below 40 KB each. Total WebP payload: **1,151,018 bytes (1.15 MB)**, below 2,500,000 bytes. All exports use quality 82. Visual QA used the final contact sheet; no text or numerals appear in the art. Detailed measurements: `validation.json`.


## ART-2 — in-game clay sprites (2026-11-01)

Generated with the built-in image_gen tool, one call per asset. Every call used the same original ART-1 identity anchor, `art-sources-archive/art1-sources/hub-hero.png` (the original of `public/brand/art/hub-hero.webp`). Reference role: mascot identity, clay material, palette and dawn lighting. Inspected existing `public/brand/grab/*.svg`, `public/brand/m3/{roll,big}.svg` and `public/brand/bag.webp`.

Exports: `public/brand/art/game/`, genuine generated transparency preserved, Pillow Lanczos containment into the requested dimensions, `cwebp -q 82 -m 6`. Original PNGs and local manifest are in git-ignored `sources/`. The arm uses a central cross-section of its generated wood, repeated vertically at 20 px wide inside the 32 px canvas, to guarantee a seamless vertical segment. No application code changed.

Aspect-ratio clarification: explicit requested dimensions govern exports. Existing bunny viewBox is 160×140 (8:7); oven and tongs are 120×120 but requested exports are 384×320 and 256×320; arm is 20×100 but requested export is 32×256. Remaining inspected grab sprites are square (sparkle 32×32, others 120×120); m3 specials are 64×64. Existing SVGs remain available.

`contact-2.png` shows all 17 final WebPs on cream without text, row-major, five columns:

1. grab-bunny, grab-oven, grab-tongs, grab-arm, grab-flour
2. grab-butter, grab-clock, grab-sparkle, m3-roll, m3-big
3. tu-bag, tu-peek, tu-bag-plus, tu-swap, td-slot
4. td-plate, tut-finger

### ART-2 exact prompts and source mapping

All prompts below were sent with `transparent_background: true` and the ART-1 hero PNG as the reference.

#### grab-bunny

Source: `sources/grab-bunny.png`; export: `grab-bunny.webp`, 512 × 448.

Use case: stylized-concept. Production Bunbunny Bakes in-game sprite. Reference image is ART-1's locked mascot and material anchor. Match soft matte molded clay toys, rounded simple readable silhouette, warm dawn light from upper left; restrained cream #F6EEDC, paper #FFF8EC, dough #E7BF7F, gold #F2C14E, terracotta #C8866C, cocoa #745742, sage #A6B39A. Actual transparent background, no floor or environment, no cast shadow outside object, no text, letters, numerals, watermark. Do not include bunny unless requested. Single asset only, no sheet. Bunny peeking over an invisible horizontal edge near the bottom of canvas, both paws curled over that edge, head tilted slightly looking DOWN toward gameplay below. Copy reference bunny identically: cream TOAST SLICE head with flat bottom and bread shoulders, two long cocoa-lined ears, cocoa dot eyes, tiny omega mouth, rosy cheeks, cocoa apron glimpse. Head and ears fully visible. No actual counter or ledge, no legs. Landscape 8:7 composition.

#### grab-oven

Source: `sources/grab-oven.png`; export: `grab-oven.webp`, 384 × 320.

Use case: stylized-concept. Production Bunbunny Bakes in-game sprite. Reference image is ART-1's locked mascot and material anchor. Match soft matte molded clay toys, rounded simple readable silhouette, warm dawn light from upper left; restrained cream #F6EEDC, paper #FFF8EC, dough #E7BF7F, gold #F2C14E, terracotta #C8866C, cocoa #745742, sage #A6B39A. Actual transparent background, no floor or environment, no cast shadow outside object, no text, letters, numerals, watermark. Do not include bunny unless requested. Single asset only, no sheet. One small terracotta clay oven, perfectly front view, rounded body and arched opening containing warm golden glow, little cocoa feet and two small cream knobs, no breads outside. Landscape 6:5.

#### grab-tongs

Source: `sources/grab-tongs.png`; export: `grab-tongs.webp`, 256 × 320.

Use case: stylized-concept. Production Bunbunny Bakes in-game sprite. Reference image is ART-1's locked mascot and material anchor. Match soft matte molded clay toys, rounded simple readable silhouette, warm dawn light from upper left; restrained cream #F6EEDC, paper #FFF8EC, dough #E7BF7F, gold #F2C14E, terracotta #C8866C, cocoa #745742, sage #A6B39A. Actual transparent background, no floor or environment, no cast shadow outside object, no text, letters, numerals, watermark. Do not include bunny unless requested. Single asset only, no sheet. One pair of OPEN metal-and-wood bakery tongs pointing vertically DOWN. Pivot at top centre, short wooden cap above joint, two satin metal arms diverging downward with gripping tips curving inward, tips widely separated. Symmetric front view, no food, no hands. Portrait 4:5 composition, pivot aligned x=50%, near top.

#### grab-arm

Source: `sources/grab-arm.png`; export: `grab-arm.webp`, 32 × 256.

Use case: stylized-concept. Production Bunbunny Bakes in-game sprite. Reference image is ART-1's locked mascot and material anchor. Match soft matte molded clay toys, rounded simple readable silhouette, warm dawn light from upper left; restrained cream #F6EEDC, paper #FFF8EC, dough #E7BF7F, gold #F2C14E, terracotta #C8866C, cocoa #745742, sage #A6B39A. Actual transparent background, no floor or environment, no cast shadow outside object, no text, letters, numerals, watermark. Do not include bunny unless requested. Single asset only, no sheet. A thin straight VERTICAL wooden rod segment, uniform cylindrical width, honey cocoa wood sculpted in matte clay style, very subtle straight longitudinal grain. Seamless vertically: rod continues beyond both top and bottom canvas edges, no end caps, no taper, no knot, no joint, constant lighting along length. Transparent strips either side. Very narrow 1:8 silhouette centered, occupies 65 percent width and full height.

#### grab-flour

Source: `sources/grab-flour.png`; export: `grab-flour.webp`, 256 × 256.

Use case: stylized-concept. Production Bunbunny Bakes in-game sprite. Reference image is ART-1's locked mascot and material anchor. Match soft matte molded clay toys, rounded simple readable silhouette, warm dawn light from upper left; restrained cream #F6EEDC, paper #FFF8EC, dough #E7BF7F, gold #F2C14E, terracotta #C8866C, cocoa #745742, sage #A6B39A. Actual transparent background, no floor or environment, no cast shadow outside object, no text, letters, numerals, watermark. Do not include bunny unless requested. Single asset only, no sheet. One plump tied flour sack, cream and dough clay burlap, simple sculpted wheat sprig emblem only, no writing. Front three-quarter view, square canvas, subject fills 86 percent.

#### grab-butter

Source: `sources/grab-butter.png`; export: `grab-butter.webp`, 192 × 192.

Use case: stylized-concept. Production Bunbunny Bakes in-game sprite. Reference image is ART-1's locked mascot and material anchor. Match soft matte molded clay toys, rounded simple readable silhouette, warm dawn light from upper left; restrained cream #F6EEDC, paper #FFF8EC, dough #E7BF7F, gold #F2C14E, terracotta #C8866C, cocoa #745742, sage #A6B39A. Actual transparent background, no floor or environment, no cast shadow outside object, no text, letters, numerals, watermark. Do not include bunny unless requested. Single asset only, no sheet. One golden butter block on a small folded cream paper wrapper. Soft rounded rectangular block, three-quarter view, square canvas, fills 86 percent.

#### grab-clock

Source: `sources/grab-clock.png`; export: `grab-clock.webp`, 192 × 192.

Use case: stylized-concept. Production Bunbunny Bakes in-game sprite. Reference image is ART-1's locked mascot and material anchor. Match soft matte molded clay toys, rounded simple readable silhouette, warm dawn light from upper left; restrained cream #F6EEDC, paper #FFF8EC, dough #E7BF7F, gold #F2C14E, terracotta #C8866C, cocoa #745742, sage #A6B39A. Actual transparent background, no floor or environment, no cast shadow outside object, no text, letters, numerals, watermark. Do not include bunny unless requested. Single asset only, no sheet. One small terracotta twin-bell alarm clock, cream face, cocoa hands and simple dot tick marks only, no numbers. Front view, square canvas, fills 86 percent.

#### grab-sparkle

Source: `sources/grab-sparkle.png`; export: `grab-sparkle.webp`, 128 × 128.

Use case: stylized-concept. Production Bunbunny Bakes in-game sprite. Reference image is ART-1's locked mascot and material anchor. Match soft matte molded clay toys, rounded simple readable silhouette, warm dawn light from upper left; restrained cream #F6EEDC, paper #FFF8EC, dough #E7BF7F, gold #F2C14E, terracotta #C8866C, cocoa #745742, sage #A6B39A. Actual transparent background, no floor or environment, no cast shadow outside object, no text, letters, numerals, watermark. Do not include bunny unless requested. Single asset only, no sheet. One chunky golden four-point sparkle, smooth sculpted clay volume with cream highlight, symmetrical four tapered rounded points, square canvas fills 84 percent. No extra sparkles.

#### m3-roll

Source: `sources/m3-roll.png`; export: `m3-roll.webp`, 256 × 256.

Use case: stylized-concept. Production Bunbunny Bakes in-game sprite. Reference image is ART-1's locked mascot and material anchor. Match soft matte molded clay toys, rounded simple readable silhouette, warm dawn light from upper left; restrained cream #F6EEDC, paper #FFF8EC, dough #E7BF7F, gold #F2C14E, terracotta #C8866C, cocoa #745742, sage #A6B39A. Actual transparent background, no floor or environment, no cast shadow outside object, no text, letters, numerals, watermark. Do not include bunny unless requested. Single asset only, no sheet. One wooden rolling pin, exactly HORIZONTAL left to right, chunky dough-gold barrel and cocoa wooden handles, gentle matte clay volume. Square canvas with entire rolling pin across central horizontal band, fills 90 percent width.

#### m3-big

Source: `sources/m3-big.png`; export: `m3-big.webp`, 256 × 256.

Use case: stylized-concept. Production Bunbunny Bakes in-game sprite. Reference image is ART-1's locked mascot and material anchor. Match soft matte molded clay toys, rounded simple readable silhouette, warm dawn light from upper left; restrained cream #F6EEDC, paper #FFF8EC, dough #E7BF7F, gold #F2C14E, terracotta #C8866C, cocoa #745742, sage #A6B39A. Actual transparent background, no floor or environment, no cast shadow outside object, no text, letters, numerals, watermark. Do not include bunny unless requested. Single asset only, no sheet. One round golden boule bread, three pale scoring cuts, soft matte clay volume, small golden four-point sparkle attached near upper right of loaf. Square canvas fills 86 percent.

#### tu-bag

Source: `sources/tu-bag.png`; export: `tu-bag.webp`, 512 × 512.

Use case: stylized-concept. Production Bunbunny Bakes in-game sprite. Reference image is ART-1's locked mascot and material anchor. Match soft matte molded clay toys, rounded simple readable silhouette, warm dawn light from upper left; restrained cream #F6EEDC, paper #FFF8EC, dough #E7BF7F, gold #F2C14E, terracotta #C8866C, cocoa #745742, sage #A6B39A. Actual transparent background, no floor or environment, no cast shadow outside object, no text, letters, numerals, watermark. Do not include bunny unless requested. Single asset only, no sheet. One OPEN kraft paper bakery bag, front view slightly elevated enough to see dark open mouth, folded side gussets and soft wrinkled clay paper. On front one cocoa stamped illustration of reference bunny face with identical toast head silhouette, long ears, dot eyes, omega mouth; no text. Square canvas, full bag visible fills 88 percent. No handles, no contents.

#### tu-peek

Source: `sources/tu-peek.png`; export: `tu-peek.webp`, 192 × 192.

Use case: stylized-concept. Production Bunbunny Bakes in-game sprite. Reference image is ART-1's locked mascot and material anchor. Match soft matte molded clay toys, rounded simple readable silhouette, warm dawn light from upper left; restrained cream #F6EEDC, paper #FFF8EC, dough #E7BF7F, gold #F2C14E, terracotta #C8866C, cocoa #745742, sage #A6B39A. Actual transparent background, no floor or environment, no cast shadow outside object, no text, letters, numerals, watermark. Do not include bunny unless requested. Single asset only, no sheet. One magnifying glass MADE OF DOUGH, thick golden baked dough ring, cream translucent lens and cocoa dough handle angled lower-right. Square canvas fills 86 percent. No bunny.

#### tu-bag-plus

Source: `sources/tu-bag-plus.png`; export: `tu-bag-plus.webp`, 192 × 192.

Use case: stylized-concept. Production Bunbunny Bakes in-game sprite. Reference image is ART-1's locked mascot and material anchor. Match soft matte molded clay toys, rounded simple readable silhouette, warm dawn light from upper left; restrained cream #F6EEDC, paper #FFF8EC, dough #E7BF7F, gold #F2C14E, terracotta #C8866C, cocoa #745742, sage #A6B39A. Actual transparent background, no floor or environment, no cast shadow outside object, no text, letters, numerals, watermark. Do not include bunny unless requested. Single asset only, no sheet. One small open kraft paper bag with a chunky PLUS SHAPE made from two crossed short dough rolls attached at its lower right. The plus is a physical sculpted dough object, never a printed text character. No lettering. Square canvas fills 86 percent.

#### tu-swap

Source: `sources/tu-swap.png`; export: `tu-swap.webp`, 192 × 192.

Use case: stylized-concept. Production Bunbunny Bakes in-game sprite. Reference image is ART-1's locked mascot and material anchor. Match soft matte molded clay toys, rounded simple readable silhouette, warm dawn light from upper left; restrained cream #F6EEDC, paper #FFF8EC, dough #E7BF7F, gold #F2C14E, terracotta #C8866C, cocoa #745742, sage #A6B39A. Actual transparent background, no floor or environment, no cast shadow outside object, no text, letters, numerals, watermark. Do not include bunny unless requested. Single asset only, no sheet. Two overlapping rounded cream bakery order cards, each bearing only one simple embossed bread pictogram, with a thick curved terracotta clay arrow curling from one card toward the other. No writing or lines resembling text. Square canvas fills 86 percent.

#### td-slot

Source: `sources/td-slot.png`; export: `td-slot.webp`, 256 × 256.

Use case: stylized-concept. Production Bunbunny Bakes in-game sprite. Reference image is ART-1's locked mascot and material anchor. Match soft matte molded clay toys, rounded simple readable silhouette, warm dawn light from upper left; restrained cream #F6EEDC, paper #FFF8EC, dough #E7BF7F, gold #F2C14E, terracotta #C8866C, cocoa #745742, sage #A6B39A. Actual transparent background, no floor or environment, no cast shadow outside object, no text, letters, numerals, watermark. Do not include bunny unless requested. Single asset only, no sheet. One round low clay build pad, sage upper disc with thick cocoa-tan base rim. Seen from three-quarter top-down view, round pad projects as an ellipse. Empty flat center, no symbol or object on it. Square canvas fills 88 percent width.

#### td-plate

Source: `sources/td-plate.png`; export: `td-plate.webp`, 512 × 320.

Use case: stylized-concept. Production Bunbunny Bakes in-game sprite. Reference image is ART-1's locked mascot and material anchor. Match soft matte molded clay toys, rounded simple readable silhouette, warm dawn light from upper left; restrained cream #F6EEDC, paper #FFF8EC, dough #E7BF7F, gold #F2C14E, terracotta #C8866C, cocoa #745742, sage #A6B39A. Actual transparent background, no floor or environment, no cast shadow outside object, no text, letters, numerals, watermark. Do not include bunny unless requested. Single asset only, no sheet. One empty white ceramic plate, matte soft clay styling, broad oval projection of a round plate viewed from three-quarter top. Cream-white raised rim, empty shallow center, no food, no pattern. Landscape 8:5 canvas fills 90 percent width.

#### tut-finger

Source: `sources/tut-finger.png`; export: `tut-finger.webp`, 192 × 192.

Use case: stylized-concept. Production Bunbunny Bakes in-game sprite. Reference image is ART-1's locked mascot and material anchor. Match soft matte molded clay toys, rounded simple readable silhouette, warm dawn light from upper left; restrained cream #F6EEDC, paper #FFF8EC, dough #E7BF7F, gold #F2C14E, terracotta #C8866C, cocoa #745742, sage #A6B39A. Actual transparent background, no floor or environment, no cast shadow outside object, no text, letters, numerals, watermark. Do not include bunny unless requested. Single asset only, no sheet. One cream CLAY BUNNY PAW in pointing/tapping gesture, one rounded extended digit pointing down-left, other digits tucked into round paw, short wrist angled from upper-right. Cute minimal paw anatomy, no human fingernails, no arm or body, no motion lines. Square canvas fills 84 percent.


### ART-2 validation

All 17 final WebPs decode at the explicitly requested dimensions and retain transparent and opaque pixels. Total game folder payload: **170,264 bytes (170.3 KB)**, below 800,000 bytes; each sprite is below 40,000 bytes. Sixteen sprites use lossy quality 82; the 98-byte arm uses `cwebp -lossless -q 82 -m 6` so decoded top and bottom pixel rows match exactly. Final contact sheet visually reviewed for style, silhouettes, no lettering, tongs direction and empty plate. Generated originals remain ignored under `sources/`; no code or commits changed.

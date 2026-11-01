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

/** Pack 2x Blender renders into the runner's version-3 atlas contract; offline QA. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const sharp = createRequire(import.meta.url)('sharp');

const root = dirname(fileURLToPath(import.meta.url));
const out = resolve(root, '../../public/brand/td');
const cache = resolve(root, '.cache');
const expected = Object.fromEntries([
  ...['pin', 'sifter', 'whisk', 'oven', 'freezer', 'piping', 'torch'].flatMap(k => [0, 1, 2].map(t => [`tower-${k}-${t}`, 1])),
  ...['ant', 'mouse', 'sparrow', 'beetle', 'boss'].map(k => [`pest-${k}`, 6]),
  ...['pin', 'whisk', 'oven'].map(k => [`proj-${k}`, 1]),
  ...['hit', 'bomb', 'freeze', 'slide'].map(k => [`fx-${k}`, 4]), ['slot', 1],
]);
const specs = JSON.parse(await readFile(resolve(cache, 'renders.json'), 'utf8'));
assert.deepEqual(specs.map(s => s.id).sort(), Object.keys(expected).sort(), 'Render the complete asset set');
await mkdir(out, { recursive: true });
const manifest = {
  version: 3, baseUrl: '/brand/td/', pixelRatio: 2, colorSpace: 'srgb',
  renderer: specs[0].renderer,
  camera: { projection: 'orthographic', azimuthDegrees: 0, elevationDegrees: 55,
    forwardAxis: '+X', screenRightAxis: '+X' },
  coordinates: { origin: 'top-left', units: 'source pixels',
    anchor: 'projected ground origin; fixed throughout each animation',
    draw: 'drawImage(sheet, ...rect, x-anchor[0]*scale, y-anchor[1]*scale, frameWidth*scale, frameHeight*scale)',
    scale: 'Source frames are twice the original TD resolution. Use half the previous draw scale for equal display size, or 0.7 times the previous scale for 40% larger actors; slot is unchanged.' },
  assets: {},
};
const thumbs = new Map();
const results = [];
const motionChecks = {};
const solidAreas = {};
for (const [id, count] of Object.entries(expected)) {
  const spec = specs.find(s => s.id === id);
  assert.equal(spec.frameCount, count);
  assert.equal(spec.frames.length, count);
  assert.equal(spec.supersample, 2);
  assert.deepEqual(spec.renderer, manifest.renderer, 'Use consistent renderer/samples for every asset');
  const [width, height] = spec.frameSize;
  assert.equal(spec.artRevision, 'D-ART2-clay-1', `Stale art: ${id}`);
  const expectedSize = id.startsWith('tower-') ? [256, 288] : id.startsWith('pest-') ? [224, 224]
    : id.startsWith('proj-') ? [128, 128] : id.startsWith('fx-') ? [160, 160] : [80, 80];
  assert.deepEqual(spec.frameSize, expectedSize, `${id} frame dimensions`);
  assert.equal(spec.fps, id.startsWith('pest-') ? (id === 'pest-sparrow' ? 12 : 10) : id.startsWith('fx-') ? 16 : 0);
  assert.equal(spec.loop, id.startsWith('pest-'));
  assert.equal(spec.pixelsPerMetre, id === 'slot' ? 56 : 112);
  const layers = [], frames = [], hashes = new Set();
  const columns = count;
  const rows = Math.ceil(count/columns);
  for (let i = 0; i < count; i++) {
    const frame = spec.frames[i];
    const file = resolve(cache, frame.file);
    const meta = await sharp(file).metadata();
    assert.deepEqual([meta.width, meta.height], [width*2, height*2], `${id} must render at 2x`);
    const { data, info } = await sharp(file).ensureAlpha()
      .resize(width, height, { kernel: sharp.kernel.lanczos3 }).raw().toBuffer({ resolveWithObject: true });
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const a = data[(y*width+x)*4+3];
      if (a > 8) {
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      }
    }
    assert.ok(maxX >= minX && maxY >= minY, `Empty frame: ${frame.file}`);
    assert.ok(minX > 1 && minY > 1 && maxX < width-2 && maxY < height-2,
      `Clipped sprite/shadow: ${frame.file} ${[minX, minY, maxX, maxY]}`);
    assert.equal(frame.anchor.length, 2);
    assert.ok(frame.anchor.every(Number.isFinite));
    assert.ok(frame.anchor[0] >= 0 && frame.anchor[0] <= width && frame.anchor[1] >= 0 && frame.anchor[1] <= height);
    assert.deepEqual(frame.anchor, spec.frames[0].anchor, `${id} anchor must not wobble`);
    hashes.add(createHash('sha256').update(data).digest('hex'));
    const input = await sharp(data, { raw: info }).png().toBuffer();
    const x = i % columns*width, y = Math.floor(i/columns)*height;
    layers.push({ input, left: x, top: y });
    frames.push({ rect: [x, y, width, height], anchor: frame.anchor,
      contentBounds: [minX, minY, maxX-minX+1, maxY-minY+1] });
  }
  assert.equal(hashes.size, count, `Duplicate animation frames: ${id}`);
  const file = `${id}.webp`;
  await sharp({ create: { width: columns*width, height: rows*height,
    channels: 4, background: '#00000000' } }).composite(layers)
    .webp({ quality: 90, alphaQuality: 100, effort: 6 }).toFile(resolve(out, file));
  const decoded = await sharp(resolve(out, file)).metadata();
  assert.deepEqual([decoded.width, decoded.height], [columns*width, rows*height]);
  assert.equal(decoded.format, 'webp');
  // Inspect the actual decoded atlas, not only the pristine render inputs.
  const decodedFrames = [];
  // Preview the shipped WebP, including the effects of lossy compression.
  for (let i = 0; i < count; i++) {
    const [left, top, w, h] = frames[i].rect;
    const crop = await sharp(resolve(out, file)).extract({ left, top, width: w, height: h }).png().toBuffer();
    thumbs.set(`${id}:${i}`, crop);
    const raw = await sharp(crop).ensureAlpha().raw().toBuffer();
    decodedFrames.push(raw);
    let solidArea = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const alpha = raw[(y*w+x)*4+3];
      if (alpha > 200) solidArea++;
      if (x < 2 || y < 2 || x >= w-2 || y >= h-2) assert.ok(alpha <= 8, `${id}:${i} decoded edge clipping`);
    }
    if (i === 0) solidAreas[id] = solidArea;
  }
  assert.equal(new Set(decodedFrames.map(raw => createHash('sha256').update(raw).digest('hex'))).size, count, `${id} decoded poses must be unique`);
  if (count > 1) {
    // A visible silhouette or colour change is required, not just a different PNG hash.
    const changes = [];
    for (let i = 0; i < count-(spec.loop ? 0 : 1); i++) {
      const a = decodedFrames[i], b = decodedFrames[(i+1)%count];
      let changed = 0;
      for (let p = 0; p < a.length; p += 4) {
        const silhouette = (a[p+3] > 96) !== (b[p+3] > 96);
        const colour = Math.min(a[p+3], b[p+3]) > 128 &&
          Math.abs(a[p]-b[p])+Math.abs(a[p+1]-b[p+1])+Math.abs(a[p+2]-b[p+2]) > 75;
        if (silhouette || colour) changed++;
      }
      const fraction = changed/(width*height);
      assert.ok(fraction > .0025, `${id} poses ${i} and ${(i+1)%count} lack visible motion: ${fraction}`);
      changes.push(Number(fraction.toFixed(4)));
    }
    motionChecks[id] = changes;
  }
  const bytes = (await stat(resolve(out, file))).size;
  manifest.assets[id] = { file, frameSize: spec.frameSize, frameCount: count, columns, rows,
    pixelsPerMetre: spec.pixelsPerMetre, fps: spec.fps, loop: spec.loop,
    anchor: frames[0].anchor, frames, bytes,
    ...(spec.facing ? { facing: spec.facing } : {}) };
  results.push(`${id}: ${count} frames, ${bytes} bytes`);
}
assert.ok(solidAreas['pest-boss'] > solidAreas['pest-mouse']*1.3, 'Boss must be visibly larger than mouse');
await writeFile(resolve(out, 'manifest.json'), JSON.stringify(manifest, null, 2)+'\n');
const files = await readdir(out);
assert.deepEqual(files.sort(), ['manifest.json', ...Object.keys(expected).map(id => `${id}.webp`)].sort());
const total = (await Promise.all(files.map(async file => (await stat(resolve(out, file))).size))).reduce((a, b) => a+b, 0);
assert.ok(total <= 1_600_000, `Public budget exceeded: ${total} bytes`);
// Required runner fields retain their names, types and frame rectangle semantics.
const runner = JSON.parse(await readFile(resolve(root, '../../public/brand/run/manifest.json'), 'utf8'));
for (const key of ['version', 'baseUrl', 'pixelRatio', 'colorSpace', 'renderer', 'camera', 'coordinates', 'assets']) {
  assert.equal(typeof manifest[key], typeof runner[key]);
}
const runnerAsset = runner.assets['bunny-run'];
for (const asset of Object.values(manifest.assets)) {
  for (const key of Object.keys(runnerAsset)) assert.equal(typeof asset[key], typeof runnerAsset[key], key);
  for (const frame of asset.frames) assert.deepEqual(Object.keys(frame).sort(), Object.keys(runnerAsset.frames[0]).sort());
}

// Review only decoded shipped WebPs: all tiers, all poses, plus 60px phone samples.
const W = 1560, H = 2400, review = [];
function label(text, x, y, size=18, color='#66523f') {
  review.push({ input: Buffer.from(`<svg width="${W}" height="${H}"><text x="${x}" y="${y}" fill="${color}" font-family="sans-serif" font-size="${size}">${text}</text></svg>`), left: 0, top: 0 });
}
async function thumb(id, frame, x, y, width, height) {
  review.push({ input: await sharp(thumbs.get(`${id}:${frame}`)).resize(width, height,
    { fit: 'contain', background: '#00000000' }).png().toBuffer(), left: x, top: y });
}
label('BUNBUNNY / CLAY BAKERY DEFENSE', 32, 48, 32);
label('D-ART2 · 2× source frames · rounded clay geometry · warm key + cool rim · decoded WebP review', 32, 82, 18);
label('TOWERS / all 21 tiers · large inspection + 60 px phone-size frames', 32, 126, 22);
for (const [i, kind] of ['pin', 'sifter', 'whisk', 'oven', 'freezer', 'piping', 'torch'].entries()) {
  const x = 32+(i%3)*510, y = 155+Math.floor(i/3)*262;
  label(kind.toUpperCase(), x, y+18, 18);
  for (let tier = 0; tier < 3; tier++) {
    const tx = x+tier*155;
    await thumb(`tower-${kind}-${tier}`, 0, tx, y+27, 128, 144);
    await thumb(`tower-${kind}-${tier}`, 0, tx+35, y+176, 60, 68);
    label(`${tier}`, tx+136, y+130, 14);
  }
}
label('PROJECTILES / 128 × 128', 550, 700, 18);
for (const [i, kind] of ['pin', 'whisk', 'oven'].entries()) {
  await thumb(`proj-${kind}`, 0, 550+i*142, 725, 120, 120);
  label(kind, 580+i*142, 875, 16);
}
await thumb('slot', 0, 1100, 730, 120, 120);
label('Placement pad / retained', 1060, 875, 16);
label('Board contrast / 60 px', 1280, 700, 17);
for (const [i, background] of ['#e4cfb0', '#a6b39a', '#745742'].entries()) {
  const y = 710+i*75;
  review.push({ input: await sharp({ create: { width: 180, height: 70, channels: 4, background } }).png().toBuffer(), left: 1280, top: y });
  await thumb('tower-freezer-2', 0, 1280, y+1, 60, 68);
  await thumb('tower-oven-2', 0, 1340, y+1, 60, 68);
  await thumb('pest-boss', 0, 1400, y+5, 60, 60);
}
label('PESTS / six unique poses · right-facing · fixed ground anchor · large + 60 px frames', 32, 970, 22);
for (const [row, kind] of ['ant', 'mouse', 'sparrow', 'beetle', 'boss'].entries()) {
  const y = 990+row*192;
  label(kind.toUpperCase(), 32, y+72, 18);
  for (let frame = 0; frame < 6; frame++) {
    const x = 200+frame*211;
    await thumb(`pest-${kind}`, frame, x, y, 128, 128);
    await thumb(`pest-${kind}`, frame, x+34, y+127, 60, 60);
  }
}
label('ITEM FX / four frames each · 160 × 160 · 16 fps · play once', 32, 1994, 22);
for (const [row, kind] of ['hit', 'bomb', 'freeze', 'slide'].entries()) {
  const x = 32+(row%2)*770, y = 2020+Math.floor(row/2)*150;
  label(kind.toUpperCase(), x, y+56, 18);
  for (let frame = 0; frame < 4; frame++) await thumb(`fx-${kind}`, frame, x+120+frame*146, y, 128, 128);
}
label(`${Object.keys(expected).length} atlases · ${Object.values(expected).reduce((a, b) => a+b, 0)} frames · ${total.toLocaleString('en-US')} / 1,600,000 bytes · maps drawn by frontend`, 32, 2368, 22);
await sharp({ create: { width: W, height: H, channels: 4, background: '#f4ebdd' } })
  .composite(review).png().toFile(resolve(root, 'preview.png'));
await writeFile(resolve(root, 'validation.json'), JSON.stringify({
  motionChangedPixelFractions: motionChecks, bossToMouseSolidArea: Number((solidAreas['pest-boss']/solidAreas['pest-mouse']).toFixed(3)),
  revision: 'D-ART2', atlases: Object.keys(expected).length,
  frames: Object.values(expected).reduce((a, b) => a+b, 0), publicBytes: total, budgetBytes: 1_600_000,
  checks: ['version-3 runner schema', 'complete ID set', 'requested frame sizes', '2x render inputs',
    'consistent renderer', 'animation timing', 'fixed anchors', 'nonempty unclipped alpha',
    'unique animation poses', 'visible adjacent-frame motion including loop seam', 'boss larger than mouse', 'WebP decode and atlas rectangles', 'no unexpected public files', 'directory size budget'],
}, null, 2)+'\n');
console.log(results.join('\n'));
console.log(`PASS: schema, frame sizes, alpha margins, unique poses, fixed anchors, WebP decode, budget ${total}/1600000 bytes.`);

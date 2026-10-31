/** Pack 2x Blender renders into the runner's version-3 atlas contract; offline QA. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = dirname(fileURLToPath(import.meta.url));
const out = resolve(root, '../../public/brand/td');
const cache = resolve(root, '.cache');
const expected = Object.fromEntries([
  ...[1, 2, 3].map(n => [`map-${n}`, 1]),
  ...['pin', 'sifter', 'whisk', 'oven'].flatMap(k => [0, 1, 2].map(t => [`tower-${k}-${t}`, 1])),
  ...['ant', 'mouse', 'sparrow', 'beetle', 'boss'].map(k => [`pest-${k}`, 4]),
  ...['pin', 'whisk', 'oven'].map(k => [`proj-${k}`, 1]),
  ['fx-hit', 4], ['slot', 1],
]);
const specs = JSON.parse(await readFile(resolve(cache, 'renders.json'), 'utf8'));
assert.deepEqual(specs.map(s => s.id).sort(), Object.keys(expected).sort(), 'Render the complete asset set');
const source = await readFile(resolve(root, '../../src/lib/td/maps.ts'), 'utf8');
const slotRadius = Number((await readFile(resolve(root, '../../src/lib/td/types.ts'), 'utf8')).match(/TD_SLOT_RADIUS = (\d+)/)[1]);
const sourceHash = createHash('sha256').update(source).digest('hex');
const maps = [...source.matchAll(/map\("([^"]+)",\s*(\[\[.*?\]\]),\s*(\[\[.*?\]\])\)/gs)]
  .map(([, name, path, slots]) => ({ name, path: JSON.parse(path), slots: JSON.parse(slots) }));
assert.equal(maps.length, 3);
await mkdir(out, { recursive: true });
const manifest = {
  version: 3, baseUrl: '/brand/td/', pixelRatio: 2, colorSpace: 'srgb',
  renderer: specs[0].renderer,
  camera: { projection: 'orthographic', azimuthDegrees: 0, elevationDegrees: 55,
    forwardAxis: '+X', screenRightAxis: '+X' },
  coordinates: { origin: 'top-left', units: 'source pixels',
    anchor: 'projected ground origin; maps use top-left [0, 0]',
    draw: 'drawImage(sheet, ...rect, x-anchor[0]*scale, y-anchor[1]*scale, frameWidth*scale, frameHeight*scale)',
    scale: '0.5 gives nominal CSS size at 2x; maps are 720x1080 logical pixels; use the same board scale for all art' },
  assets: {},
};
const thumbs = new Map();
const results = [];
for (const [id, count] of Object.entries(expected)) {
  const spec = specs.find(s => s.id === id);
  const isMap = id.startsWith('map-');
  assert.equal(spec.frameCount, count);
  assert.equal(spec.frames.length, count);
  assert.equal(spec.supersample, 2);
  assert.deepEqual(spec.renderer, manifest.renderer, 'Use consistent renderer/samples for every asset');
  const [width, height] = spec.frameSize;
  if (isMap) {
    assert.deepEqual([width, height], [720, 1080]);
    const data = maps[Number(id.slice(4))-1];
    assert.equal(spec.map.slotRadius, slotRadius);
    assert.equal(spec.map.sha256, sourceHash, `Stale map data: rerender ${id}`);
    for (const key of ['name', 'path', 'slots']) assert.deepEqual(spec.map[key], data[key]);
    for (const [key, points] of [['Path', data.path], ['Slots', data.slots]]) {
      assert.equal(spec.map[`projected${key}`].length, points.length);
      points.forEach(([x, y], i) => {
        const [px, py] = spec.map[`projected${key}`][i];
        assert.ok(Math.hypot(x-px, y-py) < .01, `${id} ${key}[${i}] projection mismatch`);
      });
    }
  }
  const layers = [], frames = [], hashes = new Set();
  const columns = Math.min(count, Math.floor(2048/width));
  const rows = Math.ceil(count/columns);
  for (let i = 0; i < count; i++) {
    const frame = spec.frames[i];
    const file = resolve(cache, frame.file);
    const meta = await sharp(file).metadata();
    assert.deepEqual([meta.width, meta.height], [width*2, height*2], `${id} must render at 2x`);
    const { data, info } = await sharp(file).ensureAlpha()
      .resize(width, height, { kernel: sharp.kernel.lanczos3 }).raw().toBuffer({ resolveWithObject: true });
    let minX = width, minY = height, maxX = -1, maxY = -1;
    let solid = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const a = data[(y*width+x)*4+3];
      if (a > 8) {
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      }
      if (a === 255) solid++;
    }
    assert.ok(maxX >= minX && maxY >= minY, `Empty frame: ${frame.file}`);
    if (isMap) assert.equal(solid, width*height, 'Map must be fully opaque');
    else assert.ok(minX > 1 && minY > 1 && maxX < width-2 && maxY < height-2,
      `Clipped sprite/shadow: ${frame.file} ${[minX, minY, maxX, maxY]}`);
    assert.ok(frame.anchor.every(Number.isFinite));
    assert.ok(frame.anchor[0] >= 0 && frame.anchor[0] <= width && frame.anchor[1] >= 0 && frame.anchor[1] <= height);
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
  // Preview the shipped WebP, including the effects of lossy compression.
  for (let i = 0; i < count; i++) {
    const [left, top, w, h] = frames[i].rect;
    thumbs.set(`${id}:${i}`, await sharp(resolve(out, file)).extract({ left, top, width: w, height: h }).png().toBuffer());
  }
  const bytes = (await stat(resolve(out, file))).size;
  manifest.assets[id] = { file, frameSize: spec.frameSize, frameCount: count, columns, rows,
    pixelsPerMetre: spec.pixelsPerMetre, fps: spec.fps, loop: spec.loop,
    anchor: frames[0].anchor, frames, bytes,
    ...(spec.map ? { map: spec.map } : {}), ...(spec.facing ? { facing: spec.facing } : {}) };
  results.push(`${id}: ${count} frames, ${bytes} bytes`);
}
await writeFile(resolve(out, 'manifest.json'), JSON.stringify(manifest, null, 2)+'\n');
const files = await readdir(out);
assert.deepEqual(files.sort(), ['manifest.json', ...Object.keys(expected).map(id => `${id}.webp`)].sort());
const total = (await Promise.all(files.map(async file => (await stat(resolve(out, file))).size))).reduce((a, b) => a+b, 0);
assert.ok(total <= 1_500_000, `Public budget exceeded: ${total} bytes`);
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

// Offline contact sheet: all poses, tower tiers at 56px, clean maps and alignment inset.
const W = 1500, H = 1760, review = [];
function label(text, x, y, size=19, color='#66523f') {
  review.push({ input: Buffer.from(`<svg width="${W}" height="${H}"><text x="${x}" y="${y}" fill="${color}" font-family="sans-serif" font-size="${size}">${text}</text></svg>`), left: 0, top: 0 });
}
async function thumb(id, frame, x, y, width, height) {
  review.push({ input: await sharp(thumbs.get(`${id}:${frame}`)).resize(width, height,
    { fit: 'contain', background: '#00000000' }).png().toBuffer(), left: x, top: y });
}
label('BUNBUNNY / BAKERY DEFENSE', 32, 46, 30);
label('D5 · Blender clay · 55° camera · 2x render + Lanczos · decoded WebP review', 32, 80, 18);
for (let i = 0; i < 3; i++) {
  const x = 32+i*490;
  label(['01 / MAPLE KITCHEN COUNTER', '02 / TILED BAKERY SHOP', '03 / BACK HERB GARDEN'][i], x, 116, 18);
  await thumb(`map-${i+1}`, 0, x, 134, 456, 684);
  // A small exact overlay verifies route centerlines and all seven slot positions.
  const data = maps[i];
  const sx = 142/720, sy = 213/1080;
  const overlay = `<svg width="142" height="213"><polyline points="${data.path.map(([px, py]) => `${px*sx},${py*sy}`).join(' ')}" fill="none" stroke="#d13c52" stroke-width="1.4"/>${data.slots.map(([px, py]) => `<circle cx="${px*sx}" cy="${py*sy}" r="${slotRadius*sx}" fill="none" stroke="#26636b" stroke-width="1"/>`).join('')}</svg>`;
  const small = await sharp(thumbs.get(`map-${i+1}:0`)).resize(142, 213).composite([{ input: Buffer.from(overlay) }]).png().toBuffer();
  review.push({ input: small, left: x+310, top: 836 });
  label('Exact route + slots', x+310, 1070, 14);
}
label('TOWERS / TIERS 0 · 1 · 2', 32, 858, 21);
for (const [row, kind] of ['pin', 'sifter', 'whisk', 'oven'].entries()) {
  const x = 32+(row % 3)*490, y = row < 3 ? 888 : 1106;
  label(kind.toUpperCase(), x, y+13, 16);
  for (let tier = 0; tier < 3; tier++) {
    await thumb(`tower-${kind}-${tier}`, 0, x+tier*96, y+26, 88, 99);
    await thumb(`tower-${kind}-${tier}`, 0, x+tier*96+16, y+133, 56, 63);
  }
}
label('PESTS / FOUR FRAMES / FACE RIGHT; ROTATE ABOUT ANCHOR', 522, 1119, 18);
for (const [row, kind] of ['ant', 'mouse', 'sparrow', 'beetle', 'boss'].entries()) {
  const y = 1142+row*99;
  label(kind, 524, y+42, 16);
  for (let frame = 0; frame < 4; frame++) await thumb(`pest-${kind}`, frame, 625+frame*114, y, 95, 95);
}
label('PROJECTILES / PIN · WHISK · OVEN', 32, 1362, 18);
for (const [i, kind] of ['pin', 'whisk', 'oven'].entries()) await thumb(`proj-${kind}`, 0, 32+i*90, 1374, 80, 80);
label('HIT PUFF / 16 FPS / ONCE', 32, 1486, 17);
for (let frame = 0; frame < 4; frame++) await thumb('fx-hit', frame, 32+frame*74, 1498, 68, 68);
await thumb('slot', 0, 1140, 1210, 100, 100);
label('Slot / quiet pad', 1110, 1332, 16);
label(`${Object.keys(expected).length} atlases · ${Object.values(expected).reduce((a, b) => a+b, 0)} frames · ${total.toLocaleString('en-US')} / 1,500,000 bytes`, 32, 1722, 22);
await sharp({ create: { width: W, height: H, channels: 4, background: '#f4ebdd' } })
  .composite(review).png().toFile(resolve(root, 'preview.png'));
console.log(results.join('\n'));
console.log(`PASS: runner schema, all frames, alpha margins, unique poses, exact map projection, fresh map source, WebP decode, budget ${total}/1500000 bytes.`);

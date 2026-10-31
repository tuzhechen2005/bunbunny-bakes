/** Pack Blender PNGs, enforce the public budget, and build an unshipped review sheet. */
import sharp from 'sharp';
import { readFile, writeFile, mkdir, stat, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = dirname(fileURLToPath(import.meta.url));
const out = resolve(root, '../../public/brand/run');
const specs = JSON.parse(await readFile(resolve(root, '.cache/renders.json'), 'utf8'));
await mkdir(out, { recursive: true });
const expected = {
  'bunny-run': 8, 'bunny-jump': 3, 'bunny-slide': 2, 'bunny-lean': 2, 'bunny-crash': 3,
  'bread-cart': 1, 'flour-sacks': 1, 'shop-awning': 1, puddle: 1, 'loaf-spin': 6,
  'paper-bag': 1, 'coffee-cup': 1, 'road-stone': 1, 'shops-left': 3, 'shops-right': 3, 'sky-dawn': 1,
};
const manifest = {
  version: 1, baseUrl: '/brand/run/', pixelRatio: 2, colorSpace: 'srgb',
  renderer: specs.find(spec => spec.renderer)?.renderer,
  camera: { projection: 'orthographic', azimuthDegrees: 0, elevationDegrees: 36.869898,
    forwardAxis: '+Y', screenRightAxis: '+X', bunnyYawDegrees: -12 },
  coordinates: { origin: 'top-left', units: 'source pixels',
    anchor: 'projected world origin; place at ground contact, not image center',
    draw: 'drawImage(sheet, ...rect, x-anchor[0]*scale, y-anchor[1]*scale, frameWidth*scale, frameHeight*scale)',
    scale: '0.5 gives nominal CSS size at 2x; multiply by perspective scale' },
  assets: {},
};
const previews = new Map();
const checks = [];

for (const spec of specs) {
  assert.equal(spec.frameCount, expected[spec.id], `Unexpected count for ${spec.id}`);
  assert.equal(spec.frames.length, spec.frameCount, `Render all frames of ${spec.id} before packing`);
  const [width, height] = spec.frameSize;
  const columns = Math.min(spec.frameCount, Math.floor(2048/width));
  const rows = Math.ceil(spec.frameCount/columns);
  const layers = [];
  const frames = [];
  const hashes = new Set();
  for (let i = 0; i < spec.frameCount; i++) {
    const frame = spec.frames[i];
    assert.ok(frame.anchor[0] >= 0 && frame.anchor[0] <= width &&
      frame.anchor[1] >= 0 && frame.anchor[1] <= height, `Invalid anchor: ${spec.id}`);
    const source = resolve(root, '.cache', frame.file);
    const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width, width);
    assert.equal(info.height, height);
    // Geometry/light are periodic. Average the outermost 3 scanlines to remove
    // subpixel sampling/denoising differences at the wrap, not to hide mismatched art.
    if (spec.repeatAxis === 'y') {
      for (let j = 0; j < 3; j++) {
        const weight = (3-j)/3;
        for (let x = 0; x < width; x++) {
          for (let c = 0; c < 4; c++) {
            const a = (j*width+x)*4+c;
            const b = ((height-1-j)*width+x)*4+c;
            const mean = (data[a]+data[b])/2;
            data[a] = Math.round(data[a]*(1-weight)+mean*weight);
            data[b] = Math.round(data[b]*(1-weight)+mean*weight);
          }
        }
      }
      for (let x = 0; x < width*4; x++) assert.equal(data[x], data[(height-1)*width*4+x]);
    }
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (data[(y*width+x)*4+3] > 8) {
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      }
    }
    assert.ok(maxX >= 0, `Empty frame ${frame.file}`);
    if (!spec.repeatAxis && spec.id !== 'sky-dawn') {
      assert.ok(minX > 1 && minY > 1 && maxX < width-2 && maxY < height-2,
        `Clipped sprite ${frame.file}: ${[minX, minY, maxX, maxY]}`);
    }
    const input = await sharp(data, { raw: info }).png().toBuffer();
    hashes.add(input.toString('base64'));
    const x = (i % columns)*width, y = Math.floor(i/columns)*height;
    layers.push({ input, left: x, top: y });
    frames.push({ rect: [x, y, width, height], anchor: frame.anchor,
      contentBounds: [minX, minY, maxX-minX+1, maxY-minY+1] });
    previews.set(`${spec.id}:${i}`, input);
  }
  if (spec.frameCount > 1) assert.equal(hashes.size, spec.frameCount, `Duplicate poses: ${spec.id}`);
  const file = `${spec.id}.webp`;
  // Lossless environment edges stay exactly seamless after decoding.
  await sharp({ create: { width: width*columns, height: height*rows, channels: 4,
    background: '#00000000' } }).composite(layers)
    .webp(spec.repeatAxis ? { lossless: true, effort: 6 } : { quality: 86, alphaQuality: 100, effort: 6 })
    .toFile(resolve(out, file));
  const decoded = await sharp(resolve(out, file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(decoded.info.width, width*columns);
  assert.equal(decoded.info.height, height*rows);
  if (spec.repeatAxis === 'y') {
    const stride = decoded.info.width*4;
    for (let i = 0; i < spec.frameCount; i++) {
      const x = (i % columns)*width, y = Math.floor(i/columns)*height;
      const first = y*stride+x*4, last = (y+height-1)*stride+x*4;
      assert.ok(decoded.data.subarray(first, first+width*4).equals(decoded.data.subarray(last, last+width*4)),
        `Encoded seam mismatch: ${spec.id} frame ${i}`);
    }
  }
  const bytes = (await stat(resolve(out, file))).size;
  manifest.assets[spec.id] = {
    file, frameSize: spec.frameSize, frameCount: spec.frameCount, columns, rows,
    fps: spec.fps, loop: spec.loop, anchor: spec.frames[0].anchor, frames, bytes,
    ...(spec.frameLabels ? { frameLabels: spec.frameLabels } : {}),
    ...(spec.repeatAxis ? { repeatAxis: spec.repeatAxis,
      projection: spec.id === 'road-stone' ? 'ground-plan; map onto road trapezoid' : 'camera-plane; repeat vertically before perspective scaling',
      variantPolicy: spec.id.startsWith('shops-') ? 'repeat the same variant; crossfade when changing palette' : undefined } : {}),
  };
  checks.push(`${spec.id}: ${spec.frameCount} frames, ${bytes} bytes`);
}
assert.deepEqual(Object.keys(manifest.assets).sort(), Object.keys(expected).sort());
await writeFile(resolve(out, 'manifest.json'), JSON.stringify(manifest, null, 2)+'\n');
let total = 0;
for (const file of await readdir(out)) total += (await stat(resolve(out, file))).size;
assert.ok(total <= 1_500_000, `Public asset budget exceeded: ${total} > 1500000`);

// Review labels live only in this unshipped contact sheet, never in game textures.
const W = 1600, H = 2040;
const reviewLayers = [];
function label(text, x, y, size=22, color='#66523f') {
  reviewLayers.push({ input: Buffer.from(`<svg width="${W}" height="${H}"><text x="${x}" y="${y}" fill="${color}" font-family="Arial,sans-serif" font-size="${size}">${text}</text></svg>`), left: 0, top: 0 });
}
async function thumb(id, index, x, y, w, h) {
  const input = await sharp(previews.get(`${id}:${index}`)).resize(w, h, { fit: 'contain',
    background: '#00000000' }).png().toBuffer();
  reviewLayers.push({ input, left: x, top: y });
}
label('BUNBUNNY / DAWN DELIVERY', 52, 63, 34);
label('R2 • Procedural Blender clay town • 2x sprites • No runtime 3D', 52, 100, 19);
let y = 155;
for (const [id, title, count] of [
  ['bunny-run', 'RUN / 8', 8], ['bunny-jump', 'JUMP / 3', 3],
  ['bunny-slide', 'SLIDE / 2', 2], ['bunny-lean', 'LEAN / LEFT + RIGHT', 2],
  ['bunny-crash', 'CRASH / 3', 3],
]) {
  label(title, 52, y+26, 18);
  for (let i = 0; i < count; i++) await thumb(id, i, 296+i*151, y-25, 138, 168);
  y += 164;
}
label('STREET OBSTACLES', 52, 1030, 18);
for (const [i, id] of ['bread-cart', 'flour-sacks', 'shop-awning', 'puddle'].entries()) {
  await thumb(id, 0, 285+i*305, 986, 260, 205);
  label(id, 327+i*305, 1210, 18);
}
label('COLLECT + POWER UP', 52, 1280, 18);
for (let i = 0; i < 6; i++) await thumb('loaf-spin', i, 295+i*116, 1235, 105, 110);
await thumb('paper-bag', 0, 1060, 1230, 145, 155);
await thumb('coffee-cup', 0, 1280, 1230, 145, 155);
label('TOWN / REPEATABLE STRIPS', 52, 1444, 18);
for (const [sideIndex, side] of ['left', 'right'].entries()) {
  for (let i = 0; i < 3; i++) await thumb(`shops-${side}`, i, 52+(sideIndex*3+i)*155, 1470, 143, 330);
}
await thumb('road-stone', 0, 1010, 1470, 265, 330);
await thumb('sky-dawn', 0, 1305, 1470, 245, 330);
label('Left / butter · sage · rose', 62, 1832, 18);
label('Right / butter · sage · rose', 527, 1832, 18);
label('Stone road', 1060, 1832, 18);
label('Dawn sky', 1360, 1832, 18);
label(`${Object.values(expected).reduce((a,b)=>a+b,0)} frames • ${(total/1000).toFixed(1)} kB shipped / 1500 kB budget`, 52, 1923, 24);
label('Ground anchors, frame rectangles, labels and playback hints: public/brand/run/manifest.json', 52, 1964, 19);
await sharp({ create: { width: W, height: H, channels: 4, background: '#f4ebdd' } })
  .composite(reviewLayers).png().toFile(resolve(root, 'preview.png'));
console.log(checks.join('\n'));
console.log(`PASS: dimensions, alpha margins, unique poses, tile edges, complete manifest; total ${total} bytes.`);

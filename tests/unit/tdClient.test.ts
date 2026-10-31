import { expect, it, vi, afterEach } from 'vitest';
import { createTdClock } from '@/components/td/tdClock';
import { parseTdSave } from '@/components/td/tdSave';
import { tdLevel, replayTd } from '@/lib/td';
import { TD_ASSET_NAMES, preloadTdArt } from '@/components/td/tdAssets';
const seed = tdLevel('2026-10-19',1).seed;
const tiers = [{id:'bread',radius:.1,points:1,imageUrl:'/bread.webp',color:{bg:'white',ink:'black'}}];
const save = {v:1,seed,level:1,weekKey:'2026-10-19',runId:'00000000-0000-4000-8000-000000000001',nickname:'Baker',tiers,inputs:[],endTick:60,score:0,expiresAt:'2026-10-26T05:00:00Z'};
afterEach(()=>vi.unstubAllGlobals());
it('settles old speed, excludes paused/hidden time, caps time and resumes exact ticks', () => {
  const c=createTdClock(10);c.resume(1000);expect(c.tick(2000)).toBe(70);
  c.speed(2,2000);expect(c.tick(2500)).toBe(130);c.pause(2500);
  expect(c.tick(90000)).toBe(130);c.resume(90000);expect(c.tick(90500)).toBe(190);
  expect(c.tick(1e9)).toBe(18000);
});
it('restores only canonical unexpired replayable saves, including completed retry evidence', () => {
  const now=Date.parse('2026-10-20T12:00:00Z');
  expect(parseTdSave(JSON.stringify(save),now)).toEqual(save);
  for (const patch of [{score:999},{endTick:-1},{seed:'v0.td.2026-10-19.1'},{level:2},{tiers:[]},{inputs:[{tick:500,type:'sell',slot:0}]}]) expect(parseTdSave(JSON.stringify({...save,...patch}),now)).toBeNull();
  expect(parseTdSave(JSON.stringify(save),Date.parse(save.expiresAt))).toBeNull();
  const terminal=replayTd({seed,tierCount:1},[]);
  expect(parseTdSave(JSON.stringify({...save,endTick:terminal.tick,score:terminal.wave}),now)?.endTick).toBe(terminal.tick);
});
it('has the full D3 name contract and falls back when the manifest is absent', async () => {
  expect(TD_ASSET_NAMES).toHaveLength(24);
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false}));
  expect(await preloadTdArt()).toEqual({});
});
it('decodes RUN-format rectangles and anchors while missing entries remain optional', async () => {
  vi.resetModules();
  class FakeImage { src=''; decode=async()=>{}; }
  vi.stubGlobal('Image',FakeImage);
  const asset={file:'ant.webp',frameSize:[60,80],frameCount:2,columns:2,rows:1,fps:12,loop:true,anchor:[30,70],frames:[{rect:[0,0,60,80],anchor:[30,70]},{rect:[60,0,60,80],anchor:[30,71]}]};
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({version:1,baseUrl:'/brand/td/',pixelRatio:2,assets:{'pest-ant':asset}})}));
  const {preloadTdArt:load}=await import('@/components/td/tdAssets');
  const art=await load();expect(art['pest-ant']?.image.src).toBe('/brand/td/ant.webp');
  expect(art['pest-ant']?.asset.frames[1].anchor).toEqual([30,71]);expect(art['map-1']).toBeUndefined();
});

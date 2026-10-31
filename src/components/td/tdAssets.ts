/** RUN manifest contract: baseUrl + file, frame rects/anchors, fps and loop. TD art is optional. */
export interface TdFrame { rect: [number, number, number, number]; anchor: [number, number] }
export interface TdAsset { file: string; frameSize: [number, number]; frameCount: number; columns: number; rows: number; fps?: number; loop?: boolean; anchor: [number, number]; frames: TdFrame[] }
export interface TdManifest { version: number; baseUrl: string; pixelRatio: number; assets: Record<string, TdAsset> }
export interface TdSprite { image: HTMLImageElement; asset: TdAsset }
export type TdArt = Record<string, TdSprite | undefined>;
export const TD_ASSET_NAMES = [
  'map-1', 'map-2', 'map-3', 'tower-pin-0', 'tower-pin-1', 'tower-pin-2',
  'tower-sifter-0', 'tower-sifter-1', 'tower-sifter-2', 'tower-whisk-0', 'tower-whisk-1', 'tower-whisk-2',
  'tower-oven-0', 'tower-oven-1', 'tower-oven-2', 'pest-ant', 'pest-mouse', 'pest-sparrow', 'pest-beetle', 'pest-boss',
  'proj-pin', 'proj-whisk', 'proj-oven', 'fx-hit', 'slot',
] as const;
let pending: Promise<TdArt> | null = null;
export function preloadTdArt(): Promise<TdArt> {
  if (!pending) pending = (async () => {
    const art: TdArt = {};
    try {
      const response = await fetch('/brand/td/manifest.json');
      if (!response.ok) return art;
      const manifest = await response.json() as TdManifest;
      await Promise.all(TD_ASSET_NAMES.map(async name => {
        const asset = manifest.assets?.[name];
        if (!asset?.frames?.length || !asset.frames.every(f => f.rect?.length === 4 && f.anchor?.length === 2)) return;
        try {
          const image = new Image(); image.src = manifest.baseUrl + asset.file; await image.decode();
          art[name] = { image, asset };
        } catch { /* Each missing sprite independently uses its placeholder. */ }
      }));
    } catch { /* D3 may not have shipped yet. */ }
    return art;
  })();
  return pending;
}

import manifest from "../../../public/brand/run/manifest.json";
export { manifest };
export type AssetName = keyof typeof manifest.assets;
export type RunArt = Record<AssetName, HTMLImageElement>;
let pending: Promise<RunArt> | null = null;
/** Failed loads may be retried. No animation or clock starts until every sheet is decoded. */
export function preloadRunArt(): Promise<RunArt> {
  if (!pending) pending = Promise.all(Object.entries(manifest.assets).map(async ([name, asset]) => {
    const image = new Image();
    image.src = manifest.baseUrl + asset.file;
    await image.decode();
    return [name, image] as const;
  })).then(entries => Object.fromEntries(entries) as RunArt).catch(error => { pending = null; throw error; });
  return pending;
}

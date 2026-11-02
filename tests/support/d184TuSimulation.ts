import { greedyTu, diggerTu, randomTu } from './tuBot';
const tiers = Array.from({ length: 8 }, (_, i) => ({ id: `${i}` }));
for (const [name, bot] of Object.entries({ randomTu, greedyTu, diggerTu })) {
  const runs = Array.from({ length: 100 }, (_, i) => bot(`review-1102-${i}`, tiers, 600));
  const median = (v: number[]) => v.sort((a,b) => a-b)[50];
  console.log(JSON.stringify({name, medianInputs: median(runs.map(r => r.taps.length)), medianBatch: median(runs.map(r => r.batch)), capped: runs.filter(r => !r.over).length,
    ovens: Array.from({length: 9}, (_, i) => ({ oven: i+1, reached: runs.filter(r => r.batch >= i+1).length, failed: runs.filter(r => r.over && r.batch === i+1).length }))}));
}

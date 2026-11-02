import { casualRun, intermediateRun, perfectRun } from './runBot';
for (const [name,bot,count] of [['casual',casualRun,100],['intermediate',intermediateRun,100],['search',perfectRun,20]] as const) {
 const a=[];let hits=0,capped=0;
 for(let i=0;i<count;i++){const r=bot(`tuning${i}`,18000);a.push(r.endTick/60);hits+=r.collisions;if(!r.over)capped++;}
 a.sort((a,b)=>a-b);console.log(JSON.stringify({name,count,p10:a[Math.floor(count*.1)],median:a[Math.floor(count*.5)],p90:a[Math.floor(count*.9)],hits,capped}));
}

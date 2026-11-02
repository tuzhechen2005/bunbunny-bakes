import { createTdGame, type TdEvent, type TdInput, type TdLevel, type TdState } from '../../src/lib/td';

/** Attribute permanent bread losses to phase cohorts using a canonical replay. */
export function measureTdSpitRun(definition: TdLevel, run: {inputs: TdInput[]; state: TdState}) {
  if (run.state.inputsRejected) throw new Error("Rejected reference purchase");
  const game = createTdGame({level: definition});
  let boss = 0, born = 0, death = 0, firstHit = 0, input = 0;
  const spits: {remaining:number; lost:number}[] = [], mice = new Map<number, number>();
  const inspect = (events: TdEvent[]) => {
    for (const e of events) {
      if (e.type === 'bossSpawn') { boss = e.pest; born = e.tick; }
      if (e.type === 'hit' && e.pest === boss && !firstHit) firstHit = e.tick;
      if (e.type === 'kill' && e.pest === boss) death = e.tick;
      if (e.type === 'bossPhase') spits.push({remaining:e.mice,lost:0});
      if (e.type === 'spawn') {
        const index = spits.findIndex(s=>s.remaining > 0);
        if (index >= 0) { mice.set(e.pest,index); spits[index].remaining--; }
      }
      if (e.type === 'lose' && mice.has(e.pest)) spits[mice.get(e.pest)!].lost += e.tiers.length;
    }
  };
  while (game.state().tick < run.state.tick) {
    if (game.over) throw new Error("Replay ended before the reference run");
    const tick = Math.min(run.state.tick, game.state().tick + 30, run.inputs[input]?.tick ?? Infinity);
    inspect(game.step(tick));
    while (input < run.inputs.length && run.inputs[input].tick === tick) {
      game.apply(run.inputs[input++]); inspect(game.state().events);
    }
  }
  if (game.state().bread !== run.state.bread || game.passed !== run.state.passed) throw new Error("Simulation replay diverged");
  return {win:run.state.passed,encounter:boss ? (run.state.tick-born)/60 : null,spits:spits.map(s=>s.lost),boss:death ? (death-born)/60 : null,
    engaged:death ? (death-firstHit)/60 : null};
}

import { clearsObstacle, jumpLift, runGeometry, MAX_OBSTACLE_FRONT, MAX_OBSTACLE_BACK } from "./geometry";
import { createRunTrack } from "./track";
import {
  MAX_SPEED, BASE_SPEED, CAP_SPEED, RAMP_TICKS, MAX_RUN_TICKS, MAX_INPUTS, JUMP_TICKS,
  SLIDE_TICKS, LANE_CHANGE_TICKS, MAGNET_TICKS, COFFEE_TICKS, VISIBLE_DISTANCE,
  SHOES_TICKS, RunReplayError,
  type RunDirection, type RunGame, type RunLane, type RunEvent, type RunObject,
  type RunObstacleKind, type RunPlayer, type RunState,
} from "./types";

// A moving obstacle remains in storage for at most this many ticks at the slowest player
// speed. Its displacement bounds the original-centre range needing collision work.
const MAX_MOVING_TRAVEL = (Math.ceil((VISIBLE_DISTANCE + MAX_OBSTACLE_BACK) / BASE_SPEED) + 1) * Math.max(runGeometry.truckSpeed, runGeometry.breadWheelSpeed);

export function runMultiplier(distance: number): number { return distance >= 1_500_000 ? 3 : distance >= 500_000 ? 2 : 1; }
/** The current distance tier multiplies distance points, never bread points. */
export function runDistancePoints(distance: number): number {
  return Math.floor(distance / 1000) * runMultiplier(distance);
}
export function runSpeed(tick: number, coffee = false): number {
  const base = BASE_SPEED + Math.floor((CAP_SPEED - BASE_SPEED) * Math.min(tick, RAMP_TICKS) / RAMP_TICKS);
  return coffee ? Math.floor(base * 3 / 2) : base;
}
export function isRunObstacle(kind: RunObject["kind"]): kind is RunObstacleKind {
  return kind === "pothole" || kind === "bread-wheel" || kind === "cart" || kind === "flour" || kind === "awning" || kind === "puddle" || kind === "ramp" || kind === "van" || kind === "truck";
}
export function validRunTick(tick: number): boolean {
  return Number.isSafeInteger(tick) && tick >= 0 && tick <= MAX_RUN_TICKS;
}
export function validRunDirection(dir: unknown): dir is RunDirection {
  return dir === "L" || dir === "R" || dir === "U" || dir === "D";
}

export function createRunGame({ seed, realtime = false }: { seed: string; realtime?: boolean }): RunGame {
  const track = createRunTrack(seed);
  let tick = 0, distance = 0, bread = 0, over = false;
  let lane: RunLane = 1;
  let y = 0, baseY = 0, fallSpeed = 0;
  let surface: "ground" | "roof" = "ground";
  const truckTravel = new Map<number, number>();
  const carriers = new Map<number, RunObject>();
  const objectLane = (o: RunObject) => o.carrierId === undefined ? o.lane : carriers.get(o.carrierId)?.lane ?? o.lane;
  const objectSpeed = (o: RunObject) => o.speed ?? (o.carrierId !== undefined
    ? carriers.get(o.carrierId)?.speed ?? runGeometry.truckSpeed
    : o.kind === "truck" ? runGeometry.truckSpeed : o.kind === "bread-wheel" ? runGeometry.breadWheelSpeed : 0);
  const position = (o: RunObject) => o.z - (truckTravel.get(o.carrierId ?? o.id) ?? 0);
  const front = (o: RunObject) => o.front;
  const back = (o: RunObject) => o.back;
  const height = (o: RunObject) => o.height;
  const visible = (o: RunObject) => position(o) <= distance + VISIBLE_DISTANCE &&
    (isRunObstacle(o.kind) ? position(o) + back(o) >= distance : position(o) > distance);
  const snapshotObject = (o: RunObject): RunObject => {
    const object: RunObject = {
      id: o.id, kind: o.kind, lane: objectLane(o), z: position(o) - distance,
      front: o.front, back: o.back, height: o.height, speed: objectSpeed(o),
      signalUntil: o.signalUntil ?? 0, targetLane: o.targetLane ?? objectLane(o),
    };
    if (o.y !== undefined) object.y = o.y;
    if (o.value !== undefined) object.value = o.value;
    if (o.carrierId !== undefined) object.carrierId = o.carrierId;
    return object;
  };
  let action: "jump" | "slide" | null = null;
  let actionStart = 0, actionEnd = 0;
  let change: { from: RunLane; to: RunLane; start: number; end: number } | null = null;
  let queued: "L" | "R" | null = null;
  let magnetUntil = 0, coffeeUntil = 0, shoesUntil = 0;
  let shield = false, secondJump = false;
  const absorbed = new Set<number>();
  let lastInput = -1, inputCount = 0;
  let objects: RunObject[] = [], head = 0, generatedEnd = 0;
  let events: RunEvent[] = [];

  function fill() {
    while (generatedEnd < distance + VISIBLE_DISTANCE) {
      const chunk = track.next();
      for (const o of chunk.objects) if (o.kind === "truck") carriers.set(o.id, o);
      // Compact only at chunk boundaries, keeping simulation work/memory bounded.
      objects = objects.slice(head).concat(chunk.objects);
      head = 0;
      generatedEnd = chunk.end;
    }
  }
  if(realtime) {
    // Pre-generate the finite capped track once
    // before starting the clock so chunk creation/compaction never runs in rAF.
    while(generatedEnd < MAX_RUN_TICKS*MAX_SPEED+VISIBLE_DISTANCE) {
      const chunk=track.next();
      for (const o of chunk.objects) if (o.kind === "truck") carriers.set(o.id, o);
      for(const object of chunk.objects)objects.push(object);
      generatedEnd=chunk.end;
    }
  } else fill();
  const liveObjects:RunObject[]=Array.from({length:64},()=>({id:0,lane:1,z:0,kind:'bread',front:0,back:0,height:0}));
  const liveChange={from:1,to:1,progress:0} as NonNullable<RunPlayer['laneChange']>;
  const live:RunState={tick:0,player:{shield:false,y:0,surface:'ground',lane:1,pose:'run',progress:0,laneChange:null,queuedLane:null},
    objects:[],speed:BASE_SPEED,distance:0,bread:0,multiplier:1,score:0,over:false,
    powerUps:{shoesUntil:0,shoesTicks:0,magnetUntil:0,coffeeUntil:0,magnetTicks:0,coffeeTicks:0},events:[]};
  // Separate pools keep event shapes identical to detached replay events.
  const poolSize=realtime?objects.length+4:0;
  const collectPool=Array.from({length:poolSize},()=>({type:'collect' as const,tick:0,id:0,kind:'bread' as 'bread'|'paper-bag'|'coffee'|'double-jump-shoes'|'shield',lane:1 as RunLane}));
  const expirePool=Array.from({length:poolSize},()=>({type:'expire' as const,tick:0,kind:'coffee' as 'coffee'|'paper-bag'|'double-jump-shoes'}));
  const collisionPool=Array.from({length:poolSize},()=>({type:'collision' as const,tick:0,id:0,kind:'cart' as RunObstacleKind,lane:1 as RunLane}));
  const overEvent={type:'over' as const,tick:0,reason:'collision' as 'collision'|'limit'};
  function expire(kind:'paper-bag'|'coffee'|'double-jump-shoes') {
    const event=realtime?expirePool[events.length]:{type:'expire' as const,tick,kind};
    event.tick=tick;event.kind=kind;events.push(event);
  }
  function collect(obj:RunObject) {
    const kind=obj.kind as 'bread'|'paper-bag'|'coffee'|'double-jump-shoes'|'shield';
    const event=realtime?collectPool[events.length]:{type:'collect' as const,tick,id:obj.id,kind,lane:objectLane(obj)};
    event.tick=tick;event.id=obj.id;event.kind=kind;event.lane=objectLane(obj);events.push(event);
  }
  function collide(obj:RunObject) {
    const event=realtime?collisionPool[events.length]:{type:'collision' as const,tick,id:obj.id,kind:obj.kind as RunObstacleKind,lane:objectLane(obj)};
    event.tick=tick;event.id=obj.id;event.kind=obj.kind as RunObstacleKind;event.lane=objectLane(obj);events.push(event);
  }
  function end(reason:'collision'|'limit') {
    const event=realtime?overEvent:{type:'over' as const,tick,reason};
    event.tick=tick;event.reason=reason;events.push(event);
  }

  const changeBuffer={from:1 as RunLane,to:1 as RunLane,start:0,end:0};
  const actionPool=Array.from({length:2},()=>({type:'action' as const,tick:0,dir:'L' as RunDirection}));
  let actionCount=0;
  function startLane(dir: "L" | "R") {
    const to = lane + (dir === "L" ? -1 : 1);
    if (to < 0 || to > 2) return;
    change = realtime?changeBuffer:{from:lane,to:to as RunLane,start:tick,end:tick+LANE_CHANGE_TICKS};
    change.from=lane;change.to=to as RunLane;change.start=tick;change.end=tick+LANE_CHANGE_TICKS;
    if(realtime){const event=actionPool[actionCount++];event.tick=tick;event.dir=dir;events.push(event);}
    else events.push({type:'action',tick,dir});
  }

  function occupiedLane(): RunLane {
    return change && (tick - change.start) * 2 >= LANE_CHANGE_TICKS ? change.to : lane;
  }
  function actionProgress() {
    return action ? Math.floor((tick - actionStart) * 1000 / (actionEnd - actionStart)) : 0;
  }

  function advance(toTick: number) {
    while (tick < toTick && !over) {
      tick++;
      if (shoesUntil === tick) expire("double-jump-shoes");
      if (magnetUntil === tick) expire("paper-bag");
      if (coffeeUntil === tick) expire("coffee");
      if (action && tick >= actionEnd) action = null;
      if (change && tick >= change.end) {
        lane = change.to;
        change = null;
        if (queued) { const dir = queued; queued = null; startLane(dir); }
      }
      const previousDistance = distance;
      distance += runSpeed(tick, coffeeUntil > tick);
      const activeEnd = distance + VISIBLE_DISTANCE;
      for (let i = head; i < objects.length && objects[i].z <= activeEnd; i++) {
        const o = objects[i];
        if (o.kind === "truck" || o.kind === "bread-wheel") {
          truckTravel.set(o.id, (truckTravel.get(o.id) ?? 0) + objectSpeed(o));
          if (o.kind === "truck" && o.targetLane !== undefined) {
            o.signalUntil ??= tick + 60;
            if (tick >= o.signalUntil) o.lane = o.targetLane;
          }
        }
      }
      const collisionEnd = distance + MAX_OBSTACLE_FRONT + MAX_MOVING_TRAVEL;
      const previousY = y;
      const lift = action === "jump" ? jumpLift(actionProgress()) : 0;
      let support = 0;
      for (let i = head; i < objects.length && objects[i].z <= collisionEnd; i++) {
        const o = objects[i];
        if (o.kind !== "ramp" && o.kind !== "van" && o.kind !== "truck") continue;
        const z = position(o) - distance;
        if (o.lane !== occupiedLane() || z > front(o) || z < -back(o) - (o.kind === "ramp" ? distance - previousDistance : 0)) continue;
        if (o.kind === "ramp") support = Math.max(support, Math.min(height(o), Math.floor(height(o) * (front(o) - z) / (front(o) + back(o)))));
        if ((o.kind === "van" || o.kind === "truck") && Math.max(previousY, baseY + lift) >= height(o)) support = Math.max(support, height(o));
      }
      if (action === "jump") {
        y = baseY + lift;
        if (y <= support) {
          baseY = support; y = support; action = null; fallSpeed = 0;
        }
      } else if (support > 0 || baseY === 0) {
        baseY = support; y = support; fallSpeed = 0;
      } else {
        fallSpeed += runGeometry.gravity;
        baseY = Math.max(support, baseY - fallSpeed); y = baseY;
      }
      if (y === 0 || (support > 0 && y === support)) secondJump = false;
      surface = support > 0 ? "roof" : "ground";
      for (let i = head; i < objects.length && objects[i].z <= collisionEnd; i++) {
        const obj = objects[i], z = position(obj) - distance;
        const previousZ = z + distance - previousDistance + objectSpeed(obj);
        if (isRunObstacle(obj.kind)) {
          if (absorbed.has(obj.id) || obj.kind === "ramp" || obj.lane !== occupiedLane() || coffeeUntil > tick ||
              z > front(obj) - runGeometry.edgeGrace || previousZ < -back(obj) + runGeometry.edgeGrace) continue;
          const roof = obj.kind === "van" || obj.kind === "truck";
          const clears = obj.kind === "pothole" ? y > 0 && previousY > 0 : roof ? y >= height(obj) ||
            (previousY >= height(obj) && z < -back(obj) + runGeometry.edgeGrace) : y >= height(obj) ||
            (baseY === 0 && clearsObstacle(obj.kind, action, actionProgress()));
          if (!clears) {
            if (shield) { shield = false; absorbed.add(obj.id); collide(obj); continue; }
            over = true; collide(obj); end("collision"); break;
          }
        } else if (previousZ > 0 && z <= 0 &&
                   (objectLane(obj) === occupiedLane() || (obj.kind === "bread" && magnetUntil > tick)) &&
                   ((obj.y ?? 0) === 0 || (surface === "roof" && Math.abs(y - (obj.y ?? 0)) < runGeometry.collectHeightTolerance) || (obj.kind === "bread" && magnetUntil > tick))) {
          if (obj.kind === "bread") bread += obj.value ?? 1;
          else if (obj.kind === "paper-bag") magnetUntil = tick + MAGNET_TICKS;
          else if (obj.kind === "coffee") coffeeUntil = tick + COFFEE_TICKS;
          else if (obj.kind === "double-jump-shoes") shoesUntil = tick + SHOES_TICKS;
          else if (obj.kind === "shield") shield = true;
          collect(obj);
        }
      }
      while (head < objects.length && objects[head].z < distance - MAX_OBSTACLE_BACK) { truckTravel.delete(objects[head].id); absorbed.delete(objects[head].id); carriers.delete(objects[head].id); head++; }
      if (tick === MAX_RUN_TICKS && !over) {
        over = true;
        end("limit");
      }
      fill();
    }
  }

  function checkTime(toTick: number) {
    if (!validRunTick(toTick)) throw new RunReplayError("bad tick");
    if (toTick < tick) throw new RunReplayError("cannot rewind tick");
  }
  function player(): RunPlayer {
    const laneChange = change ? {
      from: change.from, to: change.to,
      progress: Math.floor((tick - change.start) * 1000 / LANE_CHANGE_TICKS),
    } : null;
    return {
      y, surface, shield, lane: occupiedLane(), pose: action ?? (change ? "lane-change" : "run"),
      progress: action ? actionProgress() : laneChange?.progress ?? 0,
      laneChange, queuedLane: queued,
    };
  }
  return {
    frame(toTick) {
      checkTime(toTick);
      if(!over){events.length=0;actionCount=0;advance(toTick);}
      live.tick=tick;live.distance=distance;live.bread=bread;live.over=over;
      live.speed=runSpeed(tick,coffeeUntil>tick);live.score=runDistancePoints(distance)+bread*10;
      live.multiplier=runMultiplier(distance);live.player.shield=shield;
      live.powerUps.shoesUntil=shoesUntil;live.powerUps.shoesTicks=Math.max(0,shoesUntil-tick);
      live.player.y=y;live.player.surface=surface;
      live.player.lane=occupiedLane();live.player.pose=action??(change?'lane-change':'run');
      if(change){liveChange.from=change.from;liveChange.to=change.to;liveChange.progress=Math.floor((tick-change.start)*1000/LANE_CHANGE_TICKS);}
      live.player.laneChange=change?liveChange:null;
      live.player.progress=action?actionProgress():change?liveChange.progress:0;live.player.queuedLane=queued;
      live.powerUps.magnetUntil=magnetUntil;live.powerUps.coffeeUntil=coffeeUntil;
      live.powerUps.magnetTicks=Math.max(0,magnetUntil-tick);live.powerUps.coffeeTicks=Math.max(0,coffeeUntil-tick);
      let count=0;
      for(let i=head;i<objects.length&&objects[i].z<=distance+VISIBLE_DISTANCE;i++) {
        const object=objects[i];
        if(!visible(object))continue;
        const target=liveObjects[count] ?? (liveObjects[count] = {} as RunObject);
        target.id=object.id;target.lane=objectLane(object);target.kind=object.kind;
        target.z=position(object)-distance;target.front=front(object);target.back=back(object);target.height=height(object);
        target.signalUntil=object.signalUntil ?? 0;
        target.targetLane=object.targetLane ?? objectLane(object);
        if(object.value !== undefined) target.value=object.value;
        else delete target.value;
        if(object.carrierId !== undefined) target.carrierId=object.carrierId;
        else delete target.carrierId;
        target.speed=objectSpeed(object);
        if(object.y !== undefined) target.y=object.y;
        if(object.y === undefined) delete target.y;
        live.objects[count++]=target;
      }
      live.objects.length=count;live.objects.sort((a,b)=>a.z-b.z||a.id-b.id);live.events=events;
      return live;
    },
    step(toTick) {
      checkTime(toTick);
      if (over) return [];
      events = [];actionCount=0;
      advance(toTick);
      return events.map((e) => ({ ...e }));
    },
    input(at, dir) {
      checkTime(at);
      if (!validRunDirection(dir)) throw new RunReplayError("bad input direction");
      if (at <= lastInput) throw new RunReplayError("input ticks not increasing");
      if (inputCount >= MAX_INPUTS) throw new RunReplayError("too many inputs");
      if (over) throw new RunReplayError("input after game over");
      events = [];actionCount=0;
      advance(at);
      if (over) throw new RunReplayError("input after game over");
      lastInput = at;
      inputCount++;
      if (dir === "L" || dir === "R") {
        if (change) { if (queued === null) queued = dir; }
        else startLane(dir);
      } else if ((!action && (dir === "D" || y === 0 || surface === "roof")) ||
          (dir === "U" && y > 0 && action !== "slide" && shoesUntil > tick && !secondJump)) {
        if (dir === "U" && y > 0 && (action === "jump" || surface !== "roof")) secondJump = true;
        if (dir === "U") baseY = y;
        action = dir === "U" ? "jump" : "slide";
        actionStart = tick;
        actionEnd = tick + (action === "jump" ? JUMP_TICKS : SLIDE_TICKS);
        events.push({ type: "action", tick, dir });
      }
      return events.map((e) => ({ ...e }));
    },
    state() {
      return {
        tick, player: player(),
        objects: objects.slice(head).filter(visible).map(snapshotObject).sort((a,b)=>a.z-b.z||a.id-b.id),
        speed: runSpeed(tick, coffeeUntil > tick), distance, bread,
        multiplier: runMultiplier(distance), score: runDistancePoints(distance) + bread * 10, over,
        powerUps: { shoesUntil, shoesTicks: Math.max(0, shoesUntil - tick), magnetUntil, coffeeUntil, magnetTicks: Math.max(0, magnetUntil - tick), coffeeTicks: Math.max(0, coffeeUntil - tick) },
        events: events.map((e) => ({ ...e })),
      };
    },
  };
}

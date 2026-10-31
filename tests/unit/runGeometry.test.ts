import { expect, it } from "vitest";
import { runGeometry, jumpLift, slideBodyHeight, clearsObstacle, overlapsObstacle } from "@/lib/run/geometry";
import { project } from "@/components/run/runHelpers";

it("places zero depth on the feet line and continues behind it", () => {
  for (const [w, h] of [[320, 570], [390, 650], [430, 900]]) {
    expect(project(1, 0, w, h).y).toBeCloseTo(h * runGeometry.feet);
    expect(project(1, -1000, w, h).y).toBeGreaterThan(project(1, 0, w, h).y);
  }
});
it("requires visible clearance rather than the action name", () => {
  for (const progress of [0, 23, 976, 1000]) expect(clearsObstacle("flour", "jump", progress)).toBe(false);
  expect(clearsObstacle("puddle", "jump", 0)).toBe(false);
  expect(clearsObstacle("puddle", "jump", 1000)).toBe(false);
  expect(jumpLift(500)).toBe(runGeometry.jumpHeight);
  expect(clearsObstacle("flour", "jump", 500)).toBe(true);
  expect(slideBodyHeight(0)).toBe(runGeometry.standingHeight);
  expect(clearsObstacle("awning", "slide", 0)).toBe(false);
  expect(clearsObstacle("awning", "slide", 500)).toBe(true);
});
it("sweeps front to back with only a small inset grace", () => {
  const {front, back} = runGeometry.obstacles.flour;
  expect(overlapsObstacle("flour", front + 1, front)).toBe(false);
  expect(overlapsObstacle("flour", front, 0)).toBe(true);
  expect(overlapsObstacle("flour", 0, -back)).toBe(true);
  expect(overlapsObstacle("flour", -back, -back - 750)).toBe(false);
});

import { manifest } from "@/components/run/runAssets";
import { obstaclePlacement } from "@/components/run/runRenderer";
import { projectionDepth, projectionZ, worldHeightPixels } from "@/lib/run/geometry";
const obstacleAssets = {cart:'bread-cart',flour:'flour-sacks',awning:'shop-awning',puddle:'puddle'} as const;
it("keeps Blender dimensions, rendered footprints and engine extents in agreement", () => {
  for(const kind of Object.keys(obstacleAssets) as (keyof typeof obstacleAssets)[]) {
    const a=manifest.assets[obstacleAssets[kind]], shape=runGeometry.obstacles[kind];
    expect(a.geometry).toEqual(shape);
    for(const [w,h] of [[320,570],[390,650],[430,900]]) for(const z of [-1000,0,1000,14000,70000]) {
      const draw=obstaclePlacement(kind,1,z,w,h);
      expect(draw.frontY).toBeCloseTo(project(1,z-shape.front,w,h).y,5);
      expect(draw.backY).toBeCloseTo(project(1,z+shape.back,w,h).y,5);
      expect(draw.y).toBeCloseTo(project(1,z,w,h).y,5);
      expect((a.anchor[1]-a.heightTop[1])*draw.scale).toBeCloseTo(worldHeightPixels(shape.height,h)*projectionDepth(z),5);
    }
  }
});
it("inverts the road projection with a single pinhole at every distance", () => {
  for(const z of [-3000,0,1000,2000,2001,14000,90000]) expect(projectionZ(projectionDepth(z))).toBeCloseTo(z,7);
});

it("uses standard pinhole scale and a bunny-sized cart at contact", () => {
  for(const z of [-1000,0,1000,2000,14000,90000]) {
    expect(projectionDepth(z)).toBeCloseTo(runGeometry.focalDistance/(runGeometry.focalDistance+z),12);
  }
  expect(runGeometry.horizon).toBeCloseTo(1/3,1);
  expect(runGeometry.obstacles.cart.height/runGeometry.standingHeight).toBeCloseTo(1.3,1);
  expect(worldHeightPixels(runGeometry.obstacles.cart.height,650)).toBeLessThan(650*.25);
});

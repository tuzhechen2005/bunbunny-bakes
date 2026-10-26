"use client";

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { copy } from "@/copy";
import type { MenuProduct } from "@/lib/api";
import { Spring, createLoop, rubberBand, snapTarget, type Loop } from "@/lib/motion";
import { fill } from "../format";
import { photosOf, ProductPhoto } from "../ProductCard";
import { bindDrag } from "./drag";

const t = copy.customer.home;

/** Horizontal gesture rule shared with the pull-down on the same photo: horizontal when |dx| >= 0.75 |dy|. */
export const PHOTO_AXIS_BIAS = 0.75;
/** Reduced motion: a swipe this long (px) switches the photo at once. */
const REDUCED_SWIPE_PX = 40;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * The photo of the taken-down bread (D98): one slide per photo, cover first. A horizontal swipe on the
 * photo (touch events, axis decided on the first move like the rope) moves between the photos with the
 * rope's spring, a rubber band at both ends, and never changes the product (prev / next stay on the
 * top buttons). A vertical pull is left to the detail's pull-down. Keys: left / right when focused.
 * Reduced motion switches instantly. Non-cover photos are lazy-loaded. Mount it with `key={product.id}`
 * so a new product starts on its cover.
 */
export function PhotoCarousel({ product, reduced }: { product: MenuProduct; reduced: boolean }) {
  const photos = photosOf(product);
  const n = photos.length;
  const face = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const spring = useRef(new Spring(0));
  const loop = useRef<Loop | null>(null);
  const drag = useRef({ on: false, g0: 0 });
  const [cur, setCur] = useState(0);
  const latest = useRef({ reduced, n });
  useLayoutEffect(() => {
    latest.current = { reduced, n };
  });

  useEffect(() => {
    const el = face.current;
    const tr = track.current;
    if (!el || !tr) return;
    const sp = spring.current;
    const write = () => {
      tr.style.transform = `translate3d(${(-sp.x * 100).toFixed(3)}%,0,0)`;
    };
    const lp = createLoop((dt) => {
      if (!drag.current.on) {
        if (latest.current.reduced) sp.settle();
        else {
          sp.step(dt);
          if (sp.isAtRest()) sp.settle();
        }
      }
      write();
      return drag.current.on || !sp.isAtRest();
    });
    loop.current = lp;
    write();
    if (n < 2) return () => lp.stop();
    const off = bindDrag(el, {
      axis: "x",
      horizontalBias: PHOTO_AXIS_BIAS,
      lockPx: 4,
      canStart: () => !drag.current.on,
      onStart: () => {
        drag.current.g0 = sp.x;
      },
      onDrag: (dx) => {
        if (latest.current.reduced) return;
        drag.current.on = true;
        sp.set(rubberBand(drag.current.g0 - dx / Math.max(1, el.clientWidth), 0, latest.current.n - 1), 0);
        lp.start();
      },
      onEnd: (end) => {
        if (!end.dragged) return;
        const start = Math.round(drag.current.g0);
        drag.current.on = false;
        let target: number;
        if (latest.current.reduced) {
          const dir = end.cancelled ? 0 : Math.abs(end.dx) >= REDUCED_SWIPE_PX || end.fling !== 0 ? (end.dx < 0 ? 1 : -1) : 0;
          target = clamp(start + dir, 0, latest.current.n - 1);
        } else {
          target = snapTarget(sp.x, start, end.cancelled ? 0 : (-end.fling as -1 | 0 | 1), latest.current.n);
          sp.v = clamp((-end.velocity * 1000) / Math.max(1, el.clientWidth), -12, 12);
        }
        sp.target = target;
        setCur(target);
        lp.start();
      },
    });
    return () => {
      off();
      lp.stop();
    };
  }, [n]);

  const go = (k: number) => {
    const target = clamp(k, 0, n - 1);
    spring.current.target = target;
    setCur(target);
    loop.current?.start();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (n < 2 || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    go(Math.round(spring.current.target) + (e.key === "ArrowRight" ? 1 : -1));
    e.preventDefault();
  };

  const many = n > 1;
  return (
    <>
      <div
        ref={face}
        className="hm-face hm-car"
        data-testid="detail-photos"
        data-photo-index={cur}
        data-photo-count={n}
        {...(many
          ? {
              tabIndex: 0,
              role: "group",
              "aria-label": fill(t.photoLabel, { name: product.name }),
              onKeyDown,
            }
          : {})}
      >
        <div ref={track} className="hm-track">
          {(n > 0 ? photos : [null]).map((url, k) => (
            <div key={url ?? "none"} className="hm-slide" data-testid="detail-slide">
              <ProductPhoto product={product} src={url} className="h-full w-full" variant="detail" eager={k === 0} decorative={many ? k !== cur : true} />
            </div>
          ))}
        </div>
      </div>
      {many ? (
        <>
          <div className="hm-pdots" aria-hidden="true" data-testid="detail-dots">
            {photos.map((u, k) => (
              <i key={u} className={k === cur ? "is-on" : ""} />
            ))}
          </div>
          <span className="hm-sr" role="status" aria-live="polite">
            {fill(t.photoPos, { i: cur + 1, n })}
          </span>
        </>
      ) : null}
    </>
  );
}

"use client";

import { LazyMotion, type FeatureBundle } from "motion/react";
import type { ReactNode } from "react";

// domAnimation is fetched on demand (separate chunk) so it stays out of the first-screen budget.
const loadFeatures = (): Promise<FeatureBundle> => import("./motionFeatures").then((m) => m.default);

/**
 * Mounted once in the root layout. Components animate with `m.*` from "motion/react"
 * (never the full `motion.*`), which keeps the bundle small (FRONTEND.md section 5).
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={loadFeatures} strict>
      {children}
    </LazyMotion>
  );
}

import { describe, expect, it } from "vitest";
import { projectPool } from "@/components/customer/rack/GroupProgress";

// D192 live progress: the pool as it would be with the customer's own pieces (B = 6 a cake, min 4).
const pool = (last: number, cakes: number, status: "OPEN" | "FORMED" | "CONFIRMED" = "OPEN") => ({ last, cakes, min: 4, status });

describe("projectPool", () => {
  it("2 ordered + 1 of mine: 3/4, still 1 to go; + 2 of mine forms it", () => {
    expect(projectPool(pool(2, 1), 6, 1)).toMatchObject({ before: 2, after: 3, formed: false, needMore: 1 });
    expect(projectPool(pool(2, 1), 6, 2)).toMatchObject({ before: 2, after: 4, formed: true, needMore: 0 });
  });
  it("an empty date counts only mine", () => {
    expect(projectPool(pool(0, 0), 6, 1)).toMatchObject({ before: 0, after: 1, formed: false, needMore: 3 });
  });
  it("a confirmed cake (e.g. ordered before 拼单) stays confirmed while mine fit in it", () => {
    expect(projectPool(pool(1, 1, "CONFIRMED"), 6, 2)).toMatchObject({ confirmed: true, formed: true, spare: 3 });
  });
  it("pieces beyond a full or confirmed cake start a new cake with its own threshold", () => {
    expect(projectPool(pool(5, 1, "CONFIRMED"), 6, 3)).toMatchObject({ confirmed: false, before: 0, after: 2, formed: false, needMore: 2 });
    expect(projectPool(pool(6, 1, "FORMED"), 6, 1)).toMatchObject({ before: 0, after: 1, formed: false, needMore: 3 });
  });
});

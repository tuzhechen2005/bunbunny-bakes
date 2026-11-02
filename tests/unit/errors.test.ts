import { expect, it } from "vitest";
import { copy } from "@/copy";
import { AppError } from "@/server/errors";

it("uses the flavour-specific capacity error copy", () => {
  expect(new AppError("FLAVOR_FULL")).toMatchObject({
    message: copy.errors.FLAVOR_FULL, code: "FLAVOR_FULL", httpStatus: 409,
  });
});

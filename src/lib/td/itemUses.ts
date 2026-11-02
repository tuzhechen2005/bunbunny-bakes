/** E1 compatibility stub until D9 supplies item replay. Count submitted item inputs.
 * Current TD replay still rejects items; this does not bypass replay validation.
 */
export function countItemUses(inputs: readonly unknown[]): Record<"bomb" | "bell" | "slide", number> {
  const counts = { bomb: 0, bell: 0, slide: 0 };
  for (const input of inputs) {
    if (!input || typeof input !== "object") continue;
    const value = input as { type?: unknown; item?: unknown };
    if (value.type !== "item") continue;
    if (value.item !== "bomb" && value.item !== "bell" && value.item !== "slide") throw new Error("Unknown TD item");
    counts[value.item]++;
  }
  return counts;
}

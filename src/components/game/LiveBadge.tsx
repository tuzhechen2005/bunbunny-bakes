import { copy } from "@/copy";

export function LiveBadge() {
  return <span className="whitespace-nowrap text-[11px] text-c-grey" data-testid="game-live">
    <span className="text-c-red" aria-hidden="true">{copy.customer.game.liveDot}</span>{" "}{copy.customer.game.live}
  </span>;
}

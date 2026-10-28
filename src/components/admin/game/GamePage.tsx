"use client";

import { useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { copy } from "@/copy";
import { BoardPanel } from "./BoardPanel";
import { TiersPanel } from "./TiersPanel";

const t = copy.admin.game;

export function GamePage() {
  const [tab, setTab] = useState<"board" | "tiers">("board");
  const [game, setGame] = useState<"big" | "tu">("big");
  const tabs = [
    { id: "board", label: t.tabBoard },
    { id: "tiers", label: t.tabTiers },
  ] as const;
  return (
    <>
      <PageHeader title={t.title} />
      <div role="tablist" aria-label={t.title} className="mb-4 flex gap-2">
        {tabs.map((x) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            id={`game-tab-${x.id}`}
            aria-selected={tab === x.id}
            aria-controls="game-tabpanel"
            className={`min-h-11 flex-1 rounded-lg border px-3 text-base font-medium ${
              tab === x.id ? "border-accent bg-accent text-accent-ink" : "border-line bg-card"
            }`}
            onClick={() => setTab(x.id)}
            data-testid={`game-tab-${x.id}`}
          >
            {x.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="game-tabpanel" aria-labelledby={`game-tab-${tab}`}>
        {tab === "board" ? (
          <>
            <div role="radiogroup" aria-label={t.gameSwitch} className="mb-3 flex gap-2" data-testid="game-switch">
              {([["big", t.gameBig], ["tu", t.gameTu]] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={game === id}
                  className={`min-h-11 flex-1 rounded-full border px-3 text-base ${
                    game === id ? "border-accent bg-accent text-accent-ink" : "border-line bg-card"
                  }`}
                  onClick={() => setGame(id)}
                  data-testid={`game-switch-${id}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <BoardPanel key={game} game={game} />
          </>
        ) : (
          <TiersPanel />
        )}
      </div>
    </>
  );
}

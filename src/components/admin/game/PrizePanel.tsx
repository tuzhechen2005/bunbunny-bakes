"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminCard } from "@/components/admin/AdminCard";
import { inputClass, secondaryBtn } from "@/components/admin/orders/shared";
import { copy } from "@/copy";
import { adminApi } from "@/lib/adminApi";
import { GAME_CATALOG, type GameKind } from "@/lib/gameCatalog";

const t = copy.admin.game;
interface Prize { weekKey: string; game: GameKind; chosenBy: "RANDOM" | "OWNER" }

export function PrizePanel() {
  const [prize, setPrize] = useState<Prize | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const load = useCallback(async () => {
    const result = await adminApi<Prize>("/api/admin/game/prize");
    if (result.ok) { setPrize(result.data); setError(""); }
    else setError(result.message);
  }, []);
  useEffect(() => {
    // Initial fetch resolves asynchronously, like the other admin panels.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function save(game: string) {
    setBusy(true);
    setSaved(false);
    setError("");
    const result = await adminApi<Prize>("/api/admin/game/prize", { method: "PATCH", body: { game } });
    if (result.ok) { setPrize(result.data); setSaved(true); }
    else setError(result.message);
    setBusy(false);
  }

  return (
    <div className="mb-4" data-testid="prize-panel">
      <AdminCard>
        <label className="flex flex-col gap-2 text-sm font-medium">
          {t.prizeTitle}
          <select className={inputClass} value={prize?.game ?? ""} disabled={!prize || busy} onChange={(e) => void save(e.target.value)} data-testid="prize-game-select">
            {!prize ? <option value="">{t.loading}</option> : null}
            {GAME_CATALOG.map((game) => <option key={game.kind} value={game.kind}>{game.name}</option>)}
          </select>
        </label>
        {prize ? <p className="mt-2 text-sm text-muted" role="status">{saved ? t.prizeSaved : prize.chosenBy === "OWNER" ? t.prizeOwner : t.prizeRandom}</p> : null}
        {error ? <div className="mt-2 text-sm text-danger" role="alert">{error}{!prize ? <button className={`${secondaryBtn} ml-2`} onClick={() => void load()}>{t.retry}</button> : null}</div> : null}
      </AdminCard>
    </div>
  );
}

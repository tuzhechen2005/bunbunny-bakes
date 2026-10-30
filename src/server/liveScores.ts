/** Runtime kill switch; no build-time NEXT_PUBLIC flag required. */
export const liveScoresEnabled = () => process.env.LIVE_SCORES !== "off";

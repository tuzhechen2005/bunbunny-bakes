# BIG engine — bakery merging

Pure deterministic fixed-step physics shared by browser and server. `createGame` takes
seed, ordered tier definitions, width 1 and height. `drop(x)` accepts a piece outside the
cooldown; `step()` advances 1/120 second. `replay(seed, tiers, drops)` reconstructs the
result from the seed and input log. Client scores are never trusted. D184 changes only
presentation state, not bodies, scoring, collision, RNG draws, or danger rules.

## UI contract

D184, owner 11/02:

- `state().highestTier: number | null`: greatest zero-based tier actually dropped or merged
  this run. Null before the first drop; hand/preview alone do not count. It never decreases,
  including after two largest breads disappear.
- `state().nextTier: number | null`: 0 before any drop, otherwise highest + 1, or null after
  reaching the final configured tier. Both indexes refer to the run's tier snapshot.
- Existing `drop` / `merge` events carry optional `milestone: { highestTier, nextTier }`
  only on a new record. Their existing `step` is the milestone time. Once per increase,
  never for repeats. The UI may show a short upgrade prompt without covering the landing
  area. No new event discriminator is added, preserving existing UI event adapters;
  `drainEvents()` consumes events while the state retains the record for resume.

`BIG_ENGINE_VERSION = 2`, `bigSeed(hex) = v2.<hex>`, and `bigSeedVersion(seed)` are exported.
The prefix is stripped before seeding physics, preserving all historical rules for the same
payload. The server rejects old unfinished runs on finish and progress. Engine construction
rejects legacy 32-hex production seeds (including old local-save restoration) and incompatible
version prefixes. Arbitrary unversioned textual seeds remain supported for headless fixtures.
UI save-parser cleanup/key migration should use the exported version; component changes belong
to Claude. Existing verified finished scores remain valid and repeated finish stays idempotent.

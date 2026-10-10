import { calculateWeightedWager, getRankProgress } from "./rank-engine.js?v=rank-badges-1";

function asNonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

/**
 * @typedef {Object} PlayerRankStats
 * @property {number} lifetimeRawWager
 * @property {number} lifetimeWeightedWager
 * @property {string} currentRank
 * @property {string} currentStage
 * @property {"I"|"II"|"III"} currentTier
 * @property {number} rankProgress
 */

/**
 * Creates the profile-facing rank snapshot. Rank fields supplied by a caller
 * are deliberately ignored: rank is always derived from weighted lifetime wager.
 * Until a wager service is connected, missing totals remain zero.
 *
 * @param {{lifetimeRawWager?: number, lifetimeWeightedWager?: number}} source
 * @returns {PlayerRankStats & Omit<ReturnType<typeof getRankProgress>, "currentRank"> & {rankDefinition: ReturnType<typeof getRankProgress>["currentRank"]}}
 */
export function getPlayerRankStats(source = {}) {
  const lifetimeRawWager = asNonNegativeNumber(source.lifetimeRawWager);
  const lifetimeWeightedWager = source.lifetimeWeightedWager == null
    ? calculateWeightedWager(lifetimeRawWager)
    : asNonNegativeNumber(source.lifetimeWeightedWager);
  const progression = getRankProgress(lifetimeWeightedWager);

  return Object.freeze({
    ...progression,
    lifetimeRawWager,
    lifetimeWeightedWager,
    currentRank: progression.currentRank.label,
    currentStage: progression.currentRank.stageId,
    currentTier: progression.currentRank.tier,
    rankProgress: progression.rankProgress,
    rankDefinition: progression.currentRank,
  });
}

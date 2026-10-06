import { MAX_RANK, RANK_LEVELS } from "./rank-config.js";

function asNonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

export function calculateWeightedWager(amount) {
  // Contribution percentages are intentionally disabled until they are supplied
  // by the future admin configuration. For now every recorded wager is 1:1.
  return asNonNegativeNumber(amount);
}

export function getRankFromWeightedWager(weightedWager) {
  const wager = asNonNegativeNumber(weightedWager);
  let currentRank = RANK_LEVELS[0];

  for (const rank of RANK_LEVELS) {
    if (wager < rank.threshold) break;
    currentRank = rank;
  }

  return currentRank;
}

export function getNextRank(weightedWager) {
  const currentRank = getRankFromWeightedWager(weightedWager);
  const currentIndex = RANK_LEVELS.findIndex((rank) => rank.id === currentRank.id);
  return RANK_LEVELS[currentIndex + 1] ?? null;
}

export function getRankProgress(weightedWager) {
  const wager = asNonNegativeNumber(weightedWager);
  const currentRank = getRankFromWeightedWager(wager);
  const nextRank = getNextRank(wager);

  if (!nextRank) {
    return Object.freeze({
      currentRank,
      nextRank: null,
      currentThreshold: MAX_RANK.threshold,
      nextThreshold: null,
      currentValue: wager,
      rankProgress: 1,
      percentage: 100,
      isMaxRank: true,
    });
  }

  const levelRange = nextRank.threshold - currentRank.threshold;
  const rankProgress = Math.min(1, Math.max(0, (wager - currentRank.threshold) / levelRange));

  return Object.freeze({
    currentRank,
    nextRank,
    currentThreshold: currentRank.threshold,
    nextThreshold: nextRank.threshold,
    currentValue: wager,
    rankProgress,
    percentage: rankProgress * 100,
    isMaxRank: false,
  });
}

import test from "node:test";
import assert from "node:assert/strict";
import { RANK_LEVELS, RANK_STAGES } from "../dist/rank-config.js";
import {
  calculateWeightedWager,
  getNextRank,
  getRankFromWeightedWager,
  getRankProgress,
} from "../dist/rank-engine.js";
import { getPlayerRankStats } from "../dist/player-rank-service.js";

test("the configuration contains ten stages and three tiers per stage", () => {
  assert.equal(RANK_STAGES.length, 10);
  assert.equal(RANK_LEVELS.length, 30);
  for (const stage of RANK_STAGES) assert.equal(stage.thresholds.length, 3);
});

test("every exact threshold resolves to its configured rank", () => {
  for (const rank of RANK_LEVELS) {
    assert.equal(getRankFromWeightedWager(rank.threshold).label, rank.label);
  }
});

test("required boundary examples resolve correctly", () => {
  assert.equal(getRankFromWeightedWager(999).label, "Rookie I");
  assert.equal(getRankFromWeightedWager(1_000).label, "Rookie II");
  assert.equal(getRankFromWeightedWager(2_500).label, "Rookie III");
  assert.equal(getRankFromWeightedWager(5_000).label, "Street I");
  assert.equal(getRankFromWeightedWager(1_000_000).label, "Hyper I");
  assert.equal(getRankFromWeightedWager(1_000_000_000).label, "Hall of Fame III");
  assert.equal(getRankFromWeightedWager(1_500_000_000).label, "Hall of Fame III");
});

test("progress is calculated inside the current sub-level", () => {
  const progress = getRankProgress(1_750);
  assert.equal(progress.currentRank.label, "Rookie II");
  assert.equal(progress.nextRank.label, "Rookie III");
  assert.equal(progress.currentThreshold, 1_000);
  assert.equal(progress.nextThreshold, 2_500);
  assert.equal(progress.rankProgress, 0.5);
  assert.equal(progress.percentage, 50);
});

test("a newly reached level starts at zero progress toward the next", () => {
  const progress = getRankProgress(100_000);
  assert.equal(progress.currentRank.label, "Turbo I");
  assert.equal(progress.nextRank.label, "Turbo II");
  assert.equal(progress.rankProgress, 0);
});

test("the maximum rank has no next rank and reports full progress", () => {
  const progress = getRankProgress(1_000_000_001);
  assert.equal(progress.currentRank.label, "Hall of Fame III");
  assert.equal(getNextRank(1_000_000_001), null);
  assert.equal(progress.nextRank, null);
  assert.equal(progress.isMaxRank, true);
  assert.equal(progress.percentage, 100);
});

test("wagers remain one-to-one until admin contribution rules are introduced", () => {
  assert.equal(calculateWeightedWager(100), 100);
  assert.equal(calculateWeightedWager(-100), 0);
  assert.equal(calculateWeightedWager("invalid"), 0);
});

test("profile snapshots derive rank and ignore manually supplied rank values", () => {
  const snapshot = getPlayerRankStats({
    lifetimeRawWager: 151_000,
    lifetimeWeightedWager: 150_000,
    currentRank: "Hall of Fame III",
  });

  assert.equal(snapshot.lifetimeRawWager, 151_000);
  assert.equal(snapshot.lifetimeWeightedWager, 150_000);
  assert.equal(snapshot.currentRank, "Turbo II");
  assert.equal(snapshot.currentStage, "turbo");
  assert.equal(snapshot.currentTier, "II");
});

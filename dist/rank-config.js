export const RANK_STAGES = Object.freeze([
  Object.freeze({
    id: "rookie",
    name: "Rookie",
    subtitle: "Starting Grid",
    badgePaths: Object.freeze(["/ranks/rookie-i.png", "/ranks/rookie-ii.png", "/ranks/rookie-iii.png"]),
    thresholds: Object.freeze([0, 1_000, 2_500]),
  }),
  Object.freeze({
    id: "street",
    name: "Street",
    subtitle: "City Circuit",
    badgePaths: Object.freeze(["/ranks/street-i.png", "/ranks/street-ii.png", "/ranks/street-iii.png"]),
    thresholds: Object.freeze([5_000, 10_000, 20_000]),
  }),
  Object.freeze({
    id: "circuit",
    name: "Circuit",
    subtitle: "Track Ready",
    badgePaths: Object.freeze(["/ranks/circuit-i.png", "/ranks/circuit-ii.png", "/ranks/circuit-iii.png"]),
    thresholds: Object.freeze([35_000, 50_000, 75_000]),
  }),
  Object.freeze({
    id: "turbo",
    name: "Turbo",
    subtitle: "Full Boost",
    badgePaths: Object.freeze(["/ranks/turbo-i.png", "/ranks/turbo-ii.png", "/ranks/turbo-iii.png"]),
    thresholds: Object.freeze([100_000, 150_000, 225_000]),
  }),
  Object.freeze({
    id: "velocity",
    name: "Velocity",
    subtitle: "Rapid Pace",
    badgePaths: Object.freeze(["/ranks/velocity-i.png", "/ranks/velocity-ii.png", "/ranks/velocity-iii.png"]),
    thresholds: Object.freeze([350_000, 500_000, 750_000]),
  }),
  Object.freeze({
    id: "hyper",
    name: "Hyper",
    subtitle: "Overdrive",
    badgePaths: Object.freeze(["/ranks/hyper-i.png", "/ranks/hyper-ii.png", "/ranks/hyper-iii.png"]),
    thresholds: Object.freeze([1_000_000, 1_500_000, 2_500_000]),
  }),
  Object.freeze({
    id: "apex",
    name: "Apex",
    subtitle: "Elite Line",
    badgePaths: Object.freeze(["/ranks/apex-i.png", "/ranks/apex-ii.png", "/ranks/apex-iii.png"]),
    thresholds: Object.freeze([4_000_000, 6_000_000, 10_000_000]),
  }),
  Object.freeze({
    id: "pole",
    name: "Pole",
    subtitle: "Front Row",
    badgePaths: Object.freeze(["/ranks/pole-i.png", "/ranks/pole-ii.png", "/ranks/pole-iii.png"]),
    thresholds: Object.freeze([15_000_000, 25_000_000, 40_000_000]),
  }),
  Object.freeze({
    id: "champion",
    name: "Champion",
    subtitle: "Victory Lane",
    badgePaths: Object.freeze(["/ranks/champion-i.png", "/ranks/champion-ii.png", "/ranks/champion-iii.png"]),
    thresholds: Object.freeze([60_000_000, 100_000_000, 175_000_000]),
  }),
  Object.freeze({
    id: "hall-of-fame",
    name: "Hall of Fame",
    subtitle: "Legacy Tier",
    badgePaths: Object.freeze(["/ranks/hall-of-fame-i.png", "/ranks/hall-of-fame-ii.png", "/ranks/hall-of-fame-iii.png"]),
    thresholds: Object.freeze([250_000_000, 500_000_000, 1_000_000_000]),
  }),
]);

export const RANK_TIERS = Object.freeze(["I", "II", "III"]);

export const RANK_LEVELS = Object.freeze(
  RANK_STAGES.flatMap((stage, stageIndex) =>
    stage.thresholds.map((threshold, tierIndex) =>
      Object.freeze({
        id: `${stage.id}-${tierIndex + 1}`,
        stageId: stage.id,
        stageIndex,
        name: stage.name,
        subtitle: stage.subtitle,
        badgePath: stage.badgePaths[tierIndex],
        tier: RANK_TIERS[tierIndex],
        tierIndex,
        label: `${stage.name} ${RANK_TIERS[tierIndex]}`,
        threshold,
      }),
    ),
  ),
);

export const MAX_RANK = RANK_LEVELS[RANK_LEVELS.length - 1];

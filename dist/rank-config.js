export const RANK_STAGES = Object.freeze([
  Object.freeze({
    id: "rookie",
    name: "Rookie",
    subtitle: "Starting Grid",
    badgePaths: Object.freeze(["/ranks/rookie-i.webp", "/ranks/rookie-ii.webp", "/ranks/rookie-iii.webp"]),
    thresholds: Object.freeze([0, 1_000, 2_500]),
  }),
  Object.freeze({
    id: "street",
    name: "Street",
    subtitle: "City Circuit",
    badgePaths: Object.freeze(["/ranks/street-i.webp", "/ranks/street-ii.webp", "/ranks/street-iii.webp"]),
    thresholds: Object.freeze([5_000, 10_000, 20_000]),
  }),
  Object.freeze({
    id: "circuit",
    name: "Circuit",
    subtitle: "Track Ready",
    badgePaths: Object.freeze(["/ranks/circuit-i.webp", "/ranks/circuit-ii.webp", "/ranks/circuit-iii.webp"]),
    thresholds: Object.freeze([35_000, 50_000, 75_000]),
  }),
  Object.freeze({
    id: "turbo",
    name: "Turbo",
    subtitle: "Full Boost",
    badgePaths: Object.freeze(["/ranks/turbo-i.webp", "/ranks/turbo-ii.webp", "/ranks/turbo-iii.webp"]),
    thresholds: Object.freeze([100_000, 150_000, 225_000]),
  }),
  Object.freeze({
    id: "velocity",
    name: "Velocity",
    subtitle: "Rapid Pace",
    badgePaths: Object.freeze(["/ranks/velocity-i.webp", "/ranks/velocity-ii.webp", "/ranks/velocity-iii.webp"]),
    thresholds: Object.freeze([350_000, 500_000, 750_000]),
  }),
  Object.freeze({
    id: "hyper",
    name: "Hyper",
    subtitle: "Overdrive",
    badgePaths: Object.freeze(["/ranks/hyper-i.webp", "/ranks/hyper-ii.webp", "/ranks/hyper-iii.webp"]),
    thresholds: Object.freeze([1_000_000, 1_500_000, 2_500_000]),
  }),
  Object.freeze({
    id: "apex",
    name: "Apex",
    subtitle: "Elite Line",
    badgePaths: Object.freeze(["/ranks/apex-i.webp", "/ranks/apex-ii.webp", "/ranks/apex-iii.webp"]),
    thresholds: Object.freeze([4_000_000, 6_000_000, 10_000_000]),
  }),
  Object.freeze({
    id: "pole",
    name: "Pole",
    subtitle: "Front Row",
    badgePaths: Object.freeze(["/ranks/pole-i.webp", "/ranks/pole-ii.webp", "/ranks/pole-iii.webp"]),
    thresholds: Object.freeze([15_000_000, 25_000_000, 40_000_000]),
  }),
  Object.freeze({
    id: "champion",
    name: "Champion",
    subtitle: "Victory Lane",
    badgePaths: Object.freeze(["/ranks/champion-i.webp", "/ranks/champion-ii.webp", "/ranks/champion-iii.webp"]),
    thresholds: Object.freeze([60_000_000, 100_000_000, 175_000_000]),
  }),
  Object.freeze({
    id: "hall-of-fame",
    name: "Hall of Fame",
    subtitle: "Legacy Tier",
    badgePaths: Object.freeze(["/ranks/hall-of-fame-i.webp", "/ranks/hall-of-fame-ii.webp", "/ranks/hall-of-fame-iii.webp"]),
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

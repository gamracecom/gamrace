export const DEFAULT_LIMITS = Object.freeze({
  minimumDepositUsdCents: 100,
  maximumDepositUsdCents: 10_000_000,
});

export const ASSET_SCALE = 100_000_000;

export function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = sortObject(value[key]);
    return result;
  }, {});
}

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createIpnSignature(payload, secret) {
  if (!secret) throw new Error("IPN secret is required");
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const canonicalPayload = JSON.stringify(sortObject(payload));
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(canonicalPayload)));
}

export async function createRawHmacSignature(payload, secret) {
  if (!secret) throw new Error("HMAC secret is required");
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(String(payload ?? ""))));
}

export function signaturesMatch(received, expected) {
  if (typeof received !== "string" || typeof expected !== "string") return false;
  const left = received.trim().toLowerCase();
  const right = expected.trim().toLowerCase();
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export function parseUsdCents(value, limits = {}) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw new Error("Enter a valid amount");
  const cents = Math.round(amount * 100);
  const minimum = limits.minimumUsdCents ?? 1;
  const maximum = limits.maximumUsdCents ?? Number.MAX_SAFE_INTEGER;
  if (cents < minimum) throw new Error(`The minimum amount is $${(minimum / 100).toFixed(2)}`);
  if (cents > maximum) throw new Error(`The maximum amount is $${(maximum / 100).toFixed(2)}`);
  return cents;
}

export function normalizeCurrency(value) {
  const currency = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,20}$/.test(currency)) throw new Error("Choose a valid currency");
  return currency;
}

export function parseAssetUnits(value, options = {}) {
  const raw = String(value ?? "").trim();
  if (!/^\d+(?:\.\d{1,8})?$/.test(raw)) throw new Error("Enter a valid amount with no more than 8 decimal places");
  const [whole, fraction = ""] = raw.split(".");
  const units = Number(whole) * ASSET_SCALE + Number(fraction.padEnd(8, "0"));
  if (!Number.isSafeInteger(units) || units <= 0) throw new Error("Enter a valid amount");
  const minimumUnits = options.minimumUnits ?? 1;
  const maximumUnits = options.maximumUnits ?? Number.MAX_SAFE_INTEGER;
  if (units < minimumUnits) throw new Error("The amount is below the minimum");
  if (units > maximumUnits) throw new Error("The amount is above the maximum");
  return units;
}

export function parseNonNegativeAssetUnits(value, options = {}) {
  const raw = String(value ?? "").trim();
  if (!/^\d+(?:\.\d{1,8})?$/.test(raw)) throw new Error("Enter a valid amount with no more than 8 decimal places");
  const [whole, fraction = ""] = raw.split(".");
  const units = Number(whole) * ASSET_SCALE + Number(fraction.padEnd(8, "0"));
  const maximumUnits = options.maximumUnits ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(units) || units < 0) throw new Error("Enter a valid amount");
  if (units > maximumUnits) throw new Error("The amount is above the maximum");
  return units;
}

export function assetUnitsToString(value, trim = true) {
  const units = Number(value || 0);
  if (!Number.isSafeInteger(units) || units < 0) throw new Error("Invalid asset balance");
  const whole = Math.floor(units / ASSET_SCALE);
  const fraction = String(units % ASSET_SCALE).padStart(8, "0");
  return trim ? `${whole}.${fraction}`.replace(/\.?0+$/, "") || "0" : `${whole}.${fraction}`;
}

export function providerAmountToUnits(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const units = Math.floor((amount + Number.EPSILON) * ASSET_SCALE);
  if (!Number.isSafeInteger(units)) throw new Error("Provider amount is too large");
  return units;
}

export function hiloChoice(rankValue, directionValue, houseFactorMicrosValue = 990_000) {
  const rank = Number(rankValue);
  const direction = String(directionValue || "").toLowerCase();
  if (!Number.isInteger(rank) || rank < 1 || rank > 13) throw new Error("Invalid Hi-Lo card rank");
  if (!["higher", "lower"].includes(direction)) throw new Error("Invalid Hi-Lo direction");
  const favorableCards = direction === "higher" ? 14 - rank : rank;
  const houseFactorMicros = Number(houseFactorMicrosValue);
  if (!Number.isInteger(houseFactorMicros) || houseFactorMicros < 900_000 || houseFactorMicros > 1_000_000) throw new Error("Invalid house edge");
  const multiplierMicros = Math.floor(houseFactorMicros * 13 / favorableCards);
  return {
    favorableCards,
    chanceBasisPoints: Math.round(favorableCards / 13 * 10_000),
    multiplierMicros,
    available: multiplierMicros >= 1_000_000,
  };
}

export function hiloWins(currentRankValue, nextRankValue, directionValue) {
  const currentRank = Number(currentRankValue);
  const nextRank = Number(nextRankValue);
  const direction = String(directionValue || "").toLowerCase();
  hiloChoice(currentRank, direction);
  if (!Number.isInteger(nextRank) || nextRank < 1 || nextRank > 13) throw new Error("Invalid Hi-Lo card rank");
  return direction === "higher" ? nextRank >= currentRank : nextRank <= currentRank;
}

export function dicePayout(wagerUnits, targetBasisPoints, direction, rollBasisPoints, houseFactorMicrosValue = 990_000) {
  const wager = Number(wagerUnits);
  const target = Number(targetBasisPoints);
  const roll = Number(rollBasisPoints);
  if (!Number.isSafeInteger(wager) || wager <= 0) throw new Error("Invalid Dice wager");
  if (!Number.isInteger(target) || target < 100 || target > 9800) throw new Error("Invalid Dice target");
  if (!Number.isInteger(roll) || roll < 1 || roll > 10_000) throw new Error("Invalid Dice roll");
  if (!["over", "under"].includes(direction)) throw new Error("Invalid Dice direction");
  const chanceBasisPoints = direction === "over" ? 10_000 - target : target;
  const won = direction === "over" ? roll > target : roll < target;
  const houseFactorMicros = Number(houseFactorMicrosValue);
  if (!Number.isInteger(houseFactorMicros) || houseFactorMicros < 900_000 || houseFactorMicros > 1_000_000) throw new Error("Invalid house edge");
  const multiplierMicros = Math.floor(houseFactorMicros * 10_000 / chanceBasisPoints);
  const payoutUnits = won ? Number(BigInt(wager) * BigInt(multiplierMicros) / 1_000_000n) : 0;
  if (!Number.isSafeInteger(payoutUnits)) throw new Error("Dice payout is too large");
  return { won, chanceBasisPoints, multiplierMicros, payoutUnits };
}

function binomialCoefficient(rows, bucket) {
  const k = Math.min(bucket, rows - bucket);
  let result = 1;
  for (let index = 1; index <= k; index += 1) result = result * (rows - k + index) / index;
  return result;
}

export function plinkoMultipliers(rowsValue, riskValue, houseFactorMicrosValue = 990_000) {
  const rows = Number(rowsValue);
  const risk = String(riskValue || "").toLowerCase();
  if (!Number.isInteger(rows) || rows < 8 || rows > 16) throw new Error("Invalid Plinko row count");
  if (!["low", "medium", "high"].includes(risk)) throw new Error("Invalid Plinko risk level");
  const houseFactorMicros = Number(houseFactorMicrosValue);
  if (!Number.isInteger(houseFactorMicros) || houseFactorMicros < 900_000 || houseFactorMicros > 1_000_000) throw new Error("Invalid house edge");

  let floor;
  let edge;
  let curve;
  if (risk === "low") {
    floor = 0.72;
    edge = 5.2 + 1.1 * (rows - 8);
    curve = 4;
  } else if (risk === "medium") {
    floor = 0.42;
    edge = 12 * 1.33 ** (rows - 8);
    curve = 6;
  } else {
    floor = 0.2;
    edge = 28 * 1.56 ** (rows - 8);
    curve = 8;
  }

  const raw = Array.from({ length: rows + 1 }, (_, bucket) => {
    const edgeDistance = Math.abs((2 * bucket - rows) / rows);
    return floor + (edge - floor) * edgeDistance ** curve;
  });
  const expected = raw.reduce((total, multiplier, bucket) => (
    total + binomialCoefficient(rows, bucket) / 2 ** rows * multiplier
  ), 0);
  const scale = (houseFactorMicros / 1_000_000) / expected;
  return raw.map((multiplier) => Math.max(1, Math.floor(multiplier * scale * 1_000_000)));
}

export function plinkoPayout(wagerUnits, rowsValue, riskValue, bucketValue, houseFactorMicrosValue = 990_000) {
  const wager = Number(wagerUnits);
  const rows = Number(rowsValue);
  const bucket = Number(bucketValue);
  if (!Number.isSafeInteger(wager) || wager <= 0) throw new Error("Invalid Plinko wager");
  if (!Number.isInteger(bucket) || bucket < 0 || bucket > rows) throw new Error("Invalid Plinko bucket");
  const multiplierMicros = plinkoMultipliers(rows, riskValue, houseFactorMicrosValue)[bucket];
  const payoutUnits = payoutFromMultiplier(wager, multiplierMicros);
  return { multiplierMicros, payoutUnits, outcome: payoutUnits >= wager ? "win" : "loss" };
}

const WHEEL_SEGMENT_OPTIONS = Object.freeze([10, 20, 30, 40, 50]);
const WHEEL_LOW_PATTERN = Object.freeze([1_080_000, 1_120_000, 1_180_000, 1_070_000, 500_000]);
const WHEEL_MEDIUM_PATTERN = Object.freeze([1_500_000, 0, 1_800_000, 0, 2_400_000, 0, 1_500_000, 0, 2_700_000, 0]);

export function wheelMultipliers(segmentsValue, riskValue) {
  const segments = Number(segmentsValue);
  const risk = String(riskValue || "").toLowerCase();
  if (!WHEEL_SEGMENT_OPTIONS.includes(segments)) throw new Error("Choose 10, 20, 30, 40, or 50 Wheel segments");
  if (!['low', 'medium', 'high'].includes(risk)) throw new Error("Choose a valid Wheel risk level");
  if (risk === "low") return Array.from({ length: segments }, (_, index) => WHEEL_LOW_PATTERN[index % WHEEL_LOW_PATTERN.length]);
  if (risk === "medium") return Array.from({ length: segments }, (_, index) => WHEEL_MEDIUM_PATTERN[index % WHEEL_MEDIUM_PATTERN.length]);
  return Array.from({ length: segments }, (_, index) => index === segments - 1 ? segments * 990_000 : 0);
}

export function wheelPayout(wagerUnits, segmentsValue, riskValue, resultIndexValue, houseFactorMicrosValue = 990_000) {
  const wager = Number(wagerUnits);
  const resultIndex = Number(resultIndexValue);
  const multipliers = wheelMultipliers(segmentsValue, riskValue);
  if (!Number.isSafeInteger(wager) || wager <= 0) throw new Error("Invalid Wheel wager");
  if (!Number.isInteger(resultIndex) || resultIndex < 0 || resultIndex >= multipliers.length) throw new Error("Invalid Wheel result");
  const houseFactorMicros = Number(houseFactorMicrosValue);
  if (!Number.isInteger(houseFactorMicros) || houseFactorMicros < 900_000 || houseFactorMicros > 1_000_000) throw new Error("Invalid house edge");
  const multiplierMicros = Math.floor(multipliers[resultIndex] * houseFactorMicros / 990_000);
  const payoutUnits = payoutFromMultiplier(wager, multiplierMicros);
  return { multiplierMicros, payoutUnits, outcome: payoutUnits >= wager ? "win" : "loss" };
}

const KENO_RISK_MODELS = Object.freeze({
  easy: Object.freeze({ thresholds: Object.freeze([0, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4]), growth: 1.6 }),
  medium: Object.freeze({ thresholds: Object.freeze([0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]), growth: 3 }),
  hard: Object.freeze({ thresholds: Object.freeze([0, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6]), growth: 5 }),
  extreme: Object.freeze({ thresholds: Object.freeze([0, 1, 2, 3, 4, 4, 5, 5, 6, 6, 6]), growth: 4 }),
});

const KENO_TARGET_RTP = 0.99;
const KENO_MAX_MULTIPLIER_MICROS = 1_000_000_000;

function kenoCombinations(total, chosen) {
  if (chosen < 0 || chosen > total) return 0;
  let result = 1;
  const count = Math.min(chosen, total - chosen);
  for (let index = 1; index <= count; index += 1) result = result * (total - count + index) / index;
  return result;
}

function buildKenoPaytable(model) {
  const paytable = {};
  const totalDraws = kenoCombinations(40, 10);
  for (let selected = 1; selected <= 10; selected += 1) {
    const threshold = model.thresholds[selected];
    const outcomes = [];
    for (let hits = threshold; hits <= selected; hits += 1) {
      const probability = kenoCombinations(selected, hits) * kenoCombinations(40 - selected, 10 - hits) / totalDraws;
      outcomes.push({ hits, probability, weight: model.growth ** (hits - threshold) });
    }
    const expectedReturn = (scale) => outcomes.reduce((total, outcome) => (
      total + outcome.probability * Math.min(KENO_MAX_MULTIPLIER_MICROS, Math.floor(scale * outcome.weight * 1_000_000)) / 1_000_000
    ), 0);
    let lower = 0;
    let upper = 1;
    while (expectedReturn(upper) < KENO_TARGET_RTP && upper < 1_000_000_000) upper *= 2;
    if (expectedReturn(upper) < KENO_TARGET_RTP) throw new Error("Keno risk model cannot reach its target RTP under the maximum payout");
    for (let iteration = 0; iteration < 96; iteration += 1) {
      const middle = (lower + upper) / 2;
      if (expectedReturn(middle) < KENO_TARGET_RTP) lower = middle;
      else upper = middle;
    }
    const multipliers = {};
    for (const outcome of outcomes) {
      multipliers[outcome.hits] = Math.min(KENO_MAX_MULTIPLIER_MICROS, Math.floor(lower * outcome.weight * 1_000_000));
    }
    paytable[selected] = Object.freeze(multipliers);
  }
  return Object.freeze(paytable);
}

export const KENO_PAYTABLE_MICROS = Object.freeze(Object.fromEntries(
  Object.entries(KENO_RISK_MODELS).map(([risk, model]) => [risk, buildKenoPaytable(model)]),
));

export function kenoMultiplierMicros(selectedCountValue, hitsValue, riskValue = "medium", houseFactorMicrosValue = 990_000) {
  const selectedCount = Number(selectedCountValue);
  const hits = Number(hitsValue);
  const risk = String(riskValue || "").toLowerCase();
  if (!Number.isInteger(selectedCount) || selectedCount < 1 || selectedCount > 10) throw new Error("Choose between 1 and 10 Keno numbers");
  if (!Number.isInteger(hits) || hits < 0 || hits > selectedCount) throw new Error("Invalid Keno hit count");
  if (!Object.hasOwn(KENO_PAYTABLE_MICROS, risk)) throw new Error("Choose a valid Keno risk level");
  const houseFactorMicros = Number(houseFactorMicrosValue);
  if (!Number.isInteger(houseFactorMicros) || houseFactorMicros < 900_000 || houseFactorMicros > 1_000_000) throw new Error("Invalid house edge");
  const baseMultiplierMicros = KENO_PAYTABLE_MICROS[risk][selectedCount][hits] || 0;
  return Math.min(KENO_MAX_MULTIPLIER_MICROS, Math.floor(baseMultiplierMicros * houseFactorMicros / 990_000));
}

export function kenoPayout(wagerUnits, selectedCountValue, hitsValue, riskValue = "medium", houseFactorMicrosValue = 990_000) {
  const wager = Number(wagerUnits);
  if (!Number.isSafeInteger(wager) || wager <= 0) throw new Error("Invalid Keno wager");
  const multiplierMicros = kenoMultiplierMicros(selectedCountValue, hitsValue, riskValue, houseFactorMicrosValue);
  const payoutUnits = payoutFromMultiplier(wager, multiplierMicros);
  return { multiplierMicros, payoutUnits, outcome: payoutUnits >= wager ? "win" : "loss" };
}

export function roulettePayout(betsValue, resultValue) {
  const result = String(resultValue || "").toLowerCase();
  const multipliers = { blue: 2_000_000, cyan: 2_000_000, purple: 7_000_000, gold: 14_000_000 };
  if (!Object.hasOwn(multipliers, result)) throw new Error("Invalid Roulette result");
  if (!betsValue || typeof betsValue !== "object" || Array.isArray(betsValue)) throw new Error("Invalid Roulette bets");
  const bets = {};
  for (const [selection, value] of Object.entries(betsValue)) {
    if (!Object.hasOwn(multipliers, selection)) throw new Error("Invalid Roulette selection");
    const wager = Number(value);
    if (!Number.isSafeInteger(wager) || wager <= 0) throw new Error("Invalid Roulette wager");
    bets[selection] = wager;
  }
  const totalWagerUnits = Object.values(bets).reduce((total, wager) => total + wager, 0);
  if (!Number.isSafeInteger(totalWagerUnits) || totalWagerUnits <= 0) throw new Error("Invalid Roulette bets");
  const winningWager = bets[result] || 0;
  const payoutUnits = winningWager ? payoutFromMultiplier(winningWager, multipliers[result]) : 0;
  const multiplierMicros = Number(BigInt(payoutUnits) * 1_000_000n / BigInt(totalWagerUnits));
  return {
    won: payoutUnits >= totalWagerUnits,
    multiplierMicros,
    payoutUnits,
    totalWagerUnits,
    winningMultiplierMicros: multipliers[result],
  };
}

export function minesMultiplierMicros(mineCount, revealedCount, houseFactorMicrosValue = 990_000) {
  const mines = Number(mineCount);
  const revealed = Number(revealedCount);
  if (!Number.isInteger(mines) || mines < 1 || mines > 24) throw new Error("Invalid mine count");
  if (!Number.isInteger(revealed) || revealed < 0 || revealed > 25 - mines) throw new Error("Invalid revealed count");
  if (revealed === 0) return 1_000_000;
  let survivalProbability = 1;
  for (let pick = 0; pick < revealed; pick += 1) {
    survivalProbability *= (25 - mines - pick) / (25 - pick);
  }
  const houseFactorMicros = Number(houseFactorMicrosValue);
  if (!Number.isInteger(houseFactorMicros) || houseFactorMicros < 900_000 || houseFactorMicros > 1_000_000) throw new Error("Invalid house edge");
  return Math.max(1_000_000, Math.floor(houseFactorMicros / survivalProbability));
}

export function towersMultiplierMicros(columnsValue, trapsValue, clearedRowsValue, houseFactorMicrosValue = 990_000) {
  const columns = Number(columnsValue);
  const traps = Number(trapsValue);
  const clearedRows = Number(clearedRowsValue);
  const houseFactorMicros = Number(houseFactorMicrosValue);
  if (!Number.isInteger(columns) || columns < 2 || columns > 4) throw new Error("Invalid Towers columns");
  if (!Number.isInteger(traps) || traps < 1 || traps >= columns) throw new Error("Invalid Towers traps");
  if (!Number.isInteger(clearedRows) || clearedRows < 0 || clearedRows > 8) throw new Error("Invalid Towers level");
  if (!Number.isInteger(houseFactorMicros) || houseFactorMicros < 900_000 || houseFactorMicros > 1_000_000) throw new Error("Invalid house edge");
  if (clearedRows === 0) return 1_000_000;
  const safe = BigInt(columns - traps);
  const total = BigInt(columns);
  let numerator = BigInt(houseFactorMicros);
  let denominator = 1n;
  for (let row = 0; row < clearedRows; row += 1) {
    numerator *= total;
    denominator *= safe;
  }
  const result = numerator / denominator;
  return Number(result > 1_000_000_000_000n ? 1_000_000_000_000n : result);
}

export function coinflipMultiplierMicros(streakValue, houseFactorMicrosValue = 990_000) {
  const streak = Number(streakValue);
  const houseFactorMicros = Number(houseFactorMicrosValue);
  if (!Number.isInteger(streak) || streak < 0 || streak > 20) throw new Error("Invalid Coinflip streak");
  if (!Number.isInteger(houseFactorMicros) || houseFactorMicros < 900_000 || houseFactorMicros > 1_000_000) throw new Error("Invalid house edge");
  let multiplierMicros = 1_000_000n;
  const stepMicros = BigInt(houseFactorMicros * 2);
  for (let index = 0; index < streak; index += 1) multiplierMicros = multiplierMicros * stepMicros / 1_000_000n;
  return Number(multiplierMicros > 1_000_000_000_000n ? 1_000_000_000_000n : multiplierMicros);
}

const CRASH_MAX_MULTIPLIER_MICROS = 1_000_000_000;
const CRASH_FLIGHT_MS = 80_000;

export function crashPointMicros(drawValue, houseFactorMicrosValue = 990_000) {
  const draw = Number(drawValue);
  const houseFactorMicros = Number(houseFactorMicrosValue);
  if (!Number.isInteger(draw) || draw < 1 || draw > 1_000_000) throw new Error("Invalid Crash draw");
  if (!Number.isInteger(houseFactorMicros) || houseFactorMicros < 900_000 || houseFactorMicros > 1_000_000) throw new Error("Invalid house edge");
  return Math.min(CRASH_MAX_MULTIPLIER_MICROS, Math.max(1_000_000, Math.floor(houseFactorMicros * 1_000_000 / draw)));
}

export const LIMBO_MAX_MULTIPLIER_MICROS = 1_000_000_000_000;

export function limboResultMicros(drawValue, houseFactorMicrosValue = 990_000) {
  const draw = Number(drawValue);
  const houseFactorMicros = Number(houseFactorMicrosValue);
  if (!Number.isInteger(draw) || draw < 1 || draw > 100_000_000) throw new Error("Invalid Limbo draw");
  if (!Number.isInteger(houseFactorMicros) || houseFactorMicros < 900_000 || houseFactorMicros > 1_000_000) throw new Error("Invalid house edge");
  const raw = Math.floor(houseFactorMicros * 100_000_000 / draw / 10_000) * 10_000;
  return Math.min(LIMBO_MAX_MULTIPLIER_MICROS, Math.max(1_000_000, raw));
}

export function limboPayout(wagerUnits, targetMultiplierMicrosValue, resultMultiplierMicrosValue) {
  const wager = Number(wagerUnits);
  const targetMultiplierMicros = Number(targetMultiplierMicrosValue);
  const resultMultiplierMicros = Number(resultMultiplierMicrosValue);
  if (!Number.isSafeInteger(wager) || wager <= 0) throw new Error("Invalid Limbo wager");
  if (!Number.isSafeInteger(targetMultiplierMicros) || targetMultiplierMicros < 1_010_000 || targetMultiplierMicros > LIMBO_MAX_MULTIPLIER_MICROS) throw new Error("Choose a Limbo target between 1.01x and 1,000,000x");
  if (!Number.isSafeInteger(resultMultiplierMicros) || resultMultiplierMicros < 1_000_000 || resultMultiplierMicros > LIMBO_MAX_MULTIPLIER_MICROS) throw new Error("Invalid Limbo result");
  const won = resultMultiplierMicros >= targetMultiplierMicros;
  const multiplierMicros = won ? targetMultiplierMicros : 0;
  return { won, multiplierMicros, payoutUnits: won ? payoutFromMultiplier(wager, targetMultiplierMicros) : 0 };
}

export function crashDurationMs(multiplierMicrosValue) {
  const multiplierMicros = Number(multiplierMicrosValue);
  if (!Number.isSafeInteger(multiplierMicros) || multiplierMicros < 1_000_000 || multiplierMicros > CRASH_MAX_MULTIPLIER_MICROS) throw new Error("Invalid Crash multiplier");
  return Math.max(0, Math.min(CRASH_FLIGHT_MS, Math.round(Math.log(multiplierMicros / 1_000_000) / Math.log(1000) * CRASH_FLIGHT_MS)));
}

export function crashMultiplierMicros(elapsedMsValue) {
  const elapsedMs = Number(elapsedMsValue);
  if (!Number.isFinite(elapsedMs)) throw new Error("Invalid Crash elapsed time");
  if (elapsedMs >= CRASH_FLIGHT_MS) return CRASH_MAX_MULTIPLIER_MICROS;
  const progress = Math.max(0, Math.min(1, elapsedMs / CRASH_FLIGHT_MS));
  return Math.min(CRASH_MAX_MULTIPLIER_MICROS, Math.max(1_000_000, Math.floor(Math.exp(Math.log(1000) * progress) * 1_000_000)));
}

export function payoutFromMultiplier(wagerUnits, multiplierMicros) {
  const wager = Number(wagerUnits);
  const multiplier = Number(multiplierMicros);
  if (!Number.isSafeInteger(wager) || wager <= 0 || !Number.isSafeInteger(multiplier) || multiplier < 0) throw new Error("Invalid game payout");
  const payout = Number(BigInt(wager) * BigInt(multiplier) / 1_000_000n);
  if (!Number.isSafeInteger(payout)) throw new Error("Game payout is too large");
  return payout;
}

export function blackjackHandValue(cardsValue) {
  const cards = Array.isArray(cardsValue) ? cardsValue : [];
  let total = 0;
  let aces = 0;
  for (const cardIdValue of cards) {
    const cardId = Number(cardIdValue);
    if (!Number.isInteger(cardId) || cardId < 0 || cardId >= 312) throw new Error("Invalid Blackjack card");
    const rank = cardId % 13;
    if (rank === 0) { total += 11; aces += 1; }
    else total += rank >= 9 ? 10 : rank + 1;
  }
  while (total > 21 && aces > 0) { total -= 10; aces -= 1; }
  return { total, soft: aces > 0, blackjack: cards.length === 2 && total === 21, bust: total > 21 };
}

function blackjackSideCard(cardIdValue) {
  const cardId = Number(cardIdValue);
  if (!Number.isInteger(cardId) || cardId < 0 || cardId >= 312) throw new Error("Invalid Blackjack card");
  const rank = cardId % 13;
  const suit = Math.floor(cardId / 13) % 4;
  return { rank, suit, colour: suit === 1 || suit === 2 ? "red" : "black" };
}

export function blackjackSideBetResults(playerCardsValue, dealerUpCardValue) {
  const playerCards = Array.isArray(playerCardsValue) ? playerCardsValue : [];
  if (playerCards.length !== 2) throw new Error("Side bets require two player cards");
  const [first, second] = playerCards.map(blackjackSideCard);
  const dealer = blackjackSideCard(dealerUpCardValue);

  let perfectPairs = { result: "none", multiplierMicros: 0 };
  if (first.rank === second.rank) {
    if (first.suit === second.suit) perfectPairs = { result: "perfect-pair", multiplierMicros: 26_000_000 };
    else if (first.colour === second.colour) perfectPairs = { result: "coloured-pair", multiplierMicros: 13_000_000 };
    else perfectPairs = { result: "mixed-pair", multiplierMicros: 7_000_000 };
  }

  const cards = [first, second, dealer];
  const ranks = cards.map((card) => card.rank).sort((left, right) => left - right);
  const suited = cards.every((card) => card.suit === cards[0].suit);
  const sameRank = ranks[0] === ranks[2];
  const uniqueRanks = new Set(ranks).size === 3;
  const straight = uniqueRanks && (
    (ranks[2] - ranks[0] === 2 && ranks[1] - ranks[0] === 1)
    || (ranks[0] === 0 && ranks[1] === 1 && ranks[2] === 2)
    || (ranks[0] === 0 && ranks[1] === 11 && ranks[2] === 12)
  );
  let twentyOnePlusThree = { result: "none", multiplierMicros: 0 };
  if (sameRank && suited) twentyOnePlusThree = { result: "suited-trips", multiplierMicros: 101_000_000 };
  else if (straight && suited) twentyOnePlusThree = { result: "straight-flush", multiplierMicros: 41_000_000 };
  else if (sameRank) twentyOnePlusThree = { result: "three-of-a-kind", multiplierMicros: 31_000_000 };
  else if (straight) twentyOnePlusThree = { result: "straight", multiplierMicros: 11_000_000 };
  else if (suited) twentyOnePlusThree = { result: "flush", multiplierMicros: 6_000_000 };
  return { perfectPairs, twentyOnePlusThree };
}

export function normalizeAddress(value) {
  const address = String(value || "").trim();
  if (address.length < 10 || address.length > 256 || /\s/.test(address)) throw new Error("Enter a valid wallet address");
  return address;
}

export function normalizeExtraId(value) {
  const extraId = String(value || "").trim();
  if (extraId.length > 128) throw new Error("Memo or tag is too long");
  return extraId;
}

export function normalizeRequestId(value) {
  const requestId = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{12,80}$/.test(requestId)) throw new Error("Invalid request identifier");
  return requestId;
}

export function maskAddress(value) {
  const address = String(value || "");
  if (address.length < 14) return address;
  return `${address.slice(0, 7)}…${address.slice(-6)}`;
}

export function paymentCanCredit(status) {
  return String(status || "").toLowerCase() === "finished";
}

export function paymentIsTerminal(status) {
  return ["finished", "failed", "refunded", "expired"].includes(String(status || "").toLowerCase());
}

export function oxaDepositStatus(status, transactionStatus = "") {
  const payment = String(status || "").toLowerCase();
  const transaction = String(transactionStatus || "").toLowerCase();
  if (payment === "paid" && ["", "confirmed", "complete", "completed"].includes(transaction)) return "finished";
  if (["failed", "expired", "refunded", "canceled", "cancelled"].includes(payment)) return payment === "canceled" ? "cancelled" : payment;
  return "confirming";
}

export function oxaPayoutStatus(status) {
  const normalized = String(status || "").toLowerCase();
  if (["confirmed", "complete", "completed"].includes(normalized)) return "finished";
  if (["canceled", "cancelled", "rejected", "failed"].includes(normalized)) return normalized === "canceled" ? "cancelled" : normalized;
  return "processing";
}

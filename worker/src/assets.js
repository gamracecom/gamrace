export const WALLET_ASSETS = Object.freeze([
  { code: "usdterc20", symbol: "USDT", name: "Tether", network: "Ethereum (ERC20)", icon: "usdt" },
  { code: "usdttrc20", symbol: "USDT", name: "Tether", network: "Tron (TRC20)", icon: "usdt" },
  { code: "btc", symbol: "BTC", name: "Bitcoin", network: "Bitcoin", icon: "btc" },
  { code: "eth", symbol: "ETH", name: "Ethereum", network: "Ethereum", icon: "eth" },
  { code: "usdc", symbol: "USDC", name: "USD Coin", network: "Ethereum (ERC20)", icon: "usdc" },
  { code: "sol", symbol: "SOL", name: "Solana", network: "Solana", icon: "sol" },
  { code: "trx", symbol: "TRX", name: "TRON", network: "Tron", icon: "trx" },
  { code: "ltc", symbol: "LTC", name: "Litecoin", network: "Litecoin", icon: "ltc" },
  { code: "doge", symbol: "DOGE", name: "Dogecoin", network: "Dogecoin", icon: "doge" },
  { code: "xrp", symbol: "XRP", name: "XRP", network: "XRP Ledger", icon: "xrp", requiresExtraId: true },
  { code: "bnbbsc", symbol: "BNB", name: "BNB", network: "BNB Smart Chain (BEP20)", icon: "bnb" },
]);

export const DEFAULT_WALLET_ASSET = "usdttrc20";

const ASSETS_BY_CODE = new Map(WALLET_ASSETS.map((asset) => [asset.code, asset]));

export function getWalletAsset(code) {
  return ASSETS_BY_CODE.get(String(code || "").trim().toLowerCase()) || null;
}

export function requireWalletAsset(code) {
  const asset = getWalletAsset(code);
  if (!asset) throw new Error("Choose a supported currency and network");
  return asset;
}

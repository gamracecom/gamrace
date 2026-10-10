export const WALLET_ASSETS = Object.freeze([
  { code: "usdttrc20", symbol: "USDT", name: "Tether", network: "Tron (TRC20)", icon: "usdt", providerCurrency: "USDT", providerNetwork: "Tron", providerNetworkAliases: ["Tron", "Tron Network", "TRC20", "TRX"] },
  { code: "usdtbep20", symbol: "USDT", name: "Tether", network: "BNB Smart Chain (BEP20)", icon: "usdt", providerCurrency: "USDT", providerNetwork: "BSC", providerNetworkAliases: ["BSC", "Binance Smart Chain", "BEP20", "BNB", "Binance"] },
  { code: "usdtsol", symbol: "USDT", name: "Tether", network: "Solana", icon: "usdt", providerCurrency: "USDT", providerNetwork: "Solana", providerNetworkAliases: ["Solana", "Solana Network", "SOL"] },
  { code: "usdtpolygon", symbol: "USDT", name: "Tether", network: "Polygon", icon: "usdt", providerCurrency: "USDT", providerNetwork: "Polygon", providerNetworkAliases: ["Polygon", "Polygon Network", "POL"] },
  { code: "usdterc20", symbol: "USDT", name: "Tether", network: "Ethereum (ERC20)", icon: "usdt", providerCurrency: "USDT", providerNetwork: "Ethereum", providerNetworkAliases: ["Ethereum", "Ethereum Network", "ERC20", "ETH"] },
  { code: "btc", symbol: "BTC", name: "Bitcoin", network: "Bitcoin", icon: "btc", providerCurrency: "BTC", providerNetwork: "Bitcoin", providerNetworkAliases: ["Bitcoin", "Bitcoin Network", "BTC"] },
  { code: "eth", symbol: "ETH", name: "Ethereum", network: "Ethereum", icon: "eth", providerCurrency: "ETH", providerNetwork: "Ethereum", providerNetworkAliases: ["Ethereum", "Ethereum Network", "ERC20", "ETH"] },
  { code: "usdcsol", symbol: "USDC", name: "USD Coin", network: "Solana", icon: "usdc", providerCurrency: "USDC", providerNetwork: "Solana", providerNetworkAliases: ["Solana", "Solana Network", "SOL"] },
  { code: "usdcpolygon", symbol: "USDC", name: "USD Coin", network: "Polygon", icon: "usdc", providerCurrency: "USDC", providerNetwork: "Polygon", providerNetworkAliases: ["Polygon", "Polygon Network", "POL"] },
  { code: "usdcbase", symbol: "USDC", name: "USD Coin", network: "Base", icon: "usdc", providerCurrency: "USDC", providerNetwork: "Base", providerNetworkAliases: ["Base", "Base Network"] },
  { code: "usdcbep20", symbol: "USDC", name: "USD Coin", network: "BNB Smart Chain (BEP20)", icon: "usdc", providerCurrency: "USDC", providerNetwork: "BSC", providerNetworkAliases: ["BSC", "Binance Smart Chain", "BEP20", "BNB", "Binance"] },
  { code: "usdc", symbol: "USDC", name: "USD Coin", network: "Ethereum (ERC20)", icon: "usdc", providerCurrency: "USDC", providerNetwork: "Ethereum", providerNetworkAliases: ["Ethereum", "Ethereum Network", "ERC20", "ETH"] },
  { code: "sol", symbol: "SOL", name: "Solana", network: "Solana", icon: "sol", providerCurrency: "SOL", providerNetwork: "Solana", providerNetworkAliases: ["Solana", "Solana Network", "SOL"] },
  { code: "trx", symbol: "TRX", name: "TRON", network: "Tron", icon: "trx", providerCurrency: "TRX", providerNetwork: "Tron", providerNetworkAliases: ["Tron", "Tron Network", "TRC20", "TRX"] },
  { code: "ltc", symbol: "LTC", name: "Litecoin", network: "Litecoin", icon: "ltc", providerCurrency: "LTC", providerNetwork: "Litecoin", providerNetworkAliases: ["Litecoin", "Litecoin Network", "LTC"] },
  { code: "doge", symbol: "DOGE", name: "Dogecoin", network: "Dogecoin", icon: "doge", providerCurrency: "DOGE", providerNetwork: "Dogecoin", providerNetworkAliases: ["Dogecoin", "Dogecoin Network", "DOGE"] },
  { code: "xrp", symbol: "XRP", name: "XRP", network: "XRP Ledger", icon: "xrp", requiresExtraId: true, providerCurrency: "XRP", providerNetwork: "xrpl", providerNetworkAliases: ["xrpl", "Ripple", "XRP", "XRP Ledger"] },
  { code: "bnbbsc", symbol: "BNB", name: "BNB", network: "BNB Smart Chain (BEP20)", icon: "bnb", providerCurrency: "BNB", providerNetwork: "BSC", providerNetworkAliases: ["BSC", "Binance Smart Chain", "BEP20", "BNB", "Binance"] },
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

export function getWalletAssetByProvider(currency, network) {
  const symbol = String(currency || "").trim().toUpperCase();
  const providerNetwork = String(network || "").trim().toLowerCase();
  const matches = WALLET_ASSETS.filter((asset) => asset.providerCurrency === symbol);
  if (!matches.length) return null;
  if (!providerNetwork && matches.length === 1) return matches[0];
  return matches.find((asset) => asset.providerNetworkAliases.some((alias) => alias.toLowerCase() === providerNetwork)) || null;
}

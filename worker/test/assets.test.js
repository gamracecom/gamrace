import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_WALLET_ASSET, WALLET_ASSETS, getWalletAsset, getWalletAssetByProvider, requireWalletAsset } from "../src/assets.js";

test("wallet asset configuration contains the approved coin and network pairs", () => {
  assert.deepEqual(WALLET_ASSETS.map((asset) => asset.code), [
    "usdttrc20", "usdtbep20", "usdtsol", "usdtpolygon", "usdterc20",
    "btc", "eth", "usdcsol", "usdcpolygon", "usdcbase", "usdcbep20", "usdc",
    "sol", "trx", "ltc", "doge", "xrp", "bnbbsc",
  ]);
  assert.equal(DEFAULT_WALLET_ASSET, "usdttrc20");
  assert.equal(new Set(WALLET_ASSETS.map((asset) => asset.code)).size, WALLET_ASSETS.length);
  assert.equal(WALLET_ASSETS.filter((asset) => asset.symbol === "USDT").length, 5);
  assert.equal(WALLET_ASSETS.filter((asset) => asset.symbol === "USDC").length, 5);
  assert.equal(getWalletAsset(" USDTTRC20 ").network, "Tron (TRC20)");
  assert.equal(requireWalletAsset("bnbbsc").symbol, "BNB");
  assert.equal(getWalletAssetByProvider("USDT", "Tron Network").code, "usdttrc20");
  assert.equal(getWalletAssetByProvider("usdt", "ERC20").code, "usdterc20");
  assert.equal(getWalletAssetByProvider("XRP", "Ripple").code, "xrp");
  assert.equal(getWalletAssetByProvider("BTC", "Bitcoin").code, "btc");
  assert.equal(getWalletAssetByProvider("USDT", "Solana").code, "usdtsol");
  assert.equal(getWalletAssetByProvider("USDC", "Base Network").code, "usdcbase");
  assert.throws(() => requireWalletAsset("usdcarbitrum"), /supported currency/);
});

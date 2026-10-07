import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_WALLET_ASSET, WALLET_ASSETS, getWalletAsset, requireWalletAsset } from "../src/assets.js";

test("wallet asset configuration contains the approved coin and network pairs", () => {
  assert.deepEqual(WALLET_ASSETS.map((asset) => asset.code), [
    "usdterc20", "usdttrc20", "btc", "eth", "usdc", "sol", "trx", "ltc", "doge", "xrp", "bnbbsc",
  ]);
  assert.equal(DEFAULT_WALLET_ASSET, "usdttrc20");
  assert.equal(getWalletAsset(" USDTTRC20 ").network, "Tron (TRC20)");
  assert.equal(requireWalletAsset("bnbbsc").symbol, "BNB");
  assert.throws(() => requireWalletAsset("usdtsol"), /supported currency/);
});

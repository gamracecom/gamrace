# GamRace live wallet setup (OxaPay)

The active wallet backend runs on Cloudflare Workers and D1. Firebase Authentication identifies the signed-in player; OxaPay is called only from the Worker. The browser never receives an OxaPay key or account credential.

Production API:

```text
https://gamrace-wallet-api.gamracecom.workers.dev
```

Health check:

```text
https://gamrace-wallet-api.gamracecom.workers.dev/health
```

The integration uses OxaPay's live v1 API. There is no sandbox, fake payment provider, or fake-balance fallback.

## Required Worker secrets

Create a Merchant API key and a Payout API key in OxaPay. Never put either key in source code, chat, screenshots, command arguments, or Git. From the `worker` directory, let Wrangler ask for each value in its private interactive prompt:

```text
wrangler secret put OXAPAY_MERCHANT_API_KEY
wrangler secret put OXAPAY_PAYOUT_API_KEY
wrangler secret put OWNER_FIREBASE_UID
```

The owner UID and existing admin password remain separate owner-only controls. No JWT token is required for this OxaPay integration.

The old `NOWPAYMENTS_API_KEY` and `NOWPAYMENTS_IPN_SECRET` secrets are no longer read by the Worker. Remove them only after OxaPay has been tested successfully.

## Deploy order

Apply the idempotent D1 schema first, then deploy the Worker:

```text
wrangler d1 execute gamrace-wallet --remote --file schema.sql
wrangler deploy
```

The Worker supplies these callback URLs when it creates each address or payout:

```text
https://gamrace-wallet-api.gamracecom.workers.dev/webhooks/oxapay/deposit
https://gamrace-wallet-api.gamracecom.workers.dev/webhooks/oxapay/payout
```

OxaPay signs deposit callbacks with the Merchant API key and payout callbacks with the Payout API key. The Worker verifies the HMAC-SHA512 signature against the exact raw body and credits only a final `Paid` / confirmed transaction.

## Supported balances and networks

Every coin/network pair is a separate eight-decimal GamRace balance:

- USDT: Tron (TRC20), BNB Smart Chain (BEP20), Solana, Polygon, Ethereum (ERC20)
- BTC: Bitcoin
- ETH: Ethereum
- USDC: Solana, Polygon, Base, BNB Smart Chain (BEP20), Ethereum (ERC20)
- SOL: Solana
- LTC: Litecoin
- TRX: Tron
- XRP: XRP Ledger (`xrpl`, destination tag supported)
- DOGE: Dogecoin
- BNB: BNB Smart Chain (BEP20)

The `/currencies` response is filtered against OxaPay's current live currency and network list. Minimum deposits, minimum withdrawals, and withdrawal fees come from OxaPay's current network rules instead of hard-coded USD minimums.

## Deposit flow

- The Worker creates one OxaPay static address for each player and selected coin/network pair, saves it in D1, and returns it on every future visit.
- The browser renders the saved address and QR immediately.
- Static-address conversion is disabled, so a received coin remains that coin.
- A signed webhook transaction is deduplicated by OxaPay track ID and blockchain transaction hash.
- The credited amount is OxaPay's confirmed `received_amount`, keeping the internal player liability aligned with funds actually received after fees.
- Database triggers, not browser code, perform the one-time balance credit.

OxaPay may revoke a static address with no transactions for six months. Before launch, add a maintenance path for revocation/replacement if inactive accounts will be kept longer than that.

## Withdrawal flow

- A player can withdraw only the currently selected coin/network balance.
- The Worker checks OxaPay's live minimum before accepting the request.
- D1 atomically moves the requested amount from available to held.
- The request enters the owner-only review queue.
- `Approve & send` creates the real OxaPay payout. The held balance is settled only after OxaPay reports `Confirmed`.
- Rejecting a pending request releases the held balance.
- If submission has an ambiguous network failure, the request is marked `submission_unknown`; do not retry it until the OxaPay dashboard is checked, because a blind retry could create a duplicate payout.

The current accounting sends the player's requested amount and treats OxaPay's withdrawal fee as an operator cost. Decide and implement a player-fee policy before launch if GamRace should deduct those fees instead.

If IP allowlisting is enabled for the Payout API key, remember that ordinary Cloudflare Workers do not have a fixed outbound IP. Do not enable an allowlist that blocks the Worker unless fixed egress is added.

## Launch checks

1. Enable all required coins and networks in OxaPay Merchant Service.
2. Add both OxaPay Worker secrets through Wrangler's hidden prompts.
3. Apply `schema.sql`, deploy the Worker, and confirm `/health` says `oxapay`.
4. Create every static address and compare its network in OxaPay.
5. Test a small real deposit on every enabled network.
6. Test duplicate callbacks, invalid HMACs, wrong networks, XRP tags, and confirmed-credit idempotency.
7. Test approved, rejected, failed, and ambiguous payout submissions.
8. Reconcile D1 balances, OxaPay balances, fees, and blockchain transactions.
9. Keep wagering disabled until bets and outcomes mutate balances only through an authoritative server.

The previous Firebase Functions implementation remains in the repository as a reference only. The live site targets the Cloudflare Worker and does not require the Firebase Blaze plan.

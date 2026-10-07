# GamRace live wallet setup

The active wallet backend runs on Cloudflare Workers and D1, while Firebase
Authentication continues to identify signed-in GamRace users. NOWPayments is
called only from the Worker. The browser never receives the merchant API key,
IPN secret or account credentials.

Production API base:

```text
https://gamrace-wallet-api.junglebloxofficial.workers.dev
```

Health check:

```text
https://gamrace-wallet-api.junglebloxofficial.workers.dev/health
```

The Worker always calls `https://api.nowpayments.io/v1`. There is no sandbox,
test-provider or fake-balance fallback in this implementation.

## Secrets to add after creating the replacement credentials

Never paste a live secret into source code, chat, screenshots, a command-line
argument or a Git commit. From the `worker` directory, run each command and
paste the value only when Wrangler displays its private interactive prompt:

```text
wrangler secret put NOWPAYMENTS_API_KEY
wrangler secret put NOWPAYMENTS_IPN_SECRET
wrangler secret put OWNER_FIREBASE_UID
```

`OWNER_FIREBASE_UID` is the Firebase Authentication UID for the Emperor
account. It is used by the owner-only withdrawal review routes. A NOWPayments
JWT is not required for deposits or for the current manual-review withdrawal
flow.

After the three secrets are present, deploy from `worker`:

```text
wrangler deploy
```

In NOWPayments, configure the payment notification/IPN callback as:

```text
https://gamrace-wallet-api.junglebloxofficial.workers.dev/ipn/deposit
```

The IPN secret configured at NOWPayments must exactly match the encrypted
`NOWPAYMENTS_IPN_SECRET` Worker secret.

## Security model

- Firebase ID tokens are verified with Google's current public signing keys.
- Requests from browsers are restricted to GamRace and the documented local
  development origins.
- Money is stored as integer USD cents in D1.
- A deposit credits exactly once and only after a signed IPN is re-fetched from
  the live NOWPayments API and reports `finished`.
- Duplicate deposit and withdrawal submissions are idempotent.
- Withdrawal requests atomically move funds from available to held balance.
- Completing a reviewed withdrawal consumes held funds; rejecting it returns
  the funds to available balance.
- The ledger and database triggers, rather than browser code, perform every
  balance mutation.
- Provider errors and server logs never include secret values.

## Withdrawals

NOWPayments wallet and IP allowlisting should remain enabled. Cloudflare
Workers do not provide a fixed outbound IP, so automated payout submission must
not be enabled from this Worker while the NOWPayments account requires an IP
allowlist. The current production-safe flow accepts and validates a real
withdrawal request, reserves the player's funds, and places it in owner review.
The owner sends the payout from the NOWPayments dashboard and records its real
provider reference through the owner-only completion endpoint. A rejection
releases the held balance.

This is not a mock or sandbox withdrawal: it is a live request and real balance
hold, with the final provider payout intentionally requiring owner approval.
Automated payouts can be added later behind fixed egress without changing the
player wallet or ledger model.

## Launch checks

Before giving users access:

1. Create and install the replacement API key and a new IPN secret.
2. Set the Emperor Firebase UID as the owner secret.
3. Test a small real deposit for every enabled asset and network.
4. Test invalid signatures, duplicate IPNs, underpayments, expired payments,
   memo/tag currencies, rejected withdrawals and reconciliation.
5. Confirm the NOWPayments destination wallets and allowlists.
6. Keep wagering disabled until bets, outcomes and balance changes are handled
   by an authoritative server rather than browser JavaScript.

The previous Firebase Functions implementation remains in the repository as a
reference, but the site wallet now targets the Cloudflare Worker above and does
not require the Firebase Blaze plan.

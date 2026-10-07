# GamRace live wallet setup

The wallet backend uses Firebase Authentication, Cloud Functions, Firestore and
NOWPayments. Browser code never receives the merchant API key, IPN secret or
NOWPayments account credentials.

## External account setup

1. Verify the NOWPayments account email and enable authenticator-app 2FA.
2. Complete the merchant profile accurately for `gamrace.com` and iGaming.
3. Add the business-controlled outcome wallet in NOWPayments Store Settings.
4. Enable Custody/Payouts and note whether NOWPayments requires a fixed IP
   allowlist for this account.
5. Generate a merchant API key.
6. Generate the IPN secret only when ready to enter it into Firebase Secret
   Manager; NOWPayments displays it once.

Never place secret values in this repository, browser JavaScript, GitHub
Actions variables that are exposed to builds, screenshots, chat or support
tickets.

## Firebase prerequisites

Cloud Functions requires the Firebase project to use the Blaze plan. The
Cloud Functions, Cloud Build, Artifact Registry and Secret Manager APIs must be
enabled. If the NOWPayments payout allowlist requires a fixed source IP, route
the payout function through a VPC connector and Cloud NAT before enabling live
payout approval.

Set secrets using the Firebase CLI prompts so values are not written to shell
history:

```text
firebase functions:secrets:set NOWPAYMENTS_API_KEY
firebase functions:secrets:set NOWPAYMENTS_IPN_SECRET
firebase functions:secrets:set NOWPAYMENTS_EMAIL
firebase functions:secrets:set NOWPAYMENTS_PASSWORD
```

The account password is needed only by the owner-only payout function because
NOWPayments exchanges it for a short-lived JWT. The six-digit 2FA code is never
stored. It is entered during owner approval and is sent directly to the payout
verification endpoint.

## Wallet model

- `wallets/{uid}` stores integer USD cents for available and held balances.
- `wallets/{uid}/ledger/*` is the append-only balance audit trail.
- `deposits/{paymentId}` stores provider deposit state and the idempotent credit
  marker.
- `withdrawals/{uid_requestId}` stores the withdrawal lifecycle.
- Direct Firestore reads/writes are denied to browsers; all changes use the
  authenticated backend.

Deposits credit exactly once only after a signed IPN is re-checked against the
NOWPayments API and the provider reports `finished`. Withdrawal requests move
funds from available to held. A payout that finishes consumes the held funds;
a failed, rejected or cancelled payout releases them.

## Deployment order

1. Configure the four Firebase secrets.
2. Deploy Cloud Functions and Firestore rules.
3. Set the owner custom claim on the Emperor Firebase account.
4. Test a small real deposit through every configured asset/network.
5. Test invalid signatures, duplicate IPNs, underpayments, expired payments,
   failed payouts, memo/tag assets and balance reconciliation.
6. Only then publish the wallet-enabled frontend.

# GamRace owner control room

The admin UI is served at `/admin.html`. Its data and actions are protected by two independent checks:

1. The signed-in Firebase UID must match the Worker's `OWNER_FIREBASE_UID` secret.
2. The owner must enter the separate password stored in the Worker's `ADMIN_PANEL_PASSWORD` secret.

The password is never included in the site source, browser bundle, D1 database, logs, or audit records. Successful login creates a signed, owner-bound session that is kept in the browser's `sessionStorage` and expires automatically.

## Configure the password

In Cloudflare, open **Workers & Pages → gamrace-wallet-api → Settings → Variables and Secrets** and add:

- Type: **Secret**
- Name: `ADMIN_PANEL_PASSWORD`
- Value: the owner's chosen password (at least 12 characters; a unique passphrase is recommended)

Changing this secret immediately invalidates every existing admin session. To invalidate sessions without changing the password, increment the non-secret `ADMIN_SESSION_VERSION` variable and redeploy.

## Security behavior

- Five incorrect password attempts lock admin login for 15 minutes.
- Sessions expire after four hours by default (`ADMIN_SESSION_TTL_MINUTES`).
- Owner sign-ins and withdrawal decisions are written to `admin_audit_log`.
- Withdrawal funds remain held until a request is completed or rejected.
- Provider credentials and secret values are never returned by admin API responses.


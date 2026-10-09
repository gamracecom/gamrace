import assert from "node:assert/strict";
import test from "node:test";
import {
  createAdminSessionToken,
  verifyAdminPassword,
  verifyAdminSessionToken,
} from "../src/admin-auth.js";

test("admin password comparison accepts only the configured password", async () => {
  assert.equal(await verifyAdminPassword("correct horse battery staple", "correct horse battery staple"), true);
  assert.equal(await verifyAdminPassword("wrong", "correct horse battery staple"), false);
  assert.equal(await verifyAdminPassword("", "correct horse battery staple"), false);
});

test("admin sessions are owner-bound, signed and time limited", async () => {
  const nowMs = Date.UTC(2026, 9, 9, 12, 0, 0);
  const created = await createAdminSessionToken({
    uid: "owner-uid",
    secret: "a long admin password",
    nowMs,
    ttlMs: 60_000,
    version: "2",
  });
  const valid = await verifyAdminSessionToken(created.token, {
    uid: "owner-uid",
    secret: "a long admin password",
    nowMs: nowMs + 30_000,
    version: "2",
  });
  assert.equal(valid.sub, "owner-uid");
  assert.equal(valid.ver, "2");
  assert.equal(await verifyAdminSessionToken(created.token, {
    uid: "different-owner",
    secret: "a long admin password",
    nowMs: nowMs + 30_000,
    version: "2",
  }), null);
  assert.equal(await verifyAdminSessionToken(created.token, {
    uid: "owner-uid",
    secret: "wrong secret",
    nowMs: nowMs + 30_000,
    version: "2",
  }), null);
  assert.equal(await verifyAdminSessionToken(created.token, {
    uid: "owner-uid",
    secret: "a long admin password",
    nowMs: nowMs + 61_000,
    version: "2",
  }), null);
});

test("changing the admin session version invalidates existing sessions", async () => {
  const created = await createAdminSessionToken({ uid: "owner-uid", secret: "password", version: "1" });
  assert.equal(await verifyAdminSessionToken(created.token, {
    uid: "owner-uid",
    secret: "password",
    version: "2",
  }), null);
});


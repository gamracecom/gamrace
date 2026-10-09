import test from "node:test";
import assert from "node:assert/strict";
import { PROFILE_MENU, SETTINGS_SECTIONS } from "../dist/profile-config.js";

test("profile menu uses unique ids and keeps log out behind a divider", () => {
  assert.equal(new Set(PROFILE_MENU.map((item) => item.id)).size, PROFILE_MENU.length);
  assert.equal(PROFILE_MENU.at(-1).id, "logout");
  assert.equal(PROFILE_MENU.at(-1).dividerBefore, true);
});

test("control panel is explicitly owner-only", () => {
  const controlPanel = PROFILE_MENU.find((item) => item.id === "control-panel");
  assert.equal(controlPanel.ownerOnly, true);
});

test("settings contains the complete seven-section structure", () => {
  assert.deepEqual(
    SETTINGS_SECTIONS.map((section) => section.id),
    ["account", "verification", "security", "sessions", "notifications", "privacy", "responsible-play"],
  );
});

import { describe, expect, it } from "vitest";
import { hasLevel, NO_PERMISSIONS, parsePermissions, ROLE_PRESETS } from "./permissions.js";

const role = (name: string) => {
  const preset = ROLE_PRESETS.find((r) => r.name === name);
  if (!preset) throw new Error(`Missing preset ${name}`);
  return preset.permissions;
};

describe("permissions", () => {
  it("every preset is a valid permissions object", () => {
    for (const preset of ROLE_PRESETS) {
      expect(parsePermissions(preset.permissions)).toEqual(preset.permissions);
    }
  });

  it("compares levels in order none < view < edit < full", () => {
    const owner = role("Owner");
    expect(hasLevel(owner, "team", "full")).toBe(true);
    expect(hasLevel(role("Validator"), "cases", "edit")).toBe(true);
    expect(hasLevel(role("Validator"), "cases", "full")).toBe(false);
    expect(hasLevel(NO_PERMISSIONS, "clients", "view")).toBe(false);
    expect(hasLevel(NO_PERMISSIONS, "clients", "none")).toBe(true);
  });

  it("a runner can close cases but not edit them", () => {
    const runner = role("Runner");
    expect(hasLevel(runner, "cases", "edit")).toBe(false);
    expect(runner.markSubmitted).toBe(true);
    expect(runner.approvePacks).toBe(false);
  });

  it("the assistant can never approve, submit or manage the team", () => {
    const assistant = role("Assistant (MCP)");
    expect(assistant.approvePacks).toBe(false);
    expect(assistant.markSubmitted).toBe(false);
    expect(hasLevel(assistant, "team", "view")).toBe(false);
    expect(hasLevel(assistant, "clients", "full")).toBe(false);
  });

  it("rejects malformed permission JSON", () => {
    expect(() => parsePermissions({ ...NO_PERMISSIONS, cases: "admin" })).toThrow();
    expect(() => parsePermissions({ clients: "full" })).toThrow();
  });
});

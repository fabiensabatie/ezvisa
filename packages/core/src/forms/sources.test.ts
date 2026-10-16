import { describe, expect, it } from "vitest";
import { formatValue } from "./sources.js";

describe("form formats", () => {
  it("writes dates whole or in the parts a form splits them into", () => {
    expect(formatValue("2026-10-16", "date")).toBe("16/10/2026");
    expect(formatValue("2026-10-16", "date-be")).toBe("16/10/2569");
    expect(formatValue("2026-10-16", "date-long")).toBe("16 October 2026");
    expect(formatValue("2026-10-16", "day")).toBe("16");
    expect(formatValue("2026-10-16", "month")).toBe("October");
    expect(formatValue("2026-10-16", "year")).toBe("2026");
    expect(formatValue("2026-10-16", "year-be")).toBe("2569");
  });

  it("leaves anything else as written", () => {
    expect(formatValue("16", "day")).toBe("16");
    expect(formatValue("July", "month")).toBe("July");
    expect(formatValue("maupas", "upper")).toBe("MAUPAS");
  });
});

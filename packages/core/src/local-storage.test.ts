import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LocalDiskStorage } from "./local-storage.js";

const storage = () =>
  new LocalDiskStorage(mkdtempSync(join(tmpdir(), "ezvisa-store-")), "http://localhost:3000/");

describe("LocalDiskStorage", () => {
  it("stores, sizes, reads and deletes objects", async () => {
    const s = storage();
    await s.put("clients/a/b/file.pdf", new Uint8Array([1, 2, 3]));
    expect(await s.size("clients/a/b/file.pdf")).toBe(3);
    expect(Array.from(await s.get("clients/a/b/file.pdf"))).toEqual([1, 2, 3]);
    await s.delete("clients/a/b/file.pdf");
    expect(await s.size("clients/a/b/file.pdf")).toBeNull();
  });

  it("refuses keys that escape the storage folder", async () => {
    await expect(storage().put("../outside.txt", new Uint8Array([1]))).rejects.toThrow(
      /Invalid storage key/,
    );
  });

  it("signs links that verify only for their method, key and lifetime", async () => {
    const s = storage();
    const link = new URL(await s.downloadUrl("clients/x/y/scan.png", "scan.png", 60));
    expect(link.origin + link.pathname).toBe(
      "http://localhost:3000/__dev-storage/clients/x/y/scan.png",
    );
    const expires = link.searchParams.get("expires") ?? "";
    const sig = link.searchParams.get("sig") ?? "";
    expect(s.verify("GET", "clients/x/y/scan.png", expires, sig)).toBe(true);
    expect(s.verify("PUT", "clients/x/y/scan.png", expires, sig)).toBe(false);
    expect(s.verify("GET", "clients/x/y/other.png", expires, sig)).toBe(false);
    expect(s.verify("GET", "clients/x/y/scan.png", "1", sig)).toBe(false);
  });
});

import { normalizeHandle, validateHandleFormat } from "@/services/handles.js";
import { describe, expect, it } from "vitest";

describe("validateHandleFormat", () => {
  it("accepts simple lowercase", () => {
    expect(validateHandleFormat("alice")).toBeNull();
    expect(validateHandleFormat("a1b")).toBeNull();
    expect(validateHandleFormat("a_b_c")).toBeNull();
    expect(validateHandleFormat("twentycharsexactlyok")).toBeNull(); // 20
  });

  it("rejects too short / too long / wrong charset / starts with digit", () => {
    expect(validateHandleFormat("ab")).toEqual({ kind: "invalid_format" });
    expect(validateHandleFormat("a".repeat(21))).toEqual({ kind: "invalid_format" });
    expect(validateHandleFormat("Alice")).toEqual({ kind: "invalid_format" });
    expect(validateHandleFormat("ali ce")).toEqual({ kind: "invalid_format" });
    expect(validateHandleFormat("9alice")).toEqual({ kind: "invalid_format" });
    expect(validateHandleFormat("alice-bob")).toEqual({ kind: "invalid_format" });
    expect(validateHandleFormat("")).toEqual({ kind: "invalid_format" });
  });

  it("rejects reserved words", () => {
    expect(validateHandleFormat("admin")).toEqual({ kind: "reserved" });
    expect(validateHandleFormat("paper")).toEqual({ kind: "reserved" });
    expect(validateHandleFormat("api")).toEqual({ kind: "reserved" });
  });
});

describe("normalizeHandle", () => {
  it("lowercases and trims", () => {
    expect(normalizeHandle("  Alice  ")).toBe("alice");
    expect(normalizeHandle("BOB")).toBe("bob");
  });
});

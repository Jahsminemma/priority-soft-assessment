import { describe, it, expect } from "vitest";
import { UserIdSchema } from "./brands.js";

describe("UserIdSchema", () => {
  it("accepts valid uuid", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    expect(UserIdSchema.parse(id)).toBe(id);
  });

  it("rejects invalid", () => {
    expect(() => UserIdSchema.parse("not-uuid")).toThrow();
  });
});

import { describe, it, expect } from "vitest";
import { canManageLocation } from "./index.js";

describe("canManageLocation", () => {
  it("allows ADMIN for any location", () => {
    expect(
      canManageLocation(
        {
          id: "u1",
          email: "a@x.com",
          role: "ADMIN",
          managerLocationIds: [],
        },
        "a0000000-0000-4000-8000-000000000001",
      ),
    ).toBe(true);
  });

  it("allows MANAGER only for assigned locations", () => {
    const loc = "a0000000-0000-4000-8000-000000000001";
    expect(
      canManageLocation(
        {
          id: "u1",
          email: "m@x.com",
          role: "MANAGER",
          managerLocationIds: [loc],
        },
        loc,
      ),
    ).toBe(true);
    expect(
      canManageLocation(
        {
          id: "u1",
          email: "m@x.com",
          role: "MANAGER",
          managerLocationIds: [loc],
        },
        "b0000000-0000-4000-8000-000000000001",
      ),
    ).toBe(false);
  });

  it("denies STAFF", () => {
    expect(
      canManageLocation(
        {
          id: "u1",
          email: "s@x.com",
          role: "STAFF",
          managerLocationIds: [],
        },
        "a0000000-0000-4000-8000-000000000001",
      ),
    ).toBe(false);
  });
});

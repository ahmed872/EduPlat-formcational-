import { describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  it("reports ok when the database answers", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("reports 503 without leaking error details when the database is down", async () => {
    const spy = vi.spyOn(prisma, "$queryRaw").mockRejectedValueOnce(new Error("connect ECONNREFUSED 10.0.0.5:5432 password=x"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET();
    expect(res.status).toBe(503);
    const body = JSON.stringify(await res.json());
    expect(body).toBe('{"status":"unavailable"}');
    spy.mockRestore();
    quiet.mockRestore();
  });
});

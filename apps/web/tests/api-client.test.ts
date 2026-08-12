import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch } from "@/lib/api-client";

vi.mock("@/lib/auth", () => ({
  getAccessToken: vi.fn().mockResolvedValue("test-access-token"),
}));

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubEnv("VITE_API_BASE_URL", "http://api.test");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("api-client", () => {
  it("normalises the { error } envelope from 04-API.md §1.1 into a typed ApiError", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        jsonResponse(
          {
            error: {
              code: "REQUIRED_ANSWER_MISSING",
              message: "Some required answers are missing.",
              details: { missingKeys: ["company_name", "budget_range"] },
              requestId: "01J9X8TESTID",
            },
          },
          422,
        ),
      ),
    );

    const promise = apiFetch("/intake-submissions", { method: "POST", body: {} });
    await expect(promise).rejects.toBeInstanceOf(ApiError);

    const error = await apiFetch("/intake-submissions", {
      method: "POST",
      body: {},
    }).catch((caught: unknown) => caught as ApiError);

    expect(error).toMatchObject({
      code: "REQUIRED_ANSWER_MISSING",
      message: "Some required answers are missing.",
      details: { missingKeys: ["company_name", "budget_range"] },
      requestId: "01J9X8TESTID",
      status: 422,
    });
  });

  it("unwraps the { data } envelope and injects the bearer token", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { id: "abc" } }, 200));

    const data = await apiFetch<{ id: string }>("/auth/me");
    expect(data).toEqual({ id: "abc" });

    const call = fetchMock.mock.calls[0];
    expect(call).toBeDefined();
    const [url, init] = call as [string, RequestInit];
    expect(url).toBe("http://api.test/api/v1/auth/me");
    expect(new Headers(init.headers).get("Authorization")).toBe(
      "Bearer test-access-token",
    );
  });

  it("maps network failures to a NETWORK_ERROR ApiError with status 0", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    const error = (await apiFetch("/auth/me").catch(
      (caught: unknown) => caught,
    )) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe("NETWORK_ERROR");
    expect(error.status).toBe(0);
  });
});

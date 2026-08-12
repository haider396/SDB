/**
 * Upload flow (04 §8.1 / 06 §6): upload-url → direct PUT to the signed URL
 * → confirm → list refresh. A failed PUT rolls the pending row back with a
 * DELETE and never confirms.
 */
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FakeXHR,
  installApiMock,
  installFakeXhr,
  makeCandidate,
  makeDetail,
  makeState,
  renderCandidates,
  type ApiMock,
} from "./helpers";

vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function seeded() {
  const candidate = makeCandidate({ firstName: "Maria", lastName: "Santos" });
  const state = makeState({
    candidates: [candidate],
    detailsById: { [candidate.id]: makeDetail(candidate) },
  });
  return { candidate, state };
}

function pickFile(file: File) {
  const input = document.getElementById(
    "upload-file-input",
  ) as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

function requestsFor(mock: ApiMock, suffix: string) {
  return mock.requests.filter((request) => request.pathname.endsWith(suffix));
}

const PDF = () =>
  new File(["%PDF-1.4 test"], "cv-maria.pdf", { type: "application/pdf" });

describe("candidate file upload", () => {
  it("runs upload-url → signed PUT → confirm and refreshes the list", async () => {
    const { candidate, state } = seeded();
    const mock = installApiMock(state);
    installFakeXhr();
    renderCandidates(`/admin/candidates/${candidate.id}`);

    await screen.findByRole("button", { name: "Upload file" });
    pickFile(PDF());

    await waitFor(() => {
      expect(screen.getByText("cv-maria.pdf")).toBeInTheDocument();
    });

    // 1. upload-url grant
    const grant = mock.requests.find(
      (request) =>
        request.method === "POST" &&
        request.pathname ===
          `/api/v1/candidates/${candidate.id}/files/upload-url`,
    );
    expect(grant).toBeDefined();
    expect(grant?.body).toMatchObject({
      fileType: "cv",
      originalFilename: "cv-maria.pdf",
      mimeType: "application/pdf",
    });

    // 2. bytes PUT straight to the signed URL with the paired token
    expect(FakeXHR.instances).toHaveLength(1);
    const put = FakeXHR.instances[0];
    expect(put?.method).toBe("PUT");
    expect(put?.url).toContain("http://storage.test/upload/");
    expect(put?.url).toContain("token=signed-upload-token");
    expect(put?.headers.Authorization).toBe("Bearer signed-upload-token");

    // 3. confirm — after the PUT
    const confirm = mock.requests.find(
      (request) =>
        request.method === "POST" && request.pathname.endsWith("/confirm"),
    );
    expect(confirm).toBeDefined();

    // 4. list refresh happened (a files GET after the confirm)
    const confirmIndex = mock.requests.findIndex((request) =>
      request.pathname.endsWith("/confirm"),
    );
    const laterFilesGet = mock.requests
      .slice(confirmIndex + 1)
      .some(
        (request) =>
          request.method === "GET" &&
          request.pathname === `/api/v1/candidates/${candidate.id}/files`,
      );
    expect(laterFilesGet).toBe(true);
  });

  it("rolls back with DELETE and surfaces the error when the PUT fails", async () => {
    const { candidate, state } = seeded();
    const mock = installApiMock(state);
    installFakeXhr();
    FakeXHR.nextStatus = 500;
    renderCandidates(`/admin/candidates/${candidate.id}`);

    await screen.findByRole("button", { name: "Upload file" });
    pickFile(PDF());

    await waitFor(() => {
      expect(
        screen.getByText("Upload failed with status 500."),
      ).toBeInTheDocument();
    });

    // The pending row was rolled back…
    await waitFor(() => {
      const cleanup = mock.requests.find(
        (request) =>
          request.method === "DELETE" &&
          request.pathname.startsWith(
            `/api/v1/candidates/${candidate.id}/files/`,
          ),
      );
      expect(cleanup).toBeDefined();
    });
    // …and confirm never fired.
    expect(requestsFor(mock, "/confirm")).toHaveLength(0);
  });

  it("rejects unsupported types client-side before any request", async () => {
    const { candidate, state } = seeded();
    const mock = installApiMock(state);
    installFakeXhr();
    renderCandidates(`/admin/candidates/${candidate.id}`);

    await screen.findByRole("button", { name: "Upload file" });
    pickFile(new File(["zip"], "cv.zip", { type: "application/zip" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "This file type is not accepted. Use PDF, DOCX, PNG, JPEG, WebP, MP4, WebM, MP3, or M4A.",
        ),
      ).toBeInTheDocument();
    });
    expect(requestsFor(mock, "/upload-url")).toHaveLength(0);
    expect(FakeXHR.instances).toHaveLength(0);
  });
});

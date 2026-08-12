/**
 * DataTable pattern: sortable headers (button + aria-sort announcement),
 * cursor "Load more", and the four states (AC-UI-02).
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/patterns/data-table";
import { ApiError } from "@/lib/api-client";

interface Row {
  name: string;
  count: number;
}

const columns: ColumnDef<Row, unknown>[] = [
  { id: "name", accessorKey: "name", header: "Name" },
  {
    id: "count",
    accessorKey: "count",
    header: "Count",
    meta: { numeric: true },
  },
];

const rows: Row[] = [
  { name: "Bravo", count: 2 },
  { name: "Alpha", count: 3 },
  { name: "Charlie", count: 1 },
];

function renderTable(
  props: Partial<Parameters<typeof DataTable<Row>>[0]> = {},
) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <DataTable<Row>
            columns={columns}
            data={rows}
            label="Things"
            isLoading={false}
            isError={false}
            empty={{ title: "Nothing here", description: "Add a thing." }}
            {...props}
          />
        ),
      },
    ],
    { initialEntries: ["/"] },
  );
  return render(<RouterProvider router={router} />);
}

afterEach(() => {
  vi.restoreAllMocks();
});

function bodyRows(): HTMLElement[] {
  const table = screen.getByRole("table", { name: "Things" });
  const body = within(table).getAllByRole("rowgroup")[1];
  if (body === undefined) throw new Error("Table body not found");
  return within(body).getAllByRole("row");
}

describe("DataTable", () => {
  it("sorts by a column on header click and announces the sort state", async () => {
    const user = userEvent.setup();
    renderTable();

    // Unsorted: fetch order.
    expect(bodyRows().map((row) => row.textContent)).toEqual([
      "Bravo2",
      "Alpha3",
      "Charlie1",
    ]);
    const nameHeader = screen.getByRole("columnheader", { name: /name/i });
    expect(nameHeader).toHaveAttribute("aria-sort", "none");

    await user.click(within(nameHeader).getByRole("button"));
    expect(nameHeader).toHaveAttribute("aria-sort", "ascending");
    expect(bodyRows()[0]).toHaveTextContent("Alpha");

    await user.click(within(nameHeader).getByRole("button"));
    expect(nameHeader).toHaveAttribute("aria-sort", "descending");
    expect(bodyRows()[0]).toHaveTextContent("Charlie");
  });

  it("sorts numeric columns numerically", async () => {
    const user = userEvent.setup();
    renderTable();
    const countHeader = screen.getByRole("columnheader", { name: /count/i });
    await user.click(within(countHeader).getByRole("button"));
    expect(bodyRows().map((row) => row.textContent)).toEqual([
      "Charlie1",
      "Bravo2",
      "Alpha3",
    ]);
  });

  it("shows Load more only while a next page exists and forwards the click", async () => {
    const user = userEvent.setup();
    const onLoadMore = vi.fn();
    renderTable({ onLoadMore, hasMore: true });

    await user.click(screen.getByRole("button", { name: "Load more" }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("hides Load more when there is no next page", () => {
    const onLoadMore = vi.fn();
    renderTable({ onLoadMore, hasMore: false });
    expect(
      screen.queryByRole("button", { name: "Load more" }),
    ).not.toBeInTheDocument();
  });

  it("renders the loading skeleton state", () => {
    renderTable({ isLoading: true });
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("renders the error state with requestId and retry", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    renderTable({
      isError: true,
      error: new ApiError({
        code: "INTERNAL_ERROR",
        message: "Server exploded.",
        requestId: "req-42",
        status: 500,
      }),
      onRetry,
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Server exploded.");
    expect(screen.getByText(/req-42/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders the empty state", () => {
    renderTable({ data: [] });
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
    expect(screen.getByText("Add a thing.")).toBeInTheDocument();
  });
});

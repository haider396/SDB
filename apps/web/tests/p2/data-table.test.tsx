/**
 * DataTable pattern: sortable headers (button + aria-sort announcement),
 * Prev/Next cursor pagination footer, sticky-header scroll region, and the
 * four states (AC-UI-02).
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ColumnDef } from "@tanstack/react-table";
import {
  DataTable,
  type DataTablePagination,
} from "@/components/patterns/data-table";
import { ApiError } from "@/lib/api-client";

function makePagination(
  overrides: Partial<DataTablePagination>,
): DataTablePagination {
  return {
    page: 1,
    pageSize: 25,
    onPageSizeChange: vi.fn(),
    hasPrev: false,
    hasNext: false,
    onPrev: vi.fn(),
    onNext: vi.fn(),
    ...overrides,
  };
}

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

  it("pages forward through the footer; Prev is disabled on page 1", async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();
    const onPrev = vi.fn();
    renderTable({
      pagination: makePagination({ hasPrev: false, hasNext: true, onNext, onPrev }),
    });

    // No trace of the removed Load-more pattern.
    expect(
      screen.queryByRole("button", { name: "Load more" }),
    ).not.toBeInTheDocument();

    const prev = screen.getByRole("button", { name: "Previous page" });
    const next = screen.getByRole("button", { name: "Next page" });
    expect(prev).toBeDisabled();
    expect(next).toBeEnabled();
    await user.click(next);
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onPrev).not.toHaveBeenCalled();
  });

  it("disables Next on the last page and forwards Prev clicks", async () => {
    const user = userEvent.setup();
    const onPrev = vi.fn();
    renderTable({
      pagination: makePagination({
        page: 2,
        hasPrev: true,
        hasNext: false,
        onPrev,
      }),
    });

    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    const prev = screen.getByRole("button", { name: "Previous page" });
    expect(prev).toBeEnabled();
    await user.click(prev);
    expect(onPrev).toHaveBeenCalledTimes(1);
  });

  it("shows the range, page count, and total when meta.total is known", () => {
    renderTable({
      pagination: makePagination({ page: 2, pageSize: 25, hasPrev: true }),
      totalCount: 90,
    });
    // 3 fixture rows on page 2 of 25 → rows 26–28 of 90, 4 pages.
    expect(screen.getByText("26–28 of 90")).toBeInTheDocument();
    expect(screen.getByText("Page 2 of 4")).toBeInTheDocument();
  });

  it("shows a bare range when no total is known", () => {
    renderTable({ pagination: makePagination({ page: 1, pageSize: 25 }) });
    expect(screen.getByText("1–3")).toBeInTheDocument();
    expect(screen.getByText("Page 1")).toBeInTheDocument();
  });

  it("forwards page-size changes from the footer select", async () => {
    const user = userEvent.setup();
    const onPageSizeChange = vi.fn();
    renderTable({ pagination: makePagination({ onPageSizeChange }) });

    await user.selectOptions(screen.getByLabelText("Rows per page"), "50");
    expect(onPageSizeChange).toHaveBeenCalledWith(50);
  });

  it("renders rows in a scrollable region with a sticky header", () => {
    renderTable({ pagination: makePagination({}) });
    const table = screen.getByRole("table", { name: "Things" });
    // The table's wrapper is the one scroll container for both axes …
    expect(table.parentElement?.className).toContain("overflow-auto");
    // … and every header cell sticks to its top edge.
    for (const header of screen.getAllByRole("columnheader")) {
      expect(header.className).toContain("sticky");
      expect(header.className).toContain("top-0");
    }
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

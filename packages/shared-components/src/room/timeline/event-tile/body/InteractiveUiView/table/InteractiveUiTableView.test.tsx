/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import "@vector-im/compound-design-tokens/assets/web/css/compound-design-tokens.css";
import React from "react";
import { render, screen, within } from "@test-utils";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { InteractiveUiTableView } from "./InteractiveUiTableView";
import type { TableCell, TableColumn } from "./types";

const columns: TableColumn[] = [
    { key: "name", label: "Name" },
    { key: "price", label: "Price", kind: "number", align: "end" },
];
const rows: TableCell[][] = [
    ["Zulu", 2],
    ["Alpha", 10],
    ["Beta", 2],
    ["Empty", null],
];
function rowNames(): string[] {
    return screen
        .getAllByRole("row")
        .slice(1)
        .map((row) => within(row).getAllByRole("cell")[0].textContent!);
}

describe("InteractiveUiTableView", () => {
    it("should sort numerically with stable ties in both directions without changing input", () => {
        const original = structuredClone(rows);
        const { rerender } = render(
            <InteractiveUiTableView columns={columns} rows={rows} sortable sort={{ key: "price", dir: "asc" }} />,
        );
        expect(rowNames()).toEqual(["Empty", "Zulu", "Beta", "Alpha"]);
        expect(screen.getByRole("columnheader", { name: "Price" })).toHaveAttribute("aria-sort", "ascending");
        rerender(
            <InteractiveUiTableView columns={columns} rows={rows} sortable sort={{ key: "price", dir: "desc" }} />,
        );
        expect(rowNames()).toEqual(["Alpha", "Zulu", "Beta", "Empty"]);
        expect(screen.getByRole("columnheader", { name: "Price" })).toHaveAttribute("aria-sort", "descending");
        expect(rows).toEqual(original);
    });
    it("should sort text and request caller-owned sorting", async () => {
        const user = userEvent.setup();
        const onSort = vi.fn();
        render(
            <InteractiveUiTableView
                columns={columns}
                rows={rows}
                sortable
                onSort={onSort}
                sort={{ key: "name", dir: "asc" }}
            />,
        );
        expect(rowNames()).toEqual(["Alpha", "Beta", "Empty", "Zulu"]);
        await user.click(screen.getByRole("button", { name: "Price" }));
        expect(onSort).toHaveBeenCalledWith("price");
        expect(screen.getByRole("columnheader", { name: "Price" })).toHaveAttribute("aria-sort", "none");
    });
    it("should keep a wide table inside a 360px card and preserve literal text", () => {
        const wide = Array.from({ length: 12 }, (_, i) => ({ key: `c${i}`, label: `Column ${i}` }));
        render(
            <div style={{ width: 360 }}>
                <InteractiveUiTableView columns={wide} rows={[["<script>alert(1)</script>"]]} sortable={false} />
            </div>,
        );
        const region = screen.getByRole("region");
        expect(region.clientWidth).toBeLessThanOrEqual(360);
        expect(region.scrollWidth).toBeGreaterThan(region.clientWidth);
        expect(screen.getByText("<script>alert(1)</script>")).toBeVisible();
    });
});

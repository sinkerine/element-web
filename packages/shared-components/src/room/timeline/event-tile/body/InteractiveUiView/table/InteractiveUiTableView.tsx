/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

// Scroll regions must receive keyboard focus so keyboard users can pan wide data.
/* oxlint-disable jsx-a11y/no-noninteractive-tabindex */

import React, { type JSX } from "react";
import { Button } from "@vector-im/compound-web";

import { useI18n } from "../../../../../../core/i18n/i18nContext";
import type { TableCell, TableColumn } from "./types";
import styles from "./InteractiveUiTableView.module.css";

interface Props {
    /** Accessible table title. */
    caption?: string;
    /** Columns in display order. */
    columns: TableColumn[];
    /** Primitive cells in column order; input is never mutated. */
    rows: TableCell[][];
    /** Caller-owned sorting. Equal values retain input order in either direction. */
    sort?: { key: string; dir: "asc" | "desc" };
    /** Enable sort requests on column headers. */
    sortable: boolean;
    /** Request sorting; the caller chooses the next direction. */
    onSort?: (key: string) => void;
}

/** Controlled, stable sorting and an internally scrollable semantic table. */
export function InteractiveUiTableView({ caption, columns, rows, sort, sortable, onSort }: Props): JSX.Element {
    const _t = useI18n().translate;
    const index = columns.findIndex((column) => column.key === sort?.key);
    const ordered = rows.map((cells, position) => ({ cells, position }));
    if (index >= 0 && sort) {
        ordered.sort((a, b) => {
            const left = a.cells[index] ?? null;
            const right = b.cells[index] ?? null;
            const comparison =
                left === right
                    ? 0
                    : left === null
                      ? -1
                      : right === null
                        ? 1
                        : columns[index].kind === "number" && typeof left === "number" && typeof right === "number"
                          ? left < right
                              ? -1
                              : 1
                          : String(left).localeCompare(String(right));
            return comparison * (sort.dir === "asc" ? 1 : -1) || a.position - b.position;
        });
    }
    return (
        <div
            className={styles.scroll}
            tabIndex={0}
            role="region"
            aria-label={caption ?? _t("interactive_ui|data_table")}
        >
            <table className={styles.table}>
                <caption>{caption ?? _t("interactive_ui|data_table")}</caption>
                <thead>
                    <tr>
                        {columns.map((column, columnIndex) => (
                            <th
                                key={column.key}
                                scope="col"
                                data-align={column.align}
                                aria-sort={
                                    sort?.key === column.key
                                        ? sort.dir === "asc"
                                            ? "ascending"
                                            : "descending"
                                        : sortable
                                          ? "none"
                                          : undefined
                                }
                            >
                                {sortable && onSort ? (
                                    <Button type="button" kind="tertiary" size="md" onClick={() => onSort(column.key)}>
                                        {column.label}
                                        {index === columnIndex ? (sort?.dir === "asc" ? " ↑" : " ↓") : ""}
                                    </Button>
                                ) : (
                                    column.label
                                )}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {ordered.map(({ cells, position }) => (
                        <tr key={position}>
                            {columns.map((column, columnIndex) => (
                                <td key={column.key} data-align={column.align}>
                                    {cells[columnIndex]}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

/** A primitive table value. Null renders as an empty cell and sorts before present values. */
export type TableCell = string | number | null;

/** Column presentation; numeric sorting uses kind, never formatted cell text. */
export interface TableColumn {
    key: string;
    label: string;
    kind?: "text" | "number";
    align?: "start" | "end";
}

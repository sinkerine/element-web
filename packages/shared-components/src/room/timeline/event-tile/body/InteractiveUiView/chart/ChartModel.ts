/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

/** Chart data prepared by the caller; no wire-format or application dependencies. */
export type ChartModel =
    | {
          kind: "bar" | "line";
          title?: string;
          xLabel?: string;
          yLabel?: string;
          unit?: string;
          categories: string[];
          series: { name: string; values: number[] }[];
      }
    | { kind: "pie"; title?: string; unit?: string; categories: string[]; values: number[] }
    | {
          kind: "scatter";
          title?: string;
          xLabel?: string;
          yLabel?: string;
          unit?: string;
          series: { name: string; points: { x: number; y: number; label?: string }[] }[];
      };

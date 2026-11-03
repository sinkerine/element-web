/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { InteractiveUiChartView } from "./InteractiveUiChartView";

const meta = {
    title: "Timeline/Interactive UI/Chart",
    component: InteractiveUiChartView,
    args: {
        chart: {
            kind: "bar",
            title: "Mass by category",
            unit: "kg",
            categories: ["A", "B", "C"],
            series: [
                { name: "Before", values: [4, -2, 6] },
                { name: "After", values: [6, 3, 8] },
            ],
        },
        showData: false,
        onToggleData: fn(),
    },
} satisfies Meta<typeof InteractiveUiChartView>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Light: Story = { globals: { theme: "light" } };
export const Dark: Story = { globals: { theme: "dark" } };
export const Mobile: Story = {
    decorators: [
        (Story) => (
            <div style={{ width: 360, maxWidth: "100%" }}>
                <Story />
            </div>
        ),
    ],
};

export const Line: Story = { args: { chart: { ...meta.args.chart, kind: "line" } } };
export const Pie: Story = {
    args: { chart: { kind: "pie", title: "Share", categories: ["A", "B", "C"], values: [2, 3, 4] } },
};
export const SingleValuePie: Story = { args: { chart: { kind: "pie", categories: ["All"], values: [1] } } };
export const Scatter: Story = {
    args: {
        chart: {
            kind: "scatter",
            xLabel: "Distance",
            yLabel: "Mass",
            series: [
                {
                    name: "A",
                    points: [
                        { x: -2, y: 3 },
                        { x: 2, y: 8 },
                    ],
                },
                { name: "B", points: [{ x: 1, y: 4 }] },
            ],
        },
    },
};
export const DataTable: Story = { args: { showData: true } };

/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { InteractiveUiTableView } from "./InteractiveUiTableView";

const meta = {
    title: "Timeline/Interactive UI/Table",
    component: InteractiveUiTableView,
    args: {
        caption: "Carrier prices",
        columns: [
            { key: "carrier", label: "Carrier" },
            { key: "price", label: "Price (£)", kind: "number", align: "end" },
        ],
        rows: [
            ["DHL", 24],
            ["Royal Mail", 18.5],
        ],
        sortable: true,
        sort: { key: "price", dir: "asc" },
        onSort: fn(),
    },
} satisfies Meta<typeof InteractiveUiTableView>;
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

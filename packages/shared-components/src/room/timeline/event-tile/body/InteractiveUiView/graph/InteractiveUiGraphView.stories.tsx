/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { InteractiveUiGraphView } from "./InteractiveUiGraphView";
import { layoutLayeredGraph } from "./GraphLayout";

const meta = {
    title: "Timeline/Interactive UI/Graph",
    component: InteractiveUiGraphView,
    args: {
        layout: layoutLayeredGraph({
            layers: [{ label: "Ingredients" }, { label: "Mechanisms" }, { label: "Results" }],
            nodes: [
                { id: "sugar", label: "Sugar", layer: 0 },
                { id: "reaction", label: "Maillard reaction", detail: "Heat creates flavour", layer: 1 },
                { id: "flavour", label: "Flavour", layer: 2 },
            ],
            edges: [
                { from: "sugar", to: "reaction" },
                { from: "reaction", to: "flavour" },
                { from: "flavour", to: "sugar", style: "dashed" },
            ],
        }),
        selectedId: "reaction",
        showAsList: false,
        onSelect: fn(),
        onToggleList: fn(),
    },
} satisfies Meta<typeof InteractiveUiGraphView>;
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

export const Relationships: Story = { args: { showAsList: true } };
export const TopToBottom: Story = { args: { layout: { ...meta.args.layout, direction: "top_to_bottom" } } };

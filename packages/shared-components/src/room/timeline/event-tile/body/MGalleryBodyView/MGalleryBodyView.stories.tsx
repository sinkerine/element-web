/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React, { type JSX } from "react";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { useMockedViewModel } from "../../../../../core/viewmodel";
import {
    MGalleryBodyView,
    type MGalleryBodyViewSnapshot,
    type MGalleryBodyViewActions,
    type MGalleryItemSnapshot,
} from "./MGalleryBodyView";

const preview =
    "data:image/svg+xml," +
    encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#68a"/><circle cx="200" cy="150" r="80" fill="#acd"/></svg>',
    );
const items: MGalleryItemSnapshot[] = Array.from({ length: 8 }, (_, index) => ({
    id: String(index),
    itemtype: "m.image",
    fileName: `Photo ${index + 1}`,
    fileSize: "2 KB",
    thumbnailUrl: preview,
    contentUrl: preview,
    aspectRatio: 4 / 3,
    placeholder: "none",
    blurhashUrl: null,
    isAnimated: false,
    error: false,
}));

function GalleryStory({
    onItemClick,
    onShowMediaClick,
    onItemLoad,
    onItemError,
    ...snapshot
}: MGalleryBodyViewSnapshot & MGalleryBodyViewActions): JSX.Element {
    const vm = useMockedViewModel(snapshot, { onItemClick, onShowMediaClick, onItemLoad, onItemError });
    return <MGalleryBodyView vm={vm} />;
}

const meta = {
    title: "Room/Timeline/MGalleryBodyView",
    component: GalleryStory,
    tags: ["autodocs"],
    args: {
        items: items.slice(0, 5),
        mediaVisible: true,
        inhibitInteraction: false,
        onItemClick: fn(),
        onShowMediaClick: fn(),
        onItemLoad: fn(),
        onItemError: fn(),
    },
} satisfies Meta<typeof GalleryStory>;
export default meta;
type Story = StoryObj<typeof meta>;

export const One: Story = { args: { items: items.slice(0, 1) } };
export const Two: Story = { args: { items: items.slice(0, 2) } };
export const Three: Story = { args: { items: items.slice(0, 3) } };
export const Four: Story = { args: { items: items.slice(0, 4) } };
export const Five: Story = {};
export const Overflow: Story = { args: { items } };
export const Hidden: Story = { args: { mediaVisible: false } };
export const Loading: Story = {
    args: { items: [{ ...items[0], thumbnailUrl: null, contentUrl: null, placeholder: "loading" }] },
};
export const Error: Story = { args: { items: [{ ...items[0], error: true }] } };
export const Mixed: Story = {
    args: {
        items: [
            items[0],
            { ...items[1], itemtype: "m.video" },
            { ...items[2], itemtype: "m.file", fileName: "Document.pdf" },
            { ...items[3], itemtype: "m.audio", fileName: "Audio.ogg" },
        ],
    },
};

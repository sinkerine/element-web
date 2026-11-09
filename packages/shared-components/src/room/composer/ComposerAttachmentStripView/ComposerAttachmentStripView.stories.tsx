/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React, { type JSX } from "react";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { useMockedViewModel } from "../../../core/viewmodel";
import {
    ComposerAttachmentStripView,
    type ComposerAttachmentStripViewSnapshot,
    type ComposerAttachmentStripViewActions,
} from "./ComposerAttachmentStripView";

const preview =
    "data:image/svg+xml," +
    encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="#68a"/></svg>',
    );
function StripStory({
    onRemoveItem,
    ...snapshot
}: ComposerAttachmentStripViewSnapshot & ComposerAttachmentStripViewActions): JSX.Element | null {
    const vm = useMockedViewModel(snapshot, { onRemoveItem });
    return <ComposerAttachmentStripView vm={vm} />;
}
const meta = {
    title: "Room/Composer/ComposerAttachmentStripView",
    component: StripStory,
    tags: ["autodocs"],
    args: {
        items: [{ id: "1", kind: "image", fileName: "Photo.png", fileSize: "2 KB", previewUrl: preview }],
        onRemoveItem: fn(),
    },
} satisfies Meta<typeof StripStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Single: Story = {};
export const Empty: Story = { args: { items: [] } };
export const Video: Story = {
    args: {
        items: [
            { id: "video", kind: "video", fileName: "Video.webm", fileSize: "4 MB", previewUrl: "videoBodyDemo.webm" },
        ],
    },
};
export const Overflow: Story = {
    args: {
        items: Array.from({ length: 12 }, (_, index) => ({
            id: String(index),
            kind: "image",
            fileName: `Photo with a long filename ${index}.png`,
            fileSize: "2 KB",
            previewUrl: preview,
        })),
    },
};

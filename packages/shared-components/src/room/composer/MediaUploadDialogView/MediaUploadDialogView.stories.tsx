/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React, { type JSX } from "react";
import { Text } from "@vector-im/compound-web";
import { expect, fn, waitFor } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/react-vite";

import demoVideo from "../../../../static/videoBodyDemo.webm";
import { useMockedViewModel } from "../../../core/viewmodel";
import {
    MediaUploadDialogView,
    type MediaUploadDialogViewSnapshot,
    type MediaUploadDialogViewActions,
    type MediaUploadItemSnapshot,
} from "./MediaUploadDialogView";

const image: MediaUploadItemSnapshot = {
    id: "image",
    kind: "image",
    fileName: "Photo.png",
    fileSize: "2 KB",
    previewUrl:
        "data:image/svg+xml," +
        encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="240"><rect width="480" height="240" fill="#68a"/><circle cx="240" cy="120" r="64" fill="#bde"/></svg>',
        ),
};
const video: MediaUploadItemSnapshot = {
    id: "video",
    kind: "video",
    fileName: "Video.webm",
    fileSize: "4 MB",
    previewUrl: demoVideo,
};

function DialogStory({
    onRemoveItem,
    onGroupItemsChange,
    onAddFiles,
    onCancel,
    onSend,
    ...snapshot
}: MediaUploadDialogViewSnapshot & MediaUploadDialogViewActions): JSX.Element {
    const vm = useMockedViewModel(snapshot, { onRemoveItem, onGroupItemsChange, onAddFiles, onCancel, onSend });
    return <MediaUploadDialogView vm={vm} caption={<Text>Caption</Text>} />;
}

const meta = {
    title: "Room/Composer/MediaUploadDialogView",
    component: DialogStory,
    tags: ["autodocs"],
    play: async ({ canvasElement }) => {
        // Fully buffer the local video so the native controls show a stable buffered range.
        for (const media of canvasElement.querySelectorAll("img, video")) {
            if (media instanceof HTMLVideoElement) {
                media.preload = "auto";
                media.load();
            }
            await waitFor(async () => {
                if (media instanceof HTMLVideoElement) {
                    await expect(media.readyState).toBe(4);
                    await expect(media.buffered.length).toBeGreaterThan(0);
                    await expect(media.buffered.end(media.buffered.length - 1)).toBeCloseTo(media.duration, 1);
                } else {
                    await expect((media as HTMLImageElement).naturalWidth).toBeGreaterThan(0);
                }
            });
        }
    },
    args: {
        items: [image],
        canGroup: false,
        groupItems: true,
        showCaptionLastItemNote: false,
        errors: [],
        canSend: true,
        onRemoveItem: fn(),
        onGroupItemsChange: fn(),
        onAddFiles: fn(),
        onCancel: fn(),
        onSend: fn(),
    },
} satisfies Meta<typeof DialogStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const SingleImage: Story = {};
export const SingleVideo: Story = { args: { items: [video] } };
export const TwoImagesGrouped: Story = {
    args: { items: [image, { ...image, id: "second", fileName: "Second.png" }], canGroup: true },
};
export const MixedUngrouped: Story = {
    args: { items: [image, video], canGroup: true, groupItems: false, showCaptionLastItemNote: true },
};
export const WithErrors: Story = { args: { errors: ["Only images and videos can be added."] } };
export const LimitExceeded: Story = {
    args: {
        items: [image, { ...image, id: "second", fileName: "Second.png" }],
        canGroup: true,
        canSend: false,
        errors: ["Too many items to send as a group."],
    },
};

/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@test-utils";
import userEvent from "@testing-library/user-event";

import { MockViewModel } from "../../../core/viewmodel/MockViewModel";
import { ComposerAttachmentStripView, type ComposerAttachmentItemSnapshot } from "./ComposerAttachmentStripView";

const items: ComposerAttachmentItemSnapshot[] = [
    {
        id: "image",
        fileName: "photo.png",
        fileSize: "2 KB",
        kind: "image",
        previewUrl: "https://example.org/photo.png",
    },
    {
        id: "video",
        fileName: "movie.mp4",
        fileSize: "4 MB",
        kind: "video",
        previewUrl: "https://example.org/movie.mp4",
    },
];

function model(attachments = items) {
    return Object.assign(new MockViewModel({ items: attachments }), { onRemoveItem: vi.fn() });
}

describe("ComposerAttachmentStripView", () => {
    it("should render nothing when no attachments are staged", () => {
        const { container } = render(<ComposerAttachmentStripView vm={model([])} />);
        expect(container).toBeEmptyDOMElement();
    });

    it("should show ordered image and video previews, names and sizes", () => {
        render(<ComposerAttachmentStripView vm={model()} />);
        expect(screen.getByRole("list", { name: "Attachments" })).toBeVisible();
        const entries = screen.getAllByRole("listitem");
        expect(entries[0]).toHaveTextContent("photo.png2 KB");
        expect(entries[1]).toHaveTextContent("movie.mp44 MB");
        expect(screen.getByRole("img", { name: "photo.png" })).toHaveAttribute("src", items[0].previewUrl);
        expect(screen.getByLabelText("movie.mp4")).toHaveAttribute("src", items[1].previewUrl);
        expect(screen.getByLabelText("movie.mp4")).not.toHaveAttribute("autoplay");
    });

    it("should remove only the requested attachment by stable id", async () => {
        const vm = model();
        render(<ComposerAttachmentStripView vm={vm} />);
        await userEvent.click(screen.getByRole("button", { name: "Remove movie.mp4" }));
        expect(vm.onRemoveItem).toHaveBeenCalledExactlyOnceWith("video");
    });

    it("should allow removing the last attachment with the keyboard", async () => {
        const vm = model([items[0]]);
        render(<ComposerAttachmentStripView vm={vm} />);
        const user = userEvent.setup();
        await user.tab();
        expect(screen.getByRole("button", { name: "Remove photo.png" })).toHaveFocus();
        await user.keyboard("{Enter}");
        expect(vm.onRemoveItem).toHaveBeenCalledExactlyOnceWith("image");
    });

    it("should scroll horizontally while keeping the cards inside the strip", () => {
        const attachments = Array.from({ length: 60 }, (_, index) => ({ ...items[0], id: String(index) }));
        render(<ComposerAttachmentStripView vm={model(attachments)} />);
        const strip = screen.getByRole("list");
        expect(strip.scrollWidth).toBeGreaterThan(strip.clientWidth);
        expect(getComputedStyle(strip).overflowX).toBe("auto");
    });
});

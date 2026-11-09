/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@test-utils";
import userEvent from "@testing-library/user-event";

import { MockViewModel } from "../../../../../core/viewmodel/MockViewModel";
import { MGalleryBodyView, type MGalleryBodyViewSnapshot, type MGalleryItemSnapshot } from "./MGalleryBodyView";

function item(index: number, overrides: Partial<MGalleryItemSnapshot> = {}): MGalleryItemSnapshot {
    return {
        id: String(index),
        itemtype: "m.image",
        fileName: `photo-${index}.png`,
        fileSize: "2 KB",
        thumbnailUrl: null,
        contentUrl: null,
        aspectRatio: 1.5,
        placeholder: "none",
        blurhashUrl: null,
        isAnimated: false,
        error: false,
        ...overrides,
    };
}

function setup(items: MGalleryItemSnapshot[], overrides: Partial<MGalleryBodyViewSnapshot> = {}) {
    const vm = Object.assign(
        new MockViewModel({ items, mediaVisible: true, inhibitInteraction: false, ...overrides }),
        {
            onItemClick: vi.fn(),
            onShowMediaClick: vi.fn(),
            onItemLoad: vi.fn(),
            onItemError: vi.fn(),
        },
    );
    return { vm, ...render(<MGalleryBodyView vm={vm} />) };
}

describe("MGalleryBodyView", () => {
    it.each([1, 2, 3, 4, 5, 8, 60])("should render the %i item layout with at most five visible tiles", (count) => {
        const { container } = setup(Array.from({ length: count }, (_, index) => item(index)));
        const visible = Math.min(count, 5);
        expect(screen.getAllByRole("button")).toHaveLength(visible);
        expect(container.firstElementChild).toHaveAttribute("data-count", String(visible));
        if (count > 5) expect(screen.getByText(`+${count - 5}`)).toBeVisible();
        else expect(screen.queryByText(/^\+/)).not.toBeInTheDocument();
        const tiles = screen.getAllByRole("button");
        const first = tiles[0].getBoundingClientRect();
        if (count === 1) expect(first.width / first.height).toBeCloseTo(1.5, 1);
        if (count === 2 || count === 4) expect(first.width).toBeCloseTo(first.height, 1);
        if (count === 3) expect(first.height).toBeGreaterThan(tiles[1].getBoundingClientRect().height);
        if (count >= 5) expect(first.width).toBeGreaterThan(tiles[2].getBoundingClientRect().width);
    });

    it("should dispatch the clicked tile index including the overflow tile and keyboard activation", async () => {
        const { vm } = setup(Array.from({ length: 8 }, (_, index) => item(index)));
        const user = userEvent.setup();
        const tile = screen.getByRole("button", { name: "photo-4.png" });
        await user.click(tile);
        expect(vm.onItemClick).toHaveBeenCalledWith(4, expect.anything());
        tile.focus();
        await user.keyboard("{Enter}");
        expect(vm.onItemClick).toHaveBeenCalledTimes(2);
    });

    it("should block tile interaction when inhibited", async () => {
        const { vm } = setup([item(0)], { inhibitInteraction: true });
        expect(screen.getByRole("button")).toBeDisabled();
        await userEvent.click(screen.getByRole("button"));
        expect(vm.onItemClick).not.toHaveBeenCalled();
    });

    it("should hide every media source until reveal is requested", async () => {
        const { vm, container } = setup([item(0, { thumbnailUrl: "https://example.org/private.png" })], {
            mediaVisible: false,
        });
        expect(container.querySelector("img, video")).toBeNull();
        await userEvent.click(screen.getByRole("button", { name: "Show media" }));
        expect(vm.onShowMediaClick).toHaveBeenCalledOnce();
        expect(vm.onItemClick).not.toHaveBeenCalled();
    });

    it("should report thumbnail load and error using its original item index", () => {
        const { vm, container } = setup([item(0), item(1, { thumbnailUrl: "https://example.org/thumb.png" })]);
        const img = container.querySelector("img")!;
        fireEvent.load(img);
        fireEvent.error(img);
        expect(vm.onItemLoad).toHaveBeenCalledWith(1);
        expect(vm.onItemError).toHaveBeenCalledWith(1);
    });

    it("should use an image source fallback, blurhash and loading placeholders", () => {
        const { container } = setup([
            item(0, {
                contentUrl: "https://example.org/full.png",
                placeholder: "blurhash",
                blurhashUrl: "https://example.org/blur.png",
            }),
            item(1, { placeholder: "loading" }),
        ]);
        expect(container.querySelector('img[src="https://example.org/full.png"]')).not.toBeNull();
        expect(container.querySelector('img[src="https://example.org/blur.png"]')).not.toBeNull();
        expect(screen.getByRole("progressbar", { name: "Loading…" })).toBeVisible();
    });

    it("should replace failed content with a localized error", () => {
        const { container } = setup([
            item(0, { error: true, thumbnailUrl: "https://example.org/broken.png", placeholder: "loading" }),
        ]);
        expect(screen.getByText("Unable to load media")).toBeVisible();
        expect(container.querySelector("img")).toBeNull();
        expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    });

    it("should show video and animated indicators and preserve file and audio tiles", async () => {
        const { vm, container } = setup([
            item(0, { itemtype: "m.video", thumbnailUrl: "https://example.org/video.png" }),
            item(1, { isAnimated: true }),
            item(2, { itemtype: "m.file", fileName: "document.pdf" }),
            item(3, { itemtype: "m.audio", fileName: "sound.ogg" }),
            item(4),
        ]);
        expect(container.querySelector("svg")).not.toBeNull();
        expect(screen.getByText("GIF")).toBeVisible();
        expect(screen.getByText("document.pdf")).toBeVisible();
        expect(screen.getByText("sound.ogg")).toBeVisible();
        expect(screen.getAllByText("2 KB")).toHaveLength(2);
        const fileRow = screen.getByRole("button", { name: "document.pdf" }).getBoundingClientRect();
        const imageTile = screen.getByRole("button", { name: "photo-0.png" }).getBoundingClientRect();
        expect(fileRow.width).toBeGreaterThan(imageTile.width);
        expect(fileRow.height).toBeLessThan(imageTile.height);
        await userEvent.click(screen.getByRole("button", { name: "sound.ogg" }));
        expect(vm.onItemClick).toHaveBeenCalledWith(3, expect.anything());
    });
});

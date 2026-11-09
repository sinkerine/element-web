/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@test-utils";
import userEvent from "@testing-library/user-event";

import demoVideo from "../../../../static/videoBodyDemo.webm";
import { MockViewModel } from "../../../core/viewmodel/MockViewModel";
import {
    MediaUploadDialogView,
    type MediaUploadDialogViewSnapshot,
    type MediaUploadItemSnapshot,
} from "./MediaUploadDialogView";

const items: MediaUploadItemSnapshot[] = [
    {
        id: "image",
        fileName: "photo.png",
        fileSize: "2 KB",
        kind: "image",
        previewUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E",
    },
    { id: "video", fileName: "movie.webm", fileSize: "4 MB", kind: "video", previewUrl: demoVideo },
];
function model(overrides: Partial<MediaUploadDialogViewSnapshot> = {}) {
    return Object.assign(
        new MockViewModel<MediaUploadDialogViewSnapshot>({
            items,
            canGroup: true,
            groupItems: true,
            showCaptionLastItemNote: false,
            errors: [],
            canSend: true,
            ...overrides,
        }),
        {
            onRemoveItem: vi.fn(),
            onGroupItemsChange: vi.fn(),
            onAddFiles: vi.fn(),
            onCancel: vi.fn(),
            onSend: vi.fn(),
        },
    );
}
function setup(overrides: Partial<MediaUploadDialogViewSnapshot> = {}) {
    const vm = model(overrides);
    return { vm, ...render(<MediaUploadDialogView vm={vm} caption={<textarea aria-label="Caption" />} />) };
}

describe("MediaUploadDialogView", () => {
    it.each(items)("should render a title-free $kind preview with its name and size", (item) => {
        setup({ items: [item], canGroup: false });
        expect(screen.queryByRole("heading")).not.toBeInTheDocument();
        expect(screen.getByRole("list", { name: "Selected media" })).toBeVisible();
        expect(screen.getAllByRole("listitem")).toHaveLength(1);
        expect(screen.getByText(`${item.fileName} · ${item.fileSize}`)).toBeVisible();
        const preview =
            item.kind === "image"
                ? screen.getByRole("img", { name: item.fileName })
                : screen.getByLabelText(item.fileName);
        expect(preview).toHaveAttribute("src", item.previewUrl);
        if (item.kind === "video") {
            expect(preview).toHaveAttribute("controls");
            expect(preview).toHaveAttribute("preload", "metadata");
            expect(preview).toHaveAttribute("playsinline");
            expect(preview).toHaveProperty("muted", true);
            expect(preview).not.toHaveAttribute("autoplay");
        }
        expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
        expect(screen.getByRole("textbox", { name: "Caption" })).toBeVisible();
    });

    it("should remove the requested item by id", async () => {
        const { vm } = setup();
        await userEvent.click(screen.getByRole("button", { name: "Remove movie.webm" }));
        expect(vm.onRemoveItem).toHaveBeenCalledExactlyOnceWith("video");
    });

    it.each([true, false])("should toggle grouping from %s", async (groupItems) => {
        const { vm } = setup({ groupItems });
        const checkbox = screen.getByRole("checkbox", { name: "Group items" });
        expect(checkbox).toHaveProperty("checked", groupItems);
        await userEvent.click(checkbox);
        expect(vm.onGroupItemsChange).toHaveBeenCalledExactlyOnceWith(!groupItems);
    });

    it("should open Add and forward unfiltered files, resetting for repeated selections", async () => {
        const { vm, container } = setup();
        const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
        expect(input).toHaveAttribute("accept", "image/*,video/*");
        expect(input).toHaveAttribute("multiple");
        const click = vi.spyOn(input, "click");
        await userEvent.click(screen.getByRole("button", { name: "Add" }));
        expect(click).toHaveBeenCalledOnce();
        const files = [
            new File(["image"], "photo.png", { type: "image/png" }),
            new File(["text"], "notes.txt", { type: "text/plain" }),
        ];
        for (let i = 0; i < 2; i++) {
            fireEvent.change(input, { target: { files } });
            expect(input.value).toBe("");
        }
        expect(vm.onAddFiles).toHaveBeenCalledTimes(2);
        expect(vm.onAddFiles).toHaveBeenLastCalledWith(files);
    });

    it("should handle file drags and drops without browser defaults or propagation", () => {
        const { vm } = setup();
        const root = screen.getByRole("list", { name: "Selected media" }).parentElement!;
        const files = [new File(["text"], "notes.txt", { type: "text/plain" })];
        const parentDrop = vi.fn();
        document.addEventListener("drop", parentDrop);
        const dataTransfer = new DataTransfer();
        for (const file of files) dataTransfer.items.add(file);
        for (const type of ["dragover", "drop"]) {
            const event = new DragEvent(type, {
                dataTransfer,
                cancelable: true,
                bubbles: true,
            });
            fireEvent(root, event);
            expect(event.defaultPrevented).toBe(true);
        }
        document.removeEventListener("drop", parentDrop);
        expect(parentDrop).not.toHaveBeenCalled();
        expect(vm.onAddFiles).toHaveBeenCalledExactlyOnceWith(files);
    });

    it("should ignore non-file drags and drops", () => {
        const { vm } = setup();
        const dataTransfer = new DataTransfer();
        dataTransfer.setData("text/plain", "text");
        for (const type of ["dragover", "drop"]) {
            const event = new DragEvent(type, {
                dataTransfer,
                cancelable: true,
                bubbles: true,
            });
            fireEvent(screen.getByRole("list").parentElement!, event);
            expect(event.defaultPrevented).toBe(false);
        }
        expect(vm.onAddFiles).not.toHaveBeenCalled();
    });

    it("should forward Cancel and Send", async () => {
        const { vm } = setup();
        await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
        await userEvent.click(screen.getByRole("button", { name: "Send" }));
        expect(vm.onCancel).toHaveBeenCalledOnce();
        expect(vm.onSend).toHaveBeenCalledOnce();
    });

    it("should disable Send and show translated alerts and the last-file note", async () => {
        const { vm } = setup({
            canSend: false,
            errors: ["Rejected addition", "Gallery limit"],
            showCaptionLastItemNote: true,
        });
        expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
        await userEvent.click(screen.getByRole("button", { name: "Send" }));
        expect(vm.onSend).not.toHaveBeenCalled();
        expect(screen.getAllByRole("alert").map((alert) => alert.textContent)).toEqual([
            "Rejected addition",
            "Gallery limit",
        ]);
        expect(screen.getByText("The caption is sent with the last file")).toBeVisible();
    });

    it("should keep the caption slot when no items remain and hide the optional note", () => {
        setup({ items: [], canGroup: false, canSend: false });
        expect(screen.getByRole("textbox", { name: "Caption" })).toBeVisible();
        expect(screen.queryByText("The caption is sent with the last file")).not.toBeInTheDocument();
    });
});

/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import { MediaUploadDialogViewModel } from "./MediaUploadDialogViewModel";

const image = new File(["a"], "a.png", { type: "image/png" });
const video = new File(["b"], "b.mp4", { type: "video/mp4" });

function create(files: File[]) {
    const onFinished = vi.fn();
    const vm = new MediaUploadDialogViewModel({ files, isFileSizeAcceptable: (file) => file.size <= 1, onFinished });
    return { vm, onFinished };
}

describe("MediaUploadDialogViewModel", () => {
    afterEach(() => vi.restoreAllMocks());

    it.each([
        { files: [image], title: "Send an image" },
        { files: [video], title: "Send a video" },
        { files: [image, image], title: "2 images selected" },
        { files: [video, video], title: "2 videos selected" },
        { files: [image, video], title: "2 items selected" },
    ])("derives the title $title", ({ files, title }) => {
        const { vm } = create(files);
        expect(vm.getSnapshot().title).toBe(title);
        vm.dispose();
    });

    it("accepts original media, rejects unsupported/large additions, and clears stale errors", () => {
        const { vm, onFinished } = create([image]);
        vm.onAddFiles([video, new File(["a"], "a.txt"), new File(["large"], "large.png", { type: "image/png" })]);
        expect(vm.getSnapshot().items.map((item) => item.fileName)).toEqual([image.name, video.name]);
        expect(vm.getSnapshot().errors).toEqual([
            "Only images and videos can be added here. Skipped: a.txt",
            "Too large to upload: large.png",
        ]);
        vm.onAddFiles([]);
        expect(vm.getSnapshot().errors).toEqual([]);
        vm.onAddFiles([new File(["a"], "b.txt")]);
        vm.onRemoveItem(vm.getSnapshot().items[0].id);
        expect(vm.getSnapshot().errors).toEqual([]);
        vm.onSend();
        expect(onFinished).toHaveBeenCalledExactlyOnceWith(true, { files: [video], groupItems: false });
        vm.dispose();
    });

    it("blocks 61 grouped items, permits ungrouped, and recomputes the limit after removal", () => {
        const { vm, onFinished } = create(Array.from({ length: 61 }, () => image));
        expect(vm.getSnapshot()).toMatchObject({ canSend: false, canGroup: true });
        expect(vm.getSnapshot().errors[0]).toContain("60");
        vm.onSend();
        expect(onFinished).not.toHaveBeenCalled();
        vm.onGroupItemsChange(false);
        expect(vm.getSnapshot()).toMatchObject({ canSend: true, errors: [], showCaptionLastItemNote: true });
        vm.onGroupItemsChange(true);
        vm.onRemoveItem(vm.getSnapshot().items[0].id);
        expect(vm.getSnapshot()).toMatchObject({ canSend: true, errors: [], showCaptionLastItemNote: false });
        vm.onSend();
        expect(onFinished).toHaveBeenCalledExactlyOnceWith(true, {
            files: Array.from({ length: 60 }, () => image),
            groupItems: true,
        });
        vm.onCancel();
        vm.onSend();
        expect(onFinished).toHaveBeenCalledOnce();
        vm.dispose();
    });

    it("releases each preview on removal/disposal and cancels once after removing the last item", () => {
        vi.spyOn(URL, "createObjectURL").mockReturnValueOnce("blob:1").mockReturnValueOnce("blob:2");
        const revoke = vi.spyOn(URL, "revokeObjectURL");
        const { vm, onFinished } = create([image, video]);
        vm.onRemoveItem(vm.getSnapshot().items[0].id);
        expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:1");
        vm.dispose();
        expect(revoke.mock.calls).toEqual([["blob:1"], ["blob:2"]]);
        expect(onFinished).not.toHaveBeenCalled();
        const last = create([image]);
        last.vm.onRemoveItem(last.vm.getSnapshot().items[0].id);
        last.vm.onSend();
        last.vm.onCancel();
        expect(last.onFinished).toHaveBeenCalledExactlyOnceWith(false);
        last.vm.dispose();
    });
});

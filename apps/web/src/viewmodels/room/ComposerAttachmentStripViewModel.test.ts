/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import { ComposerAttachmentStripViewModel } from "./ComposerAttachmentStripViewModel";
import { MAX_GALLERY_ITEMS } from "../../utils/MediaCaptionContent";

describe("ComposerAttachmentStripViewModel", () => {
    afterEach(() => vi.restoreAllMocks());

    it("should keep duplicate names distinct and release previews on removal, take and disposal", () => {
        const create = vi
            .spyOn(URL, "createObjectURL")
            .mockReturnValueOnce("blob:1")
            .mockReturnValueOnce("blob:2")
            .mockReturnValueOnce("blob:3");
        const revoke = vi.spyOn(URL, "revokeObjectURL");
        const vm = new ComposerAttachmentStripViewModel();
        const image = new File(["a"], "same.png", { type: "image/png" });
        const video = new File(["b"], "same.png", { type: "video/mp4" });
        vm.addFiles([image, video]);
        expect(vm.files).toEqual([image, video]);
        expect(vm.getSnapshot().items.map((item) => item.kind)).toEqual(["image", "video"]);
        const ids = vm.getSnapshot().items.map((item) => item.id);
        expect(new Set(ids).size).toBe(2);
        vm.onRemoveItem(ids[0]);
        expect(revoke).toHaveBeenCalledWith("blob:1");
        expect(vm.takeFiles()).toEqual([video]);
        expect(vm.hasFiles).toBe(false);
        vm.addFiles([image]);
        vm.dispose();
        expect(create).toHaveBeenCalledTimes(3);
        expect(revoke.mock.calls.map(([url]) => url)).toEqual(["blob:1", "blob:2", "blob:3"]);
    });

    it("should reject an overflowing or non-media addition atomically", () => {
        const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
        const vm = new ComposerAttachmentStripViewModel();
        const files = Array.from(
            { length: MAX_GALLERY_ITEMS },
            (_, index) => new File(["a"], `${index}.png`, { type: "image/png" }),
        );
        vm.addFiles(files);
        expect(() => vm.addFiles([files[0]])).toThrow(RangeError);
        expect(() => vm.addFiles([new File(["text"], "a.txt")])).toThrow(RangeError);
        expect(vm.files).toEqual(files);
        expect(create).toHaveBeenCalledTimes(MAX_GALLERY_ITEMS);
        vm.dispose();
    });
});

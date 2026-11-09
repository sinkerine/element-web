/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { type MouseEvent } from "react";
import { waitFor } from "test-utils-rtl";
import { MsgType } from "matrix-js-sdk/src/matrix";

import { GalleryBodyViewModel } from "./GalleryBodyViewModel";
import { MediaEventHelper } from "../../utils/MediaEventHelper";
import { GALLERY_MSGTYPE, type GalleryEventContent } from "../../utils/MediaCaptionContent";

vi.mock("../../utils/MediaEventHelper");

const content: GalleryEventContent = {
    msgtype: GALLERY_MSGTYPE,
    body: "caption",
    itemtypes: [
        { itemtype: MsgType.Image, body: "one.png", url: "mxc://server/one" },
        {
            itemtype: MsgType.Video,
            body: "two.mp4",
            file: {
                url: "mxc://server/two",
                key: { alg: "A256CTR", ext: true, k: "key", key_ops: ["encrypt", "decrypt"], kty: "oct" },
                iv: "iv",
                hashes: { sha256: "hash" },
                v: "v2",
            },
        },
        { itemtype: MsgType.File, body: "three.txt", url: "mxc://server/three" },
    ],
};
const click = { preventDefault: vi.fn() } as unknown as MouseEvent<HTMLElement>;

describe("GalleryBodyViewModel", () => {
    const destroy = vi.fn();
    let fetchSource: ReturnType<typeof vi.fn<() => Promise<string>>>;
    beforeEach(() => {
        vi.clearAllMocks();
        fetchSource = vi.fn(() => Promise.resolve("blob:source"));
        vi.mocked(MediaEventHelper).mockImplementation(function () {
            return {
                sourceUrl: {
                    get value() {
                        return fetchSource();
                    },
                },
                thumbnailUrl: { value: Promise.resolve("blob:thumb") },
                destroy,
            } as unknown as MediaEventHelper;
        });
    });
    const create = (mediaVisible = true) =>
        new GalleryBodyViewModel({ content, mediaVisible, showMedia: vi.fn(), openLightbox: vi.fn() });

    it("does not resolve hidden media and loads each converted item after showing", async () => {
        const vm = create(false);
        expect(fetchSource).not.toHaveBeenCalled();
        expect(MediaEventHelper).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({ msgtype: "m.video", file: content.itemtypes[1].file }),
        );
        vm.setVisibility(true);
        await waitFor(() => expect(vm.getSnapshot().items[1].contentUrl).toBe("blob:source"));
        expect(fetchSource).toHaveBeenCalledTimes(3);
        vm.onItemLoad(0);
        expect(vm.getSnapshot().items[0].placeholder).toBe("none");
        vm.onItemError(1);
        expect(vm.getSnapshot().items[1].error).toBe(true);
        vm.dispose();
        expect(destroy).toHaveBeenCalledTimes(3);
    });

    it("opens the requested item with individual helpers, including videos and files", async () => {
        const openLightbox = vi.fn();
        const vm = new GalleryBodyViewModel({ content, mediaVisible: true, showMedia: vi.fn(), openLightbox });
        vm.onItemClick(1, click);
        await waitFor(() =>
            expect(openLightbox).toHaveBeenCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({
                        itemtype: "m.video",
                        name: "two.mp4",
                        mediaEventHelper: expect.anything(),
                    }),
                    expect.objectContaining({ itemtype: "m.file", name: "three.txt" }),
                ]),
                1,
            ),
        );
        vm.setVisibility(true, true);
        openLightbox.mockClear();
        vm.onItemClick(0, click);
        expect(openLightbox).not.toHaveBeenCalled();
        vm.dispose();
    });

    it("reports resolution errors", async () => {
        fetchSource.mockRejectedValue(new Error("decrypt failed"));
        const vm = create();
        await waitFor(() => expect(vm.getSnapshot().items.every((item) => item.error)).toBe(true));
        vm.dispose();
    });

    it("destroys URLs resolved after disposal and never opens a late lightbox", async () => {
        let resolve!: (value: string) => void;
        fetchSource.mockReturnValue(
            new Promise<string>((r) => {
                resolve = r;
            }),
        );
        const openLightbox = vi.fn();
        const vm = new GalleryBodyViewModel({ content, mediaVisible: true, showMedia: vi.fn(), openLightbox });
        vm.onItemClick(0, click);
        vm.dispose();
        resolve("blob:late");
        await waitFor(() => expect(destroy).toHaveBeenCalledTimes(6));
        expect(vm.getSnapshot().items[0].contentUrl).toBeNull();
        expect(openLightbox).not.toHaveBeenCalled();
    });
});

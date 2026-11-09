/*
Copyright 2025 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect, vi, afterEach } from "vitest";

import { type MediaEventContent, type VideoContent } from "matrix-js-sdk/src/types";
import { MatrixEvent } from "matrix-js-sdk/src/matrix";
import { stubClient } from "test-utils";

import { MediaEventHelper } from "./MediaEventHelper.ts";
import { cacheUploadedMedia, clearUploadedMediaCache } from "./UploadedMediaCache.ts";
import { GALLERY_MSGTYPE, STABLE_GALLERY_MSGTYPE, galleryItemToMediaContent } from "./MediaCaptionContent";
import * as DecryptFile from "./DecryptFile.ts";

describe("MediaEventHelper", () => {
    it("should set the mime type on the blob based on the event metadata", async () => {
        stubClient();

        const event = new MatrixEvent({
            type: "m.room.message",
            content: {
                msgtype: "m.image",
                body: "image.png",
                info: {
                    mimetype: "image/png",
                    size: 1234,
                    w: 100,
                    h: 100,
                    thumbnail_info: {
                        mimetype: "image/png",
                    },
                    thumbnail_url: "mxc://matrix.org/thumbnail",
                },
                url: "mxc://matrix.org/abcdef",
            },
        });
        const helper = new MediaEventHelper(event);

        const blob = await helper.thumbnailBlob.value;
        expect(blob?.type).toBe(event.getContent().info.thumbnail_info?.mimetype);
    });

    describe("gallery items", () => {
        afterEach(() => {
            vi.restoreAllMocks();
        });

        it.each([GALLERY_MSGTYPE, STABLE_GALLERY_MSGTYPE])(
            "should resolve the first unencrypted item of a %s MatrixEvent",
            async (msgtype) => {
                stubClient();
                const first = {
                    itemtype: "m.image",
                    body: "first.png",
                    url: "mxc://matrix.org/first",
                    info: { mimetype: "image/png", thumbnail_url: "mxc://matrix.org/first-thumbnail" },
                };
                const event = new MatrixEvent({
                    type: "m.room.message",
                    content: {
                        msgtype,
                        body: "Gallery caption",
                        itemtypes: [first, { ...first, body: "second.png", url: "mxc://matrix.org/second" }],
                    },
                });
                expect(MediaEventHelper.isEligible(event)).toBe(true);
                const helper = new MediaEventHelper(event);
                expect(helper.fileName).toBe("first.png");
                expect(helper.media.srcMxc).toBe(first.url);
                expect(helper.media.thumbnailMxc).toBe(first.info.thumbnail_url);
                expect(helper.media.isEncrypted).toBe(false);
                await expect(helper.sourceUrl.value).resolves.toBe(helper.media.srcHttp);
                expect(event.getContent().itemtypes[0]).toBe(first);
                expect(event.getContent().itemtypes[0].info).toBe(first.info);
                expect(event.getContent().body).toBe("Gallery caption");
            },
        );

        it.each([GALLERY_MSGTYPE, STABLE_GALLERY_MSGTYPE])(
            "should resolve and decrypt the first encrypted item of a %s MatrixEvent",
            async (msgtype) => {
                stubClient();
                const first = {
                    itemtype: "m.video",
                    body: "first.mp4",
                    filename: "original.mp4",
                    file: { url: "mxc://matrix.org/first" },
                    info: {
                        mimetype: "video/mp4",
                        thumbnail_file: { url: "mxc://matrix.org/first-thumbnail" },
                        thumbnail_info: { mimetype: "image/jpeg" },
                    },
                };
                const event = new MatrixEvent({
                    type: "m.room.message",
                    content: {
                        msgtype,
                        body: "Gallery caption",
                        itemtypes: [first, { ...first, file: { url: "mxc://matrix.org/second" } }],
                    },
                });
                const source = new Blob(["video"], { type: "video/mp4" });
                const thumbnail = new Blob(["thumbnail"], { type: "image/jpeg" });
                const decrypt = vi
                    .spyOn(DecryptFile, "decryptFile")
                    .mockResolvedValueOnce(source)
                    .mockResolvedValueOnce(thumbnail);
                expect(MediaEventHelper.isEligible(event)).toBe(true);
                const helper = new MediaEventHelper(event);
                expect(helper.fileName).toBe("original.mp4");
                expect(helper.media.srcMxc).toBe(first.file.url);
                expect(helper.media.thumbnailMxc).toBe(first.info.thumbnail_file.url);
                expect(helper.media.isEncrypted).toBe(true);
                await expect(helper.sourceBlob.value).resolves.toBe(source);
                await expect(helper.thumbnailBlob.value).resolves.toBe(thumbnail);
                expect(decrypt.mock.calls[0][0]).toBe(first.file);
                expect(decrypt.mock.calls[0][1]).toBe(first.info);
                expect(decrypt.mock.calls[1][0]).toBe(first.info.thumbnail_file);
                expect(decrypt.mock.calls[1][1]).toBe(first.info.thumbnail_info);
                expect(event.getContent().itemtypes[0]).toBe(first);
                expect(event.getContent().body).toBe("Gallery caption");
            },
        );

        it("should download and decrypt an individual encrypted item's source and thumbnail", async () => {
            stubClient();
            const content = galleryItemToMediaContent({
                itemtype: "m.video",
                body: "video.mp4",
                filename: "original.mp4",
                file: { url: "mxc://matrix.org/video" } as MediaEventContent["file"],
                info: {
                    mimetype: "video/mp4",
                    thumbnail_file: { url: "mxc://matrix.org/video-thumbnail" } as MediaEventContent["file"],
                    thumbnail_info: { mimetype: "image/jpeg" },
                },
            });
            const source = new Blob(["video"], { type: "video/mp4" });
            const thumbnail = new Blob(["thumbnail"], { type: "image/jpeg" });
            const decrypt = vi
                .spyOn(DecryptFile, "decryptFile")
                .mockResolvedValueOnce(source)
                .mockResolvedValueOnce(thumbnail);
            const helper = new MediaEventHelper(content);
            expect(helper.fileName).toBe("original.mp4");
            expect(helper.media.srcMxc).toBe(content.file!.url);
            expect(helper.media.isEncrypted).toBe(true);
            await expect(helper.sourceBlob.value).resolves.toBe(source);
            await expect(helper.thumbnailBlob.value).resolves.toBe(thumbnail);
            expect(decrypt).toHaveBeenNthCalledWith(1, content.file, content.info);
            expect(decrypt).toHaveBeenNthCalledWith(
                2,
                (content as VideoContent).info!.thumbnail_file,
                (content as VideoContent).info!.thumbnail_info,
            );
        });

        it("should use the item's filename fallback and source URL for unencrypted content", async () => {
            stubClient();
            const content = galleryItemToMediaContent({
                itemtype: "m.image",
                body: "second.png",
                url: "mxc://matrix.org/second",
            });
            const helper = new MediaEventHelper(content);
            expect(helper.fileName).toBe("second.png");
            expect(helper.media.srcMxc).toBe("mxc://matrix.org/second");
            await expect(helper.sourceUrl.value).resolves.toBe(helper.media.srcHttp);
            await expect(helper.thumbnailBlob.value).resolves.toBeNull();
            expect(new MediaEventHelper({ ...content, body: "" }).fileName).toBe("download");
        });

        it.each([GALLERY_MSGTYPE, STABLE_GALLERY_MSGTYPE])("should allow hiding and handling %s events", (msgtype) => {
            const event = new MatrixEvent({
                type: "m.room.message",
                content: {
                    msgtype,
                    body: "",
                    itemtypes: [{ itemtype: "m.image", body: "photo.png", url: "mxc://matrix.org/photo" }],
                },
            });
            expect(MediaEventHelper.isEligible(event)).toBe(true);
            expect(MediaEventHelper.canHide(event)).toBe(true);
            vi.spyOn(event, "isRedacted").mockReturnValue(true);
            expect(MediaEventHelper.isEligible(event)).toBe(false);
            expect(MediaEventHelper.canHide(event)).toBe(false);
        });

        it("should reject malformed gallery events and preserve single-media eligibility", () => {
            const event = (msgtype: string, type = "m.room.message"): MatrixEvent =>
                new MatrixEvent({ type, content: { msgtype, body: "" } });
            expect(MediaEventHelper.isEligible(event(GALLERY_MSGTYPE))).toBe(false);
            expect(MediaEventHelper.canHide(event(GALLERY_MSGTYPE))).toBe(false);
            expect(MediaEventHelper.isEligible(event("", "m.sticker"))).toBe(true);
            expect(MediaEventHelper.isEligible(event("m.text"))).toBe(false);
            expect(MediaEventHelper.isEligible(event("m.image", "m.room.topic"))).toBe(false);
            for (const type of ["m.image", "m.video", "m.audio", "m.file"]) {
                expect(MediaEventHelper.isEligible(event(type))).toBe(true);
                expect(MediaEventHelper.canHide(event(type))).toBe(["m.image", "m.video"].includes(type));
            }
        });
    });

    describe("for media this client uploaded", () => {
        const uploaded = new Blob(["uploaded bytes"], { type: "image/png" });
        const thumbnail = new Blob(["thumbnail bytes"], { type: "image/jpeg" });

        afterEach(() => {
            clearUploadedMediaCache();
            vi.restoreAllMocks();
        });

        it("serves an encrypted source and thumbnail from memory instead of downloading and decrypting", async () => {
            stubClient();
            const decrypt = vi.spyOn(DecryptFile, "decryptFile");
            cacheUploadedMedia("mxc://matrix.org/source", uploaded);
            cacheUploadedMedia("mxc://matrix.org/thumbnail", thumbnail);
            const event = new MatrixEvent({
                type: "m.room.message",
                content: {
                    msgtype: "m.image",
                    body: "image.png",
                    info: {
                        mimetype: "image/png",
                        thumbnail_info: { mimetype: "image/jpeg" },
                        thumbnail_file: { url: "mxc://matrix.org/thumbnail" },
                    },
                    file: { url: "mxc://matrix.org/source" },
                },
            });
            const helper = new MediaEventHelper(event);

            expect(helper.isFromLocalUpload).toBe(true);
            await expect((await helper.sourceBlob.value).text()).resolves.toBe("uploaded bytes");
            await expect((await helper.thumbnailBlob.value)!.text()).resolves.toBe("thumbnail bytes");
            expect(decrypt).not.toHaveBeenCalled();
        });

        it("hands out an object URL for an unencrypted upload and revokes it on destroy", async () => {
            stubClient();
            const revoke = vi.spyOn(URL, "revokeObjectURL");
            cacheUploadedMedia("mxc://matrix.org/source", uploaded);
            const event = new MatrixEvent({
                type: "m.room.message",
                content: { msgtype: "m.image", body: "image.png", url: "mxc://matrix.org/source" },
            });
            const helper = new MediaEventHelper(event);

            const url = await helper.sourceUrl.value;
            expect(url).toMatch(/^blob:/);
            expect(url).not.toBe(helper.media.srcHttp);
            helper.destroy();
            expect(revoke).toHaveBeenCalledWith(url);
        });

        it("still uses the server for media someone else uploaded", async () => {
            stubClient();
            const event = new MatrixEvent({
                type: "m.room.message",
                content: { msgtype: "m.image", body: "image.png", url: "mxc://matrix.org/other" },
            });
            const helper = new MediaEventHelper(event);

            expect(helper.isFromLocalUpload).toBe(false);
            await expect(helper.sourceUrl.value).resolves.toBe(helper.media.srcHttp);
        });
    });
});

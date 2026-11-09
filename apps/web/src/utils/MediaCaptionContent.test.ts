/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { MsgType, type IContent } from "matrix-js-sdk/src/matrix";

import { describe, expect, it } from "vitest";

import {
    getMediaCaption,
    getMediaFileName,
    isCaptionableContent,
    withMediaCaption,
    GALLERY_MSGTYPE,
    STABLE_GALLERY_MSGTYPE,
    GALLERY_MSGTYPES,
    GALLERY_ITEM_MSGTYPES,
    MAX_GALLERY_ITEMS,
    createGalleryEventContent,
    galleryItemToMediaContent,
    isGalleryContent,
    isGalleryItemFile,
    type GalleryItemContent,
} from "./MediaCaptionContent";

const image: GalleryItemContent = {
    itemtype: MsgType.Image,
    body: "photo.png",
    url: "mxc://example.org/photo",
    info: { mimetype: "image/png", size: 123, w: 800, h: 600 },
};
const gallery = (overrides: IContent = {}): IContent => ({
    msgtype: GALLERY_MSGTYPE,
    body: "",
    itemtypes: [image],
    ...overrides,
});

// Keep this suite in the node environment: content helpers must not require editor or UI initialization.
describe("MediaCaptionContent", () => {
    it("should read and replace an encrypted attachment caption without changing its media", () => {
        const content = {
            msgtype: "m.image",
            body: "A caption",
            filename: "photo.png",
            file: { url: "mxc://example.org/photo" },
            info: { mimetype: "image/png" },
        };

        expect(isCaptionableContent(content)).toBe(true);
        expect(getMediaFileName(content)).toBe("photo.png");
        expect(getMediaCaption(content)).toEqual({ body: "A caption" });
        const replacement = withMediaCaption(content, "photo.png", { body: "Updated caption" });
        expect(replacement).toEqual({ ...content, body: "Updated caption" });
        expect(replacement.file).toBe(content.file);
        expect(replacement.info).toBe(content.info);
        expect(content.body).toBe("A caption");
    });

    it("should distinguish a filename-only attachment from a caption", () => {
        expect(getMediaCaption({ filename: "photo.png", body: "photo.png" })).toBeNull();
        expect(getMediaFileName({})).toBe("Attachment");
    });
});

describe("MediaCaptionContent galleries", () => {
    it("should expose the approved wire types and outgoing item limit", () => {
        expect([...GALLERY_MSGTYPES]).toEqual(["dm.filament.gallery", "m.gallery"]);
        expect([...GALLERY_ITEM_MSGTYPES]).toEqual(["m.image", "m.video"]);
        expect(MAX_GALLERY_ITEMS).toBe(60);
    });

    it.each(["image/png", "image/gif", "image/svg+xml", "video/mp4", "video/webm"])(
        "should group MIME type %s",
        (type) => expect(isGalleryItemFile({ type })).toBe(true),
    );
    it.each(["", "image/", "image", "application/pdf", "audio/ogg", "text/plain", "ximage/png"])(
        "should reject MIME type %s",
        (type) => expect(isGalleryItemFile({ type })).toBe(false),
    );

    it.each([GALLERY_MSGTYPE, STABLE_GALLERY_MSGTYPE])("should accept gallery type %s", (msgtype) => {
        const content = gallery({ msgtype });
        expect(isGalleryContent(content)).toBe(true);
        expect(isCaptionableContent(content)).toBe(true);
        expect(getMediaCaption(content)).toBeNull();
        expect(getMediaCaption({ ...content, body: " \n " })).toBeNull();
        expect(getMediaCaption({ ...content, body: "photo.png" })).toEqual({ body: "photo.png" });
    });

    it.each([MsgType.Image, MsgType.Video, MsgType.Audio, MsgType.File])(
        "should accept incoming %s items and retain their media metadata",
        (itemtype) => {
            const item = { ...image, itemtype };
            expect(isGalleryContent(gallery({ itemtypes: [item] }))).toBe(true);
            const converted = galleryItemToMediaContent(item);
            expect(converted).toEqual({ msgtype: itemtype, body: image.body, url: image.url, info: image.info });
            expect(converted.info).toBe(item.info);
            expect(converted).not.toHaveProperty("itemtype");
            expect(item.itemtype).toBe(itemtype);
        },
    );

    it.each([
        { msgtype: "m.text" },
        { body: undefined },
        { body: 7 },
        { itemtypes: undefined },
        { itemtypes: {} },
        { itemtypes: [] },
        { itemtypes: [null] },
        { itemtypes: ["image"] },
        { itemtypes: [{ ...image, itemtype: "unknown" }] },
        { itemtypes: [{ ...image, body: 1 }] },
        { itemtypes: [{ ...image, url: "" }] },
        { itemtypes: [{ ...image, url: "  " }] },
        { itemtypes: [{ ...image, url: undefined, file: {} }] },
        { itemtypes: [{ ...image, url: undefined, file: { url: 1 } }] },
        { itemtypes: [{ ...image, info: [] }] },
        { itemtypes: [{ ...image, filename: 123 }] },
        { itemtypes: [{ ...image, formatted_body: 1 }] },
        { formatted_body: 1 },
        { itemtypes: [image, null] },
        { itemtypes: [image, { ...image, url: undefined }] },
    ])("should reject malformed incoming gallery %j", (overrides) => {
        const content = gallery(overrides);
        const snapshot = structuredClone(content);
        expect(isGalleryContent(content)).toBe(false);
        expect(isCaptionableContent(content)).toBe(false);
        expect(content).toEqual(snapshot);
    });

    it("should accept incoming galleries larger than the outgoing limit", () => {
        expect(isGalleryContent(gallery({ itemtypes: Array.from({ length: 61 }, () => image) }))).toBe(true);
    });

    it("should create galleries in item order and replace captions without changing encrypted media", () => {
        const encrypted: GalleryItemContent = {
            itemtype: MsgType.Video,
            body: "clip.mp4",
            file: {
                url: "mxc://example.org/clip",
                key: { kty: "oct", alg: "A256CTR", ext: true, key_ops: ["encrypt", "decrypt"], k: "key" },
                iv: "iv",
                hashes: { sha256: "hash" },
                v: "v2",
            },
            info: {
                mimetype: "video/mp4",
                thumbnail_file: {
                    url: "mxc://example.org/thumb",
                    key: { kty: "oct", alg: "A256CTR", ext: true, key_ops: ["encrypt", "decrypt"], k: "thumb-key" },
                    iv: "iv",
                    hashes: { sha256: "hash" },
                    v: "v2",
                },
            },
        };
        const items = [image, encrypted];
        const caption = {
            body: "**Weekend**",
            format: "org.matrix.custom.html" as const,
            formatted_body: "<strong>Weekend</strong>",
        };
        const content = createGalleryEventContent(items, caption);
        expect(content).toEqual({ msgtype: GALLERY_MSGTYPE, ...caption, itemtypes: items });
        expect(content.itemtypes).not.toBe(items);
        expect(content.itemtypes[1].file).toBe(encrypted.file);
        expect(isGalleryContent(content)).toBe(true);
        expect(getMediaCaption(content)).toEqual(caption);
        expect(galleryItemToMediaContent(encrypted).file).toBe(encrypted.file);
        expect(galleryItemToMediaContent(encrypted).info).toBe(encrypted.info);
        const original = structuredClone(content);
        const plain = withMediaCaption(content, "unused.png", { body: "replacement" });
        expect(plain.body).toBe("replacement");
        expect(plain).not.toHaveProperty("format");
        expect(plain).not.toHaveProperty("formatted_body");
        expect(plain).not.toHaveProperty("filename");
        const cleared = withMediaCaption(content, "unused.png", null);
        expect(cleared).toEqual({ msgtype: GALLERY_MSGTYPE, body: "", itemtypes: items });
        expect(cleared.itemtypes).toBe(content.itemtypes);
        expect(content).toEqual(original);
        expect(createGalleryEventContent(items, null)).toEqual(cleared);
    });

    it.each([0, 1, 61])("should reject outgoing item count %s", (length) => {
        expect(() =>
            createGalleryEventContent(
                Array.from({ length }, () => image),
                null,
            ),
        ).toThrow(RangeError);
    });
    it.each([2, 60])("should accept outgoing item count %s", (length) => {
        expect(
            createGalleryEventContent(
                Array.from({ length }, () => image),
                null,
            ).itemtypes,
        ).toHaveLength(length);
    });
    it.each([MsgType.Audio, MsgType.File, "unknown"])("should reject outgoing %s items", (itemtype) => {
        expect(() => createGalleryEventContent([image, { ...image, itemtype }], null)).toThrow(TypeError);
    });
    it("should reject malformed outgoing media", () => {
        expect(() => createGalleryEventContent([image, { ...image, url: undefined }], null)).toThrow(TypeError);
    });
});

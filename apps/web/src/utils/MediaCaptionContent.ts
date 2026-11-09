/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type IContent, MsgType } from "matrix-js-sdk/src/matrix";
import { type EncryptedFile, type MediaEventContent, type MediaEventInfo } from "matrix-js-sdk/src/types";

import { _t } from "../languageHandler";

/** Message types that can carry a caption (Matrix v1.10, MSC2530). */
export const CAPTIONABLE_MSGTYPES: ReadonlySet<string> = new Set([
    MsgType.Image,
    MsgType.Video,
    MsgType.Audio,
    MsgType.File,
]);

/** MSC4274 message type used for sending galleries. */
export const GALLERY_MSGTYPE = "dm.filament.gallery";
/** Proposed stable MSC4274 message type accepted on receipt. */
export const STABLE_GALLERY_MSGTYPE = "m.gallery";
/** Gallery message types accepted on receipt. */
export const GALLERY_MSGTYPES: ReadonlySet<string> = new Set([GALLERY_MSGTYPE, STABLE_GALLERY_MSGTYPE]);
/** Media types eligible for outgoing gallery grouping. */
export const GALLERY_ITEM_MSGTYPES: ReadonlySet<string> = new Set([MsgType.Image, MsgType.Video]);
/** Maximum number of items in an outgoing gallery. */
export const MAX_GALLERY_ITEMS = 60;

/** A single item inside an MSC4274 gallery event's `itemtypes` array. */
export interface GalleryItemContent {
    itemtype: MsgType.Image | MsgType.Video | MsgType.Audio | MsgType.File | string;
    body: string;
    filename?: string;
    info?: MediaEventInfo;
    url?: string;
    file?: EncryptedFile;
    format?: "org.matrix.custom.html";
    formatted_body?: string;
}

/** Content of an MSC4274 `dm.filament.gallery` / `m.gallery` event. */
export interface GalleryEventContent extends IContent {
    msgtype: typeof GALLERY_MSGTYPE | typeof STABLE_GALLERY_MSGTYPE;
    body: string;
    format?: "org.matrix.custom.html";
    formatted_body?: string;
    itemtypes: GalleryItemContent[];
}

/** Whether a File or MIME holder is an image or video eligible for gallery grouping. */
export function isGalleryItemFile(file: { type: string }): boolean {
    return /^(image|video)\/[^\s]+$/i.test(file.type);
}

function isGalleryItemContent(item: unknown): item is GalleryItemContent {
    if (!item || typeof item !== "object") return false;
    const content = item as Record<string, unknown>;
    const file = content.file;
    return (
        typeof content.itemtype === "string" &&
        CAPTIONABLE_MSGTYPES.has(content.itemtype) &&
        typeof content.body === "string" &&
        (content.filename === undefined || typeof content.filename === "string") &&
        (content.info === undefined ||
            (!!content.info && typeof content.info === "object" && !Array.isArray(content.info))) &&
        (content.url === undefined || typeof content.url === "string") &&
        (file === undefined ||
            (!!file &&
                typeof file === "object" &&
                !Array.isArray(file) &&
                "url" in file &&
                typeof file.url === "string")) &&
        ((typeof content.url === "string" && !!content.url.trim()) ||
            (!!file &&
                typeof file === "object" &&
                "url" in file &&
                typeof file.url === "string" &&
                !!file.url.trim())) &&
        (content.format === undefined || content.format === "org.matrix.custom.html") &&
        (content.formatted_body === undefined || typeof content.formatted_body === "string")
    );
}

/** Whether content is an MSC4274 gallery with at least one valid media item. */
export function isGalleryContent(content: IContent): content is GalleryEventContent {
    return (
        GALLERY_MSGTYPES.has(content.msgtype ?? "") &&
        typeof content.body === "string" &&
        (content.format === undefined || content.format === "org.matrix.custom.html") &&
        (content.formatted_body === undefined || typeof content.formatted_body === "string") &&
        Array.isArray(content.itemtypes) &&
        content.itemtypes.length > 0 &&
        content.itemtypes.every(isGalleryItemContent)
    );
}

/** Convert a gallery item for helpers which consume single media content, retaining its attachment identity. */
export function galleryItemToMediaContent(item: GalleryItemContent): MediaEventContent {
    const { itemtype, ...content } = item;
    return { ...content, msgtype: itemtype } as MediaEventContent;
}

/** Build outgoing MSC4274 content; callers handle the single-item fallback before calling this helper. */
export function createGalleryEventContent(
    items: GalleryItemContent[],
    caption: MediaCaptionFields | null,
): GalleryEventContent {
    if (items.length < 2 || items.length > MAX_GALLERY_ITEMS) {
        throw new RangeError(`Galleries require 2 to ${MAX_GALLERY_ITEMS} items`);
    }
    if (!items.every((item) => isGalleryItemContent(item) && GALLERY_ITEM_MSGTYPES.has(item.itemtype))) {
        throw new TypeError("Outgoing galleries require valid image or video items");
    }
    return withMediaCaption({ msgtype: GALLERY_MSGTYPE, body: "", itemtypes: [...items] }, "", caption);
}

/** The caption fields of a media event's content. */
export interface MediaCaptionFields {
    /** Plain text (markdown source) of the caption. */
    body: string;
    format?: "org.matrix.custom.html";
    /** HTML caption; set together with `format`. */
    formatted_body?: string;
}

/** Whether content has captionable media, excluding voice messages. */
export function isCaptionableContent(content: IContent): boolean {
    return (
        isGalleryContent(content) ||
        (CAPTIONABLE_MSGTYPES.has(content.msgtype ?? "") &&
            !!(content.url || content.file) &&
            !content["org.matrix.msc3245.voice"])
    );
}

/** The original file name, falling back to the body or a translated attachment label. */
export function getMediaFileName(content: IContent): string {
    return content.filename || content.body || _t("common|attachment");
}

/** Read a gallery caption, or a single-media caption whose body differs from its filename. */
export function getMediaCaption(content: IContent): MediaCaptionFields | null {
    if (isGalleryContent(content)) {
        if (!content.body.trim()) return null;
    } else if (!content.filename || content.filename === content.body) return null;
    const caption: MediaCaptionFields = { body: content.body };
    if (content.format === "org.matrix.custom.html" && content.formatted_body) {
        caption.format = content.format;
        caption.formatted_body = content.formatted_body;
    }
    return caption;
}

/** Apply or remove a caption on a copy of the content, preserving the media and other fields. */
export function withMediaCaption<T extends IContent>(
    content: T,
    fileName: string,
    caption: MediaCaptionFields | null,
): T {
    const result = { ...content };
    delete result.format;
    delete result.formatted_body;
    if (isGalleryContent(content)) {
        delete result.filename;
        Object.assign(result, caption ?? { body: "" });
    } else if (caption) {
        Object.assign(result, caption, { filename: fileName });
    } else {
        Object.assign(result, { body: fileName });
    }
    return result;
}

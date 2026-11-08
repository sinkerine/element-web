/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type IContent, type MatrixEvent, MsgType } from "matrix-js-sdk/src/matrix";
import { type RoomMessageEventContent } from "matrix-js-sdk/src/types";

import type EditorModel from "../editor/model";
import { htmlSerializeIfNeeded, textSerialize } from "../editor/serialize";
import { _t } from "../languageHandler";
import SettingsStore from "../settings/SettingsStore";
import { attachMentions, attachRelation } from "./messages";

/** Message types that can carry a caption (Matrix v1.10, MSC2530). */
export const CAPTIONABLE_MSGTYPES: ReadonlySet<string> = new Set([
    MsgType.Image,
    MsgType.Video,
    MsgType.Audio,
    MsgType.File,
]);

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
        CAPTIONABLE_MSGTYPES.has(content.msgtype ?? "") &&
        !!(content.url || content.file) &&
        !content["org.matrix.msc3245.voice"]
    );
}

/** The original file name, falling back to the body or a translated attachment label. */
export function getMediaFileName(content: IContent): string {
    return content.filename || content.body || _t("common|attachment");
}

/** The caption, or null when filename is missing, empty or equal to the body. */
export function getMediaCaption(content: IContent): MediaCaptionFields | null {
    if (!content.filename || content.filename === content.body) return null;
    const caption: MediaCaptionFields = { body: content.body };
    if (content.format === "org.matrix.custom.html" && content.formatted_body) {
        caption.format = content.format;
        caption.formatted_body = content.formatted_body;
    }
    return caption;
}

/** Serialize a caption like a text message; a blank editor model has no caption. */
export function createMediaCaptionFields(model: EditorModel): MediaCaptionFields | null {
    const body = textSerialize(model);
    if (!body.trim()) return null;
    const caption: MediaCaptionFields = { body };
    const formattedBody = htmlSerializeIfNeeded(model, {
        useMarkdown: SettingsStore.getValue("MessageComposerInput.useMarkdown"),
    });
    if (formattedBody) {
        caption.format = "org.matrix.custom.html";
        caption.formatted_body = formattedBody;
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
    if (caption) {
        Object.assign(result, caption, { filename: fileName });
    } else {
        Object.assign(result, { body: fileName });
    }
    return result;
}

/** Build a caption replacement with edit fallbacks, a replacement relation and intentional mentions. */
export function createMediaCaptionEditContent(
    model: EditorModel,
    editedEvent: MatrixEvent,
    replyToEvent?: MatrixEvent,
): RoomMessageEventContent {
    const current = { ...editedEvent.getContent() };
    delete current["m.relates_to"];
    delete current["m.mentions"];
    const newContent = withMediaCaption(current, getMediaFileName(current), createMediaCaptionFields(model));
    const content: IContent = {
        ...newContent,
        "body": `* ${newContent.body}`,
        "m.new_content": newContent,
    };
    if (newContent.formatted_body) {
        content.formatted_body = `* ${newContent.formatted_body}`;
    }
    attachMentions(editedEvent.sender!.userId, content, model, replyToEvent, editedEvent.getContent());
    attachRelation(content, { rel_type: "m.replace", event_id: editedEvent.getId() });
    return content as RoomMessageEventContent;
}

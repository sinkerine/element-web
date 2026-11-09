/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type IContent, type MatrixEvent } from "matrix-js-sdk/src/matrix";
import { type RoomMessageEventContent } from "matrix-js-sdk/src/types";

import type EditorModel from "../editor/model";
import { htmlSerializeIfNeeded, textSerialize } from "../editor/serialize";
import SettingsStore from "../settings/SettingsStore";
import { attachMentions, attachRelation } from "./messages";
import { getMediaFileName, withMediaCaption, type MediaCaptionFields } from "./MediaCaptionContent";

export { type MediaCaptionFields, isCaptionableContent, withMediaCaption } from "./MediaCaptionContent";

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

/** Build a single-media or gallery caption replacement with edit fallbacks, a relation and intentional mentions. */
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

/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type RefObject, useContext, useEffect, useRef } from "react";
import { MatrixEvent } from "matrix-js-sdk/src/matrix";
import escapeHtml from "escape-html";

import { RoomUploadContext } from "../../../../../viewmodels/room/RoomUploadViewModel";
import { useScopedRoomContext } from "../../../../../contexts/ScopedRoomContext";
import { useMatrixClientContext } from "../../../../../contexts/MatrixClientContext";
import { parseEvent } from "../../../../../editor/deserialize";
import { PartCreator, type SerializedPart, Type } from "../../../../../editor/parts";
import EditorModel from "../../../../../editor/model";
import { htmlSerializeIfNeeded } from "../../../../../editor/serialize";
import SendHistoryManager from "../../../../../SendHistoryManager";
import { makeGenericPermalink } from "../../../../../utils/permalinks/Permalinks";

/** Connect the send editor to uploads without routing captions through slash command handling. */
export function useCaptionDraft(
    content: RefObject<string>,
    isRichTextEnabled: boolean,
    reset: (content: string) => void,
): void {
    const uploadVm = useContext(RoomUploadContext);
    const { room, replyToEvent, threadId } = useScopedRoomContext("room", "replyToEvent", "threadId");
    const client = useMatrixClientContext();
    const latest = useRef({ isRichTextEnabled, reset, replyToEvent });
    latest.current = { isRichTextEnabled, reset, replyToEvent };

    useEffect(() => {
        if (!uploadVm || !room) return;
        let active = true;
        const partCreator = new PartCreator(room, client);
        const history = new SendHistoryManager(room.roomId, "mx_cider_history_");
        const modelFromParts = (parts: SerializedPart[]): EditorModel => {
            const model = new EditorModel([], partCreator);
            model.reset(parts);
            return model;
        };
        const getParts = (): SerializedPart[] | null => {
            const draftDocument = new DOMParser().parseFromString(content.current, "text/html");
            for (const mention of draftDocument.querySelectorAll("a")) {
                const href = mention.getAttribute("href");
                // Rich message HTML can omit the editor-only mention attribute.
                if (
                    mention.getAttribute("data-mention-type") === "at-room" ||
                    ((!href || href === "#") && mention.textContent === "@room")
                ) {
                    mention.replaceWith("@room");
                }
            }
            if (!latest.current.isRichTextEnabled) {
                // Plain editors use literal newlines; event HTML parsing otherwise ignores isolated newline nodes.
                const walker = draftDocument.createTreeWalker(draftDocument.body, NodeFilter.SHOW_TEXT);
                const textNodes: Text[] = [];
                for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                    if (!node.parentElement?.closest("a")) textNodes.push(node as Text);
                }
                for (const node of textNodes) {
                    const lines = node.data.split(/\r\n|\r|\n/);
                    if (lines.length === 1) continue;
                    const fragment = draftDocument.createDocumentFragment();
                    for (const [index, line] of lines.entries()) {
                        if (index) fragment.append(draftDocument.createElement("br"));
                        fragment.append(draftDocument.createTextNode(line));
                    }
                    node.replaceWith(fragment);
                }
            }
            const text = draftDocument.body.textContent ?? "";
            if (!text.trim() || (text.startsWith("/") && !text.startsWith("//"))) return null;
            // Plain mode contains escaped text and mention anchors; only rich mode needs Markdown escaping.
            return parseEvent(
                new MatrixEvent({
                    content: {
                        body: text,
                        format: "org.matrix.custom.html",
                        formatted_body: draftDocument.body.innerHTML,
                    },
                }),
                partCreator,
                { shouldEscape: latest.current.isRichTextEnabled },
            ).map((part) => part.serialize());
        };
        uploadVm.setCaptionDraftSource({
            getCaptionDraft: getParts,
            getCaptionUseMarkdown: () => (latest.current.isRichTextEnabled ? true : undefined),
            clearCaptionDraft: () => {
                if (!active) return;
                const parts = getParts();
                if (parts) history.save(modelFromParts(parts), latest.current.replyToEvent);
                latest.current.reset("");
            },
            restoreCaptionDraft: (parts) => {
                if (!active || new DOMParser().parseFromString(content.current, "text/html").body.textContent?.trim()) {
                    return;
                }
                const atRoomMention = '<a href="#" data-mention-type="at-room" contenteditable="false">@room</a>';
                let restored: string;
                if (latest.current.isRichTextEnabled) {
                    const richParts = parts.map((part): SerializedPart =>
                        part.type === Type.AtRoomPill ? { type: Type.Plain, text: "[@room](#)" } : part,
                    );
                    const html = htmlSerializeIfNeeded(modelFromParts(richParts), { forceHTML: true })!;
                    const restoredDocument = new DOMParser().parseFromString(html, "text/html");
                    for (const mention of restoredDocument.querySelectorAll('a[href="#"]')) {
                        if (mention.textContent !== "@room") continue;
                        mention.setAttribute("data-mention-type", "at-room");
                        mention.setAttribute("contenteditable", "false");
                    }
                    // WYS imports adjacent paragraphs with one break; caption parts represent that boundary with two.
                    for (const paragraph of restoredDocument.querySelectorAll("p")) {
                        const previous = paragraph.previousElementSibling;
                        if (previous?.tagName !== "P") continue;
                        previous.append(
                            restoredDocument.createElement("br"),
                            restoredDocument.createElement("br"),
                            ...paragraph.childNodes,
                        );
                        paragraph.remove();
                    }
                    // Markdown drops final line breaks, but they are meaningful while editing a draft.
                    let trailingNewlines = 0;
                    for (let index = parts.length - 1; index >= 0 && parts[index].type === Type.Newline; index--) {
                        trailingNewlines++;
                    }
                    const lastElement = restoredDocument.body.lastElementChild;
                    const newlineParent = lastElement?.tagName === "P" ? lastElement : restoredDocument.body;
                    for (let index = 0; index < trailingNewlines; index++) {
                        newlineParent.append(restoredDocument.createElement("br"));
                    }
                    restored = restoredDocument.body.innerHTML;
                } else {
                    restored = parts
                        .map((part) => {
                            if (part.type === Type.Newline) return "\n";
                            const text = escapeHtml(part.text);
                            if (part.type === Type.AtRoomPill) return atRoomMention;
                            if (part.type === Type.UserPill || part.type === Type.RoomPill) {
                                const href = escapeHtml(makeGenericPermalink(part.resourceId!, true));
                                const type = part.type === Type.UserPill ? "user" : "room";
                                return `<a href="${href}" data-mention-type="${type}" contenteditable="false">${text}</a>`;
                            }
                            return text;
                        })
                        .join("");
                }
                latest.current.reset(restored);
            },
        });
        return () => {
            active = false;
            uploadVm.setCaptionDraftSource(null);
        };
    }, [uploadVm, room, threadId, client, content]);
}

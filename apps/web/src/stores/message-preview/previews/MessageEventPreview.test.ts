/*
Copyright 2024 New Vector Ltd.
Copyright 2022 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect, beforeAll, vi } from "vitest";
import { RelationType, RoomMember, Room } from "matrix-js-sdk/src/matrix";
import { mkEvent, stubClient } from "test-utils";

// Import directly from the file to avoid circular dependencies with MessagePreviewStore
import { MatrixClientPeg } from "../../../MatrixClientPeg";
import { MessageEventPreview } from "./MessageEventPreview";

describe("MessageEventPreview", () => {
    const preview = new MessageEventPreview();
    const userId = "@user:example.com";

    beforeAll(() => {
        stubClient();
    });

    describe.each(["dm.filament.gallery", "m.gallery"])("%s previews", (msgtype) => {
        it.each([false, true])("should preview captions and cleared captions (replacement: %s)", (replacement) => {
            const content = {
                msgtype,
                body: "caption",
                itemtypes: [
                    { itemtype: "m.image", body: "photo.png", url: "mxc://server/image" },
                    { itemtype: "m.video", body: "clip.mp4", file: { url: "mxc://server/video" } },
                ],
                format: "org.matrix.custom.html",
                formatted_body: "<strong>caption</strong>",
            };
            const event = mkEvent({
                event: true,
                user: userId,
                type: "m.room.message",
                content: replacement
                    ? {
                          "m.new_content": content,
                          "m.relates_to": { rel_type: RelationType.Replace, event_id: "$original" },
                      }
                    : content,
            });
            expect(preview.getTextFor(event)).toBe(`${userId}: caption`);
            expect(preview.getTextFor(event, undefined, false, { textOnly: true })).toBe("caption");
            const current = replacement ? event.getContent()["m.new_content"] : event.getContent();
            current.body = "";
            expect(preview.getTextFor(event)).toBe(`${userId}: Image`);
            expect(preview.getTextFor(event, undefined, false, { textOnly: true })).toBe("Image");
            expect(preview.getTextFor(event, undefined, true)).toBe("Image");
        });
    });

    describe("getTextFor", () => {
        it("when called with an event with empty content should return null", () => {
            const event = mkEvent({
                event: true,
                content: {},
                user: userId,
                type: "m.room.message",
            });
            expect(preview.getTextFor(event)).toBeNull();
        });

        it("when called with an event with empty body should return null", () => {
            const event = mkEvent({
                event: true,
                content: {
                    body: "",
                },
                user: userId,
                type: "m.room.message",
            });
            expect(preview.getTextFor(event)).toBeNull();
        });

        it("when called with an event with body should return »user: body«", () => {
            const event = mkEvent({
                event: true,
                content: {
                    body: "test body",
                },
                user: userId,
                type: "m.room.message",
            });
            expect(preview.getTextFor(event)).toBe(`${userId}: test body`);
        });

        it("when called for a replaced event with new content should return the new content body", () => {
            const event = mkEvent({
                event: true,
                content: {
                    ["m.new_content"]: {
                        body: "test new content body",
                    },
                    ["m.relates_to"]: {
                        rel_type: RelationType.Replace,
                        event_id: "$asd123",
                    },
                },
                user: userId,
                type: "m.room.message",
            });
            expect(preview.getTextFor(event)).toBe(`${userId}: test new content body`);
        });
    });
    describe("text-only previews", () => {
        const options = { textOnly: true };
        const createMessage = (content: Record<string, unknown>) =>
            mkEvent({
                event: true,
                room: "!room:server",
                user: userId,
                type: "m.room.message",
                content,
            });

        it.each(["m.text", "m.notice", "m.image", "m.video", "m.audio", "m.file"])(
            "should omit the %s sender prefix",
            (msgtype) => {
                const event = createMessage({ msgtype, body: "Latest text" });
                expect(preview.getTextFor(event, undefined, false, options)).toBe("Latest text");
            },
        );

        it.each([false, true])("should remove reply and thread fallbacks (thread=%s)", (thread) => {
            const relation = {
                "m.in_reply_to": { event_id: "$root" },
                ...(thread ? { rel_type: "m.thread", event_id: "$root", is_falling_back: true } : {}),
            };
            const event = createMessage({
                "body": "> <@alice:server> Question\n\nReply text",
                "m.relates_to": relation,
            });
            expect(preview.getTextFor(event, undefined, false, options)).toBe("Reply text");
            event.getContent().format = "org.matrix.custom.html";
            event.getContent().formatted_body =
                "<mx-reply><blockquote>@alice:server Question</blockquote></mx-reply>Reply text";
            expect(preview.getTextFor(event, undefined, false, options)).toBe("Reply text");
        });

        it("should preserve genuine quotes without reply relations", () => {
            const event = createMessage({ body: "> Genuine quote\n\nMy thoughts" });
            expect(preview.getTextFor(event, undefined, false, options)).toBe("> Genuine quote\n\nMy thoughts");
        });

        it("should always strip HTML fallback, including edits without an original", () => {
            const event = createMessage({
                "m.relates_to": { rel_type: "m.replace", event_id: "$unknown" },
                "m.new_content": {
                    body: "Reply",
                    format: "org.matrix.custom.html",
                    formatted_body: "<mx-reply><blockquote>Old quote</blockquote></mx-reply><b>Edited</b>",
                },
            });
            expect(preview.getTextFor(event, undefined, false, options)).toBe("Edited");
        });

        it.each([true, false])(
            "should strip plain edited reply fallbacks only for original replies (%s)",
            (isReply) => {
                const original = createMessage({
                    body: "Original",
                    ...(isReply ? { "m.relates_to": { "m.in_reply_to": { event_id: "$root" } } } : {}),
                });
                const room = new Room("!room:server", MatrixClientPeg.safeGet(), "@self:server");
                const roomSpy = vi.spyOn(MatrixClientPeg.safeGet(), "getRoom").mockReturnValue(room);
                vi.spyOn(room, "findEventById").mockReturnValue(original);
                const event = createMessage({
                    "m.relates_to": { rel_type: "m.replace", event_id: "$original" },
                    "m.new_content": { body: "> Quote\n\nEdited" },
                });
                expect(preview.getTextFor(event, undefined, false, options)).toBe(
                    isReply ? "Edited" : "> Quote\n\nEdited",
                );
                roomSpy.mockRestore();
            },
        );

        it("should use plain display names for message prefixes and grammatical emote subjects", () => {
            const event = createMessage({ body: "waves", msgtype: "m.emote" });
            event.sender = new RoomMember("!room:server", userId);
            event.sender.rawDisplayName = "🤖 assistant\u202e";
            event.sender.name = `🤖 assistant (${userId})`;
            expect(preview.getTextFor(event, undefined, false, options)).toBe("* 🤖 assistant waves");
            event.getContent().msgtype = "m.text";
            expect(preview.getTextFor(event, undefined, false, { plainSenderName: true })).toBe("🤖 assistant: waves");
            expect(preview.getTextFor(event)).toBe(`🤖 assistant (${userId}): waves`);
            event.sender = null;
            expect(preview.getTextFor(event, undefined, false, { plainSenderName: true })).toBe(`${userId}: waves`);
        });

        it("should skip an empty fallback", () => {
            const event = createMessage({
                "body": "> <@alice:server> Question\n\n",
                "m.relates_to": { "m.in_reply_to": { event_id: "$root" } },
            });
            expect(preview.getTextFor(event, undefined, false, options)).toBeNull();
        });
    });
});

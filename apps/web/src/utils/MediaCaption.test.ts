/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

// @vitest-environment happy-dom

import { MatrixEvent, RoomMember, type IContent } from "matrix-js-sdk/src/matrix";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import EditorModel from "../editor/model";
import { createPartCreator } from "../editor/__mocks__";
import SettingsStore from "../settings/SettingsStore";
import { _t } from "../languageHandler";
import {
    createMediaCaptionEditContent,
    createMediaCaptionFields,
    isCaptionableContent,
    withMediaCaption,
} from "./MediaCaption";
import {
    GALLERY_MSGTYPE,
    STABLE_GALLERY_MSGTYPE,
    CAPTIONABLE_MSGTYPES,
    getMediaCaption,
    getMediaFileName,
} from "./MediaCaptionContent";

const pc = createPartCreator();
const textModel = (text: string): EditorModel => new EditorModel([pc.plain(text)], pc);
const media: IContent = {
    msgtype: "m.image",
    body: "photo.png",
    url: "mxc://example.org/photo",
    info: { mimetype: "image/png", size: 123 },
};

function event(content: IContent, sender = "@sender:example.org"): MatrixEvent {
    const result = new MatrixEvent({ type: "m.room.message", event_id: "$event", sender, content });
    result.sender = new RoomMember("!room:example.org", sender);
    return result;
}

describe("MediaCaption", () => {
    beforeEach(() => {
        vi.spyOn(SettingsStore, "getValue").mockImplementation(
            (setting) => setting === "MessageComposerInput.useMarkdown",
        );
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("isCaptionableContent", () => {
        it("should expose exactly the supported media types", () => {
            expect([...CAPTIONABLE_MSGTYPES]).toEqual(["m.image", "m.video", "m.audio", "m.file"]);
        });

        it.each(["m.image", "m.video", "m.audio", "m.file"])(
            "should accept %s with plain or encrypted media",
            (msgtype) => {
                expect(isCaptionableContent({ msgtype, url: media.url })).toBe(true);
                expect(isCaptionableContent({ msgtype, file: { url: media.url } })).toBe(true);
                expect(isCaptionableContent({ msgtype })).toBe(false);
            },
        );

        it.each([
            {},
            { msgtype: "m.sticker", url: media.url },
            { msgtype: "m.text", url: media.url },
            { "msgtype": "m.audio", "url": media.url, "org.matrix.msc3245.voice": {} },
            { "msgtype": "m.audio", "file": { url: media.url }, "org.matrix.msc3245.voice": {} },
        ])("should exclude unsupported content %j", (content) => {
            expect(isCaptionableContent(content)).toBe(false);
        });
    });

    describe("getMediaFileName", () => {
        it("should fall back from filename to body to the attachment label", () => {
            expect(getMediaFileName({ filename: "original.png", body: "caption" })).toBe("original.png");
            expect(getMediaFileName(media)).toBe("photo.png");
            expect(getMediaFileName({ filename: "", body: "photo.png" })).toBe("photo.png");
            expect(getMediaFileName({})).toBe(_t("common|attachment"));
            expect(getMediaFileName({ filename: "", body: "" })).toBe(_t("common|attachment"));
        });
    });

    describe("getMediaCaption", () => {
        it.each([undefined, "", "photo.png"])("should return null for filename %s", (filename) => {
            expect(getMediaCaption({ ...media, filename })).toBeNull();
        });

        it("should read plain and HTML captions", () => {
            expect(getMediaCaption({ ...media, filename: "original.png" })).toEqual({ body: "photo.png" });
            const caption = { body: "caption", format: "org.matrix.custom.html", formatted_body: "<b>caption</b>" };
            expect(getMediaCaption({ ...media, filename: "photo.png", ...caption })).toEqual(caption);
        });

        it("should only expose HTML with its supported format", () => {
            expect(getMediaCaption({ ...media, filename: "original.png", formatted_body: "<b>caption</b>" })).toEqual({
                body: "photo.png",
            });
        });
    });

    describe("createMediaCaptionFields", () => {
        it("should retain the plain text and markdown source", () => {
            expect(createMediaCaptionFields(textModel("hello"))).toEqual({ body: "hello" });
            expect(createMediaCaptionFields(textModel(" **hello** "))).toEqual({
                body: " **hello** ",
                format: "org.matrix.custom.html",
                formatted_body: "<strong>hello</strong>",
            });
        });

        it("should respect disabled markdown and escape HTML", () => {
            vi.mocked(SettingsStore.getValue).mockReturnValue(false);
            expect(createMediaCaptionFields(textModel("**hello** <world>"))).toEqual({
                body: "**hello** <world>",
                format: "org.matrix.custom.html",
                formatted_body: "**hello** &lt;world&gt;",
            });
        });

        it("should preserve rich draft formatting without changing the plain Markdown preference", () => {
            vi.mocked(SettingsStore.getValue).mockReturnValue(false);
            const model = new EditorModel(
                [pc.plain("**bold** [link](https://example.org) "), pc.userPill("Alice", "@alice:example.org")],
                pc,
            );
            const rich = createMediaCaptionFields(model, true)!;
            expect(rich.formatted_body).toContain("<strong>bold</strong>");
            expect(rich.formatted_body).toContain('<a href="https://example.org">link</a>');
            expect(rich.formatted_body).toContain("https://matrix.to/#/@alice:example.org");
            expect(createMediaCaptionFields(model)?.formatted_body).toBe("**bold** [link](https://example.org) Alice");
        });

        it("should serialize a pill permalink", () => {
            expect(createMediaCaptionFields(new EditorModel([pc.userPill("Alice", "@alice:example.org")], pc))).toEqual(
                {
                    body: "Alice",
                    format: "org.matrix.custom.html",
                    formatted_body: '<a href="https://matrix.to/#/@alice:example.org">Alice</a>',
                },
            );
        });

        it("should return null for empty and whitespace models", () => {
            expect(createMediaCaptionFields(new EditorModel([], pc))).toBeNull();
            expect(createMediaCaptionFields(textModel(" \n\t "))).toBeNull();
        });
    });

    describe("withMediaCaption", () => {
        it.each([media, { ...media, url: undefined, file: { url: media.url } }])(
            "should add, replace and remove captions without changing media %j",
            (original) => {
                const snapshot = structuredClone(original);
                const htmlCaption = {
                    body: "a caption",
                    format: "org.matrix.custom.html" as const,
                    formatted_body: "<b>a caption</b>",
                };
                const added = withMediaCaption(original, "photo.png", htmlCaption);
                expect(added).toEqual({ ...original, filename: "photo.png", ...htmlCaption });
                const replaced = withMediaCaption(added, "photo.png", { body: "replacement" });
                expect(replaced).toEqual({ ...original, filename: "photo.png", body: "replacement" });
                expect(withMediaCaption(added, "photo.png", null)).toEqual({ ...original, filename: "photo.png" });
                expect(withMediaCaption(original, "photo.png", null)).toEqual(original);
                expect(original).toEqual(snapshot);
                expect(added.info).toBe(original.info);
                expect(added.file).toBe(original.file);
            },
        );
    });

    describe("createMediaCaptionEditContent", () => {
        it("should build a replacement with HTML and plain fallbacks and no inherited relations", () => {
            const original = {
                ...media,
                "m.relates_to": { "m.in_reply_to": { event_id: "$reply" } },
                "m.mentions": { user_ids: ["@old:example.org"] },
            };
            const editedEvent = event(original);
            const content = createMediaCaptionEditContent(textModel("**caption**"), editedEvent);
            const newContent = {
                ...media,
                "filename": "photo.png",
                "body": "**caption**",
                "format": "org.matrix.custom.html",
                "formatted_body": "<strong>caption</strong>",
                "m.mentions": {},
            };
            expect(content).toEqual({
                ...newContent,
                "body": "* **caption**",
                "formatted_body": "* <strong>caption</strong>",
                "m.new_content": newContent,
                "m.relates_to": { rel_type: "m.replace", event_id: "$event" },
            });
            expect(editedEvent.getContent()).toEqual(original);
        });

        it("should include full new mentions and only notify newly mentioned users", () => {
            const editedEvent = event({ ...media, "m.mentions": { user_ids: ["@old:example.org"] } });
            const model = new EditorModel(
                [
                    pc.userPill("Old", "@old:example.org"),
                    pc.userPill("New", "@new:example.org"),
                    pc.userPill("Self", "@sender:example.org"),
                ],
                pc,
            );
            const content = createMediaCaptionEditContent(model, editedEvent, event({}, "@reply:example.org"));
            expect(content["m.mentions"]).toEqual({ user_ids: ["@reply:example.org", "@new:example.org"] });
            expect(content["m.new_content"]).toMatchObject({
                "m.mentions": { user_ids: ["@reply:example.org", "@old:example.org", "@new:example.org"] },
            });
        });

        it.each([GALLERY_MSGTYPE, STABLE_GALLERY_MSGTYPE])(
            "should edit and clear %s captions while preserving items and notifying new mentions",
            (msgtype) => {
                const items = [{ itemtype: "m.image", body: "photo.png", file: { url: media.url }, info: media.info }];
                const original = {
                    msgtype,
                    "body": "old caption",
                    "itemtypes": items,
                    "format": "org.matrix.custom.html",
                    "formatted_body": "<b>old caption</b>",
                    "m.mentions": { user_ids: ["@old:example.org"] },
                    "m.relates_to": { rel_type: "m.thread", event_id: "$thread" },
                };
                const editedEvent = event(original);
                const model = new EditorModel([pc.userPill("New", "@new:example.org")], pc);
                const content = createMediaCaptionEditContent(model, editedEvent, event({}, "@reply:example.org"));
                expect(content.body).toBe("* New");
                expect(content).toHaveProperty(
                    "formatted_body",
                    '* <a href="https://matrix.to/#/@new:example.org">New</a>',
                );
                expect(content["m.relates_to"]).toEqual({ rel_type: "m.replace", event_id: "$event" });
                expect(content["m.mentions"]).toEqual({ user_ids: ["@reply:example.org", "@new:example.org"] });
                expect(content["m.new_content"]).toMatchObject({
                    msgtype,
                    "body": "New",
                    "itemtypes": items,
                    "m.mentions": { user_ids: ["@reply:example.org", "@new:example.org"] },
                });
                expect(content["m.new_content"]).not.toHaveProperty("m.relates_to");
                expect(content["m.new_content"]).not.toHaveProperty("filename");
                const cleared = createMediaCaptionEditContent(textModel(" "), editedEvent);
                expect(cleared.body).toBe("* ");
                expect(cleared["m.new_content"]).toEqual({ msgtype, "body": "", "itemtypes": items, "m.mentions": {} });
                expect(cleared).not.toHaveProperty("format");
                expect(cleared).not.toHaveProperty("formatted_body");
                expect((cleared["m.new_content"] as IContent).itemtypes).toBe(items);
                expect(editedEvent.getContent()).toEqual(original);
            },
        );

        it("should keep filename and remove HTML when removing a caption", () => {
            const content = createMediaCaptionEditContent(
                textModel(" "),
                event({
                    ...media,
                    filename: "photo.png",
                    body: "caption",
                    format: "org.matrix.custom.html",
                    formatted_body: "<b>caption</b>",
                }),
            );
            expect(content.body).toBe("* photo.png");
            expect(content).not.toHaveProperty("format");
            expect(content).not.toHaveProperty("formatted_body");
            expect(content["m.new_content"]).toEqual({ ...media, "filename": "photo.png", "m.mentions": {} });
        });
    });
});

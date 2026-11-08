/*
Copyright 2024 New Vector Ltd.
Copyright 2019 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from "vitest";
import { MatrixEvent } from "matrix-js-sdk/src/matrix";

import { parseEvent } from "./deserialize";
import { type Part } from "./parts";
import { createPartCreator } from "./__mocks__";
import SettingsStore from "../settings/SettingsStore";
import { textToHtmlRainbow } from "../utils/colour";
import * as maths from "./maths";

const FOUR_SPACES = " ".repeat(4);

function htmlMessage(formattedBody: string, msgtype = "m.text") {
    return {
        getContent() {
            return {
                msgtype,
                format: "org.matrix.custom.html",
                formatted_body: formattedBody,
            };
        },
    } as unknown as MatrixEvent;
}

function textMessage(body: string, msgtype = "m.text") {
    return {
        getContent() {
            return {
                msgtype,
                body,
            };
        },
    } as unknown as MatrixEvent;
}

function textMessageReply(body: string, msgtype = "m.text") {
    return {
        ...textMessage(body, msgtype),
        replyEventId: "!foo:bar",
    } as unknown as MatrixEvent;
}

function mergeAdjacentParts(parts: Part[]) {
    let prevPart: Part | undefined;
    for (let i = 0; i < parts.length; ++i) {
        let part: Part | undefined = parts[i];
        const isEmpty = !part.text.length;
        const isMerged = !isEmpty && prevPart && prevPart.merge?.(part);
        if (isEmpty || isMerged) {
            // remove empty or merged part
            part = prevPart;
            parts.splice(i, 1);
            //repeat this index, as it's removed now
            --i;
        }
        prevPart = part;
    }
}

function normalize(parts: Part[]) {
    // merge adjacent parts as this will happen
    // in the model anyway, and whether 1 or multiple
    // plain parts are returned is an implementation detail
    mergeAdjacentParts(parts);
    // convert to data objects for easier asserting
    return parts.map((p) => p.serialize());
}

describe("editor/deserialize", function () {
    describe("media captions", () => {
        const media = (content: object): MatrixEvent =>
            new MatrixEvent({
                type: "m.room.message",
                content: { msgtype: "m.image", body: "photo.png", url: "mxc://server/media", ...content },
            });

        it("should return an empty model for an uncaptioned image", () => {
            expect(parseEvent(media({}), createPartCreator())).toEqual([]);
        });

        it("should parse a plain caption without the filename", () => {
            const parts = parseEvent(media({ filename: "photo.png", body: "a caption" }), createPartCreator());
            expect(normalize(parts)).toEqual(normalize(parseEvent(textMessage("a caption"), createPartCreator())));
        });

        it("should parse formatted HTML captions", () => {
            const html = "a <strong>caption</strong>";
            const parts = parseEvent(
                media({
                    filename: "photo.png",
                    body: "a caption",
                    format: "org.matrix.custom.html",
                    formatted_body: html,
                }),
                createPartCreator(),
            );
            expect(normalize(parts)).toEqual(normalize(parseEvent(htmlMessage(html), createPartCreator())));
        });

        it("should parse HTML captions without command prefixes", () => {
            const html = textToHtmlRainbow("caption");
            const parts = parseEvent(
                media({
                    filename: "photo.png",
                    body: "caption",
                    format: "org.matrix.custom.html",
                    formatted_body: html,
                }),
                createPartCreator(),
            );
            expect(parts.map((part) => part.text).join("")).not.toMatch(/^\/(me|rainbow)/);
            expect(parts.map((part) => part.text).join("")).toBe("caption");
        });

        it("should strip plain reply fallbacks from captions", () => {
            const event = media({
                "filename": "photo.png",
                "body": "> <@alice:server> original\n\ncaption",
                "m.relates_to": { "m.in_reply_to": { event_id: "$original" } },
            });
            expect(normalize(parseEvent(event, createPartCreator()))).toEqual(
                normalize(parseEvent(textMessage("caption"), createPartCreator())),
            );
        });
    });

    describe("maths editing", () => {
        beforeEach(() => {
            vi.spyOn(SettingsStore, "getValue").mockImplementation((name) => name === "feature_latex_maths");
        });

        it.each([
            ['<span data-mx-maths="x"><code>x</code></span>', "$x$"],
            ['(<span data-mx-maths="x"></span>)', "($x$)"],
            ['Cost $5 (<span data-mx-maths="x"></span>)', String.raw`Cost $5 (\(x\))`],
            ['Cost $5 <strong>today</strong> (<span data-mx-maths="x"></span>)', String.raw`Cost $5 **today** (\(x\))`],
            ['<strong>Cost $5</strong> (<span data-mx-maths="x"></span>)', String.raw`**Cost $5** (\(x\))`],
            ['<span data-mx-maths="a"></span> (<span data-mx-maths="x"></span>)', String.raw`$a$ (\(x\))`],
            ['Cost $5<br>(<span data-mx-maths="x"></span>)', "Cost $5\n($x$)"],
            ['Cost $5\n(<span data-mx-maths="x"></span>)', "Cost $5\n($x$)"],
            ['Cost 5 (<span data-mx-maths="x"></span>)', "Cost 5 ($x$)"],
            ['a<span data-mx-maths="x"></span>', String.raw`a\(x\)`],
            ['<span data-mx-maths="x"></span>2', String.raw`\(x\)2`],
            ['<strong><span data-mx-maths="x"></span></strong>', String.raw`**\(x\)**`],
            ['<em>a</em><span data-mx-maths="x"></span>', String.raw`_a_\(x\)`],
            ['<em>a</em>\n<span data-mx-maths="x"><code>x</code></span>', String.raw`_a_\(x\)`],
            ['<span data-mx-maths="x"></span>\n<code>2</code>', String.raw`\(x\)` + "`2`"],
            ['<span data-mx-maths="x"></span><em>b</em>', String.raw`\(x\)_b_`],
            ['<br><span data-mx-maths="x"></span><br>', "\n$x$\n"],
            ['a\n<span data-mx-maths="x"></span>\nb', "a\n$x$\nb"],
            ['<p><span data-mx-maths="x"></span></p>', "$x$"],
            ['<div data-mx-maths="a"></div><div data-mx-maths="b"></div>', "$$a$$\n\n$$b$$"],
            ['before<div data-mx-maths="a"></div>after', "before\n\n$$a$$\n\nafter"],
            ["$x$", String.raw`\$x$`],
            ["<strong>$x$</strong>", String.raw`**\$x$**`],
            [String.raw`\(x\)`, String.raw`\\(x\\)`],
        ])("should restore %s safely", (html, expected) => {
            const parts = parseEvent(htmlMessage(html), createPartCreator());
            expect(parts.map((part) => part.text).join("")).toBe(expected);
        });

        it("should escape literal maths in plain text messages", () => {
            const parts = parseEvent(textMessage("$x$"), createPartCreator());
            expect(parts.map((part) => part.text).join("")).toBe(String.raw`\$x$`);
        });

        it.each([
            ["$$\na\n$$", "\\$$\na\n$$"],
            ["$$\r\na\r\n$$", "\\$$\na\n$$"],
            ["> first\n> second $x$", String.raw`\> first` + "\n" + String.raw`\> second \$x$`],
            [String.raw`C:\files` + "\n@room $x$", String.raw`C:\\files` + "\n@room " + String.raw`\$x$`],
        ])("should escape the full plain-text body %s", (body, expected) => {
            const parts = parseEvent(textMessage(body), createPartCreator());
            expect(parts.map((part) => part.text).join("")).toBe(expected);
        });

        it("should scan a long ordinary text/BR run with linear total input", () => {
            const lineCount = 5000;
            const escapeMaths = vi.spyOn(maths, "escapeMathsDelimiters");
            const parts = parseEvent(htmlMessage("x<br>".repeat(lineCount)), createPartCreator());
            expect(parts.map((part) => part.text).join("")).toBe("x\n".repeat(lineCount));
            // Count scanned characters instead of relying on machine-dependent timing.
            expect(escapeMaths).toHaveBeenCalledWith("x\n".repeat(lineCount));
            const scannedCharacters = escapeMaths.mock.calls.reduce((total, [text]) => total + text.length, 0);
            expect(scannedCharacters).toBeLessThanOrEqual(lineCount * 4);
        });

        it("should retain per-node escaping, ignored newlines and mentions in ordinary text/BR runs", () => {
            const parts = normalize(
                parseEvent(htmlMessage("x<br>\n<br>@room *text*<br><span>tail</span>"), createPartCreator()),
            );
            expect(parts).toEqual([
                { type: "plain", text: "x" },
                { type: "newline", text: "\n" },
                { type: "newline", text: "\n" },
                { type: "at-room-pill", text: "@room" },
                { type: "plain", text: String.raw` \*text\*` },
                { type: "newline", text: "\n" },
                { type: "plain", text: "tail" },
            ]);
        });

        it("should leave literal dollars alone when maths is off", () => {
            vi.mocked(SettingsStore.getValue).mockReturnValue(false);
            for (const event of [textMessage("$x$"), htmlMessage("$x$")]) {
                const parts = parseEvent(event, createPartCreator());
                expect(parts.map((part) => part.text).join("")).toBe("$x$");
            }
        });
    });

    describe("text messages", function () {
        it("test with newlines", function () {
            const parts = normalize(parseEvent(textMessage("hello\nworld"), createPartCreator()));
            expect(parts[0]).toStrictEqual({ type: "plain", text: "hello" });
            expect(parts[1]).toStrictEqual({ type: "newline", text: "\n" });
            expect(parts[2]).toStrictEqual({ type: "plain", text: "world" });
            expect(parts.length).toBe(3);
        });
        it("@room pill", function () {
            const parts = normalize(parseEvent(textMessage("text message for @room"), createPartCreator()));
            expect(parts.length).toBe(2);
            expect(parts[0]).toStrictEqual({ type: "plain", text: "text message for " });
            expect(parts[1]).toStrictEqual({ type: "at-room-pill", text: "@room" });
        });
        it("emote", function () {
            const text = "says DON'T SHOUT!";
            const parts = normalize(parseEvent(textMessage(text, "m.emote"), createPartCreator()));
            expect(parts.length).toBe(1);
            expect(parts[0]).toStrictEqual({ type: "plain", text: "/me says DON'T SHOUT!" });
        });
        it("spoiler", function () {
            const parts = normalize(parseEvent(textMessage("/spoiler broiler"), createPartCreator()));
            expect(parts.length).toBe(1);
            expect(parts[0]).toStrictEqual({ type: "plain", text: "/spoiler broiler" });
        });
        it("leaves text alone which markdown would not have touched", function () {
            const parts = normalize(parseEvent(textMessage("path/to/_light.scss"), createPartCreator()));
            expect(parts.length).toBe(1);
            expect(parts[0]).toStrictEqual({ type: "plain", text: "path/to/_light.scss" });
        });
        it.each([
            ["**bold**", "\\*\\*bold\\*\\*"],
            ["a<del>b</del>c", "a\\<del>b\\</del>c"],
            ["> quoted", "\\> quoted"],
            ["C:\\Program Files", "C:\\\\Program Files"],
        ])("still escapes %s, which markdown would have consumed", function (body, expected) {
            const parts = normalize(parseEvent(textMessage(body), createPartCreator()));
            expect(parts[0]).toStrictEqual({ type: "plain", text: expected });
        });
    });
    describe("html messages", function () {
        it("inline styling", function () {
            const html = "<strong>bold</strong> and <em>emphasized</em> text";
            const parts = normalize(parseEvent(htmlMessage(html), createPartCreator()));
            expect(parts.length).toBe(1);
            expect(parts[0]).toStrictEqual({ type: "plain", text: "**bold** and _emphasized_ text" });
        });
        it("hyperlink", function () {
            const html = 'click <a href="http://example.com/">this</a>!';
            const parts = normalize(parseEvent(htmlMessage(html), createPartCreator()));
            expect(parts.length).toBe(1);
            expect(parts[0]).toStrictEqual({ type: "plain", text: "click [this](http://example.com/)!" });
        });
        it("hyperlink without a trailing slash keeps the original URL", function () {
            const html = 'click <a href="http://example.com">this</a>!';
            const parts = normalize(parseEvent(htmlMessage(html), createPartCreator()));
            expect(parts.length).toBe(1);
            expect(parts[0]).toStrictEqual({ type: "plain", text: "click [this](http://example.com)!" });
        });
        it("hyperlink with a relative URL keeps the original URL", function () {
            const html = 'click <a href="/local/path">this</a>!';
            const parts = normalize(parseEvent(htmlMessage(html), createPartCreator()));
            expect(parts.length).toBe(1);
            expect(parts[0]).toStrictEqual({ type: "plain", text: "click [this](/local/path)!" });
        });
        it("autolinked URL is not rewritten as a markdown link", function () {
            const html = '<a href="http://example.com">http://example.com</a>';
            const parts = normalize(parseEvent(htmlMessage(html), createPartCreator()));
            expect(parts.length).toBe(1);
            expect(parts[0]).toStrictEqual({ type: "plain", text: "http://example.com" });
        });
        it("multiple lines with paragraphs", function () {
            const html = "<p>hello</p><p>world</p>";
            const parts = normalize(parseEvent(htmlMessage(html), createPartCreator()));
            expect(parts.length).toBe(4);
            expect(parts[0]).toStrictEqual({ type: "plain", text: "hello" });
            expect(parts[1]).toStrictEqual({ type: "newline", text: "\n" });
            expect(parts[2]).toStrictEqual({ type: "newline", text: "\n" });
            expect(parts[3]).toStrictEqual({ type: "plain", text: "world" });
        });
        it("multiple lines with line breaks", function () {
            const html = "hello<br>world";
            const parts = normalize(parseEvent(htmlMessage(html), createPartCreator()));
            expect(parts.length).toBe(3);
            expect(parts[0]).toStrictEqual({ type: "plain", text: "hello" });
            expect(parts[1]).toStrictEqual({ type: "newline", text: "\n" });
            expect(parts[2]).toStrictEqual({ type: "plain", text: "world" });
        });
        it("multiple lines mixing paragraphs and line breaks", function () {
            const html = "<p>hello<br>warm</p><p>world</p>";
            const parts = normalize(parseEvent(htmlMessage(html), createPartCreator()));
            expect(parts.length).toBe(6);
            expect(parts[0]).toStrictEqual({ type: "plain", text: "hello" });
            expect(parts[1]).toStrictEqual({ type: "newline", text: "\n" });
            expect(parts[2]).toStrictEqual({ type: "plain", text: "warm" });
            expect(parts[3]).toStrictEqual({ type: "newline", text: "\n" });
            expect(parts[4]).toStrictEqual({ type: "newline", text: "\n" });
            expect(parts[5]).toStrictEqual({ type: "plain", text: "world" });
        });
        it("quote", function () {
            const html = "<blockquote><p><em>wise</em><br><strong>words</strong></p></blockquote><p>indeed</p>";
            const parts = normalize(parseEvent(htmlMessage(html), createPartCreator()));
            expect(parts.length).toBe(6);
            expect(parts[0]).toStrictEqual({ type: "plain", text: "> _wise_" });
            expect(parts[1]).toStrictEqual({ type: "newline", text: "\n" });
            expect(parts[2]).toStrictEqual({ type: "plain", text: "> **words**" });
            expect(parts[3]).toStrictEqual({ type: "newline", text: "\n" });
            expect(parts[4]).toStrictEqual({ type: "newline", text: "\n" });
            expect(parts[5]).toStrictEqual({ type: "plain", text: "indeed" });
        });
        it("user pill", function () {
            const html = 'Hi <a href="https://matrix.to/#/@alice:hs.tld">Alice</a>!';
            const parts = normalize(parseEvent(htmlMessage(html), createPartCreator()));
            expect(parts.length).toBe(3);
            expect(parts[0]).toStrictEqual({ type: "plain", text: "Hi " });
            expect(parts[1]).toStrictEqual({ type: "user-pill", text: "Alice", resourceId: "@alice:hs.tld" });
            expect(parts[2]).toStrictEqual({ type: "plain", text: "!" });
        });
        it("user pill with displayname containing backslash", function () {
            const html = 'Hi <a href="https://matrix.to/#/@alice:hs.tld">Alice\\</a>!';
            const parts = normalize(parseEvent(htmlMessage(html), createPartCreator()));
            expect(parts.length).toBe(3);
            expect(parts[0]).toStrictEqual({ type: "plain", text: "Hi " });
            expect(parts[1]).toStrictEqual({ type: "user-pill", text: "Alice\\", resourceId: "@alice:hs.tld" });
            expect(parts[2]).toStrictEqual({ type: "plain", text: "!" });
        });
        it("user pill with displayname containing opening square bracket", function () {
            const html = 'Hi <a href="https://matrix.to/#/@alice:hs.tld">Alice[[</a>!';
            const parts = normalize(parseEvent(htmlMessage(html), createPartCreator()));
            expect(parts.length).toBe(3);
            expect(parts[0]).toStrictEqual({ type: "plain", text: "Hi " });
            expect(parts[1]).toStrictEqual({ type: "user-pill", text: "Alice[[", resourceId: "@alice:hs.tld" });
            expect(parts[2]).toStrictEqual({ type: "plain", text: "!" });
        });
        it("user pill with displayname containing closing square bracket", function () {
            const html = 'Hi <a href="https://matrix.to/#/@alice:hs.tld">Alice]</a>!';
            const parts = normalize(parseEvent(htmlMessage(html), createPartCreator()));
            expect(parts.length).toBe(3);
            expect(parts[0]).toStrictEqual({ type: "plain", text: "Hi " });
            expect(parts[1]).toStrictEqual({ type: "user-pill", text: "Alice]", resourceId: "@alice:hs.tld" });
            expect(parts[2]).toStrictEqual({ type: "plain", text: "!" });
        });
        it("user pill with displayname containing linebreak", function () {
            const html = 'Hi <a href="https://matrix.to/#/@alice:hs.tld">Alice<br>123</a>!';
            const parts = normalize(parseEvent(htmlMessage(html), createPartCreator()));
            expect(parts.length).toBe(3);
            expect(parts[0]).toStrictEqual({ type: "plain", text: "Hi " });
            expect(parts[1]).toStrictEqual({ type: "user-pill", text: "Alice123", resourceId: "@alice:hs.tld" });
            expect(parts[2]).toStrictEqual({ type: "plain", text: "!" });
        });
        it("room pill", function () {
            const html = 'Try <a href="https://matrix.to/#/#room:hs.tld">#room:hs.tld</a>?';
            const parts = normalize(parseEvent(htmlMessage(html), createPartCreator()));
            expect(parts.length).toBe(3);
            expect(parts[0]).toStrictEqual({ type: "plain", text: "Try " });
            expect(parts[1]).toStrictEqual({ type: "room-pill", text: "#room:hs.tld", resourceId: "#room:hs.tld" });
            expect(parts[2]).toStrictEqual({ type: "plain", text: "?" });
        });
        it("@room pill", function () {
            const html = "<em>formatted</em> message for @room";
            const parts = normalize(parseEvent(htmlMessage(html), createPartCreator()));
            expect(parts.length).toBe(2);
            expect(parts[0]).toStrictEqual({ type: "plain", text: "_formatted_ message for " });
            expect(parts[1]).toStrictEqual({ type: "at-room-pill", text: "@room" });
        });
        it("inline code", function () {
            const html = "there is no place like <code>127.0.0.1</code>!";
            const parts = normalize(parseEvent(htmlMessage(html), createPartCreator()));
            expect(parts.length).toBe(1);
            expect(parts[0]).toStrictEqual({ type: "plain", text: "there is no place like `127.0.0.1`!" });
        });
        it("code block with no trailing text", function () {
            const html = "<pre><code>0xDEADBEEF\n</code></pre>\n";
            const parts = normalize(parseEvent(htmlMessage(html), createPartCreator()));
            expect(parts.length).toBe(5);
            expect(parts[0]).toStrictEqual({ type: "plain", text: "```" });
            expect(parts[1]).toStrictEqual({ type: "newline", text: "\n" });
            expect(parts[2]).toStrictEqual({ type: "plain", text: "0xDEADBEEF" });
            expect(parts[3]).toStrictEqual({ type: "newline", text: "\n" });
            expect(parts[4]).toStrictEqual({ type: "plain", text: "```" });
        });
        // failing likely because of https://github.com/vector-im/element-web/issues/10316
        it.skip("code block with no trailing text and no newlines", function () {
            const html = "<pre><code>0xDEADBEEF</code></pre>";
            const parts = normalize(parseEvent(htmlMessage(html), createPartCreator()));
            expect(parts.length).toBe(5);
            expect(parts[0]).toStrictEqual({ type: "plain", text: "```" });
            expect(parts[1]).toStrictEqual({ type: "newline", text: "\n" });
            expect(parts[2]).toStrictEqual({ type: "plain", text: "0xDEADBEEF" });
            expect(parts[3]).toStrictEqual({ type: "newline", text: "\n" });
            expect(parts[4]).toStrictEqual({ type: "plain", text: "```" });
        });
        it("unordered lists", function () {
            const html = "<ul><li>Oak</li><li>Spruce</li><li>Birch</li></ul>";
            const parts = normalize(parseEvent(htmlMessage(html), createPartCreator()));
            expect(parts.length).toBe(5);
            expect(parts[0]).toStrictEqual({ type: "plain", text: "- Oak" });
            expect(parts[1]).toStrictEqual({ type: "newline", text: "\n" });
            expect(parts[2]).toStrictEqual({ type: "plain", text: "- Spruce" });
            expect(parts[3]).toStrictEqual({ type: "newline", text: "\n" });
            expect(parts[4]).toStrictEqual({ type: "plain", text: "- Birch" });
        });
        it("ordered lists", function () {
            const html = "<ol><li>Start</li><li>Continue</li><li>Finish</li></ol>";
            const parts = normalize(parseEvent(htmlMessage(html), createPartCreator()));
            expect(parts.length).toBe(5);
            expect(parts[0]).toStrictEqual({ type: "plain", text: "1. Start" });
            expect(parts[1]).toStrictEqual({ type: "newline", text: "\n" });
            expect(parts[2]).toStrictEqual({ type: "plain", text: "2. Continue" });
            expect(parts[3]).toStrictEqual({ type: "newline", text: "\n" });
            expect(parts[4]).toStrictEqual({ type: "plain", text: "3. Finish" });
        });
        it("nested unordered lists", () => {
            const html = "<ul><li>Oak<ul><li>Spruce<ul><li>Birch</li></ul></li></ul></li></ul>";
            const parts = normalize(parseEvent(htmlMessage(html), createPartCreator()));
            expect(parts.length).toBe(5);
            expect(parts[0]).toStrictEqual({ type: "plain", text: "- Oak" });
            expect(parts[1]).toStrictEqual({ type: "newline", text: "\n" });
            expect(parts[2]).toStrictEqual({ type: "plain", text: `${FOUR_SPACES}- Spruce` });
            expect(parts[3]).toStrictEqual({ type: "newline", text: "\n" });
            expect(parts[4]).toStrictEqual({ type: "plain", text: `${FOUR_SPACES.repeat(2)}- Birch` });
        });
        it("nested ordered lists", () => {
            const html = "<ol><li>Oak<ol><li>Spruce<ol><li>Birch</li></ol></li></ol></li></ol>";
            const parts = normalize(parseEvent(htmlMessage(html), createPartCreator()));
            expect(parts.length).toBe(5);
            expect(parts[0]).toStrictEqual({ type: "plain", text: "1. Oak" });
            expect(parts[1]).toStrictEqual({ type: "newline", text: "\n" });
            expect(parts[2]).toStrictEqual({ type: "plain", text: `${FOUR_SPACES}1. Spruce` });
            expect(parts[3]).toStrictEqual({ type: "newline", text: "\n" });
            expect(parts[4]).toStrictEqual({ type: "plain", text: `${FOUR_SPACES.repeat(2)}1. Birch` });
        });
        it("nested lists", () => {
            const html = "<ol><li>Oak\n<ol><li>Spruce\n<ol><li>Birch</li></ol></li></ol></li></ol>";
            const parts = normalize(parseEvent(htmlMessage(html), createPartCreator()));
            expect(parts.length).toBe(5);
            expect(parts[0]).toStrictEqual({ type: "plain", text: "1. Oak\n" });
            expect(parts[1]).toStrictEqual({ type: "newline", text: "\n" });
            expect(parts[2]).toStrictEqual({ type: "plain", text: `${FOUR_SPACES}1. Spruce\n` });
            expect(parts[3]).toStrictEqual({ type: "newline", text: "\n" });
            expect(parts[4]).toStrictEqual({ type: "plain", text: `${FOUR_SPACES.repeat(2)}1. Birch` });
        });
        it("mx-reply is stripped", function () {
            const html = "<mx-reply>foo</mx-reply>bar";
            const parts = normalize(parseEvent(htmlMessage(html), createPartCreator()));
            expect(parts.length).toBe(1);
            expect(parts[0]).toStrictEqual({ type: "plain", text: "bar" });
        });
        it("emote", function () {
            const html = "says <em>DON'T SHOUT</em>!";
            const parts = normalize(parseEvent(htmlMessage(html, "m.emote"), createPartCreator()));
            expect(parts.length).toBe(1);
            expect(parts[0]).toStrictEqual({ type: "plain", text: "/me says _DON'T SHOUT_!" });
        });
        it("spoiler", function () {
            const parts = normalize(
                parseEvent(htmlMessage("<span data-mx-spoiler>broiler</span>"), createPartCreator()),
            );
            expect(parts.length).toBe(1);
            expect(parts[0]).toStrictEqual({ type: "plain", text: "/spoiler broiler" });
        });
        it("preserves nested quotes", () => {
            const html = "<blockquote>foo<blockquote>bar</blockquote></blockquote>";
            const parts = normalize(parseEvent(htmlMessage(html), createPartCreator()));
            expect(parts).toMatchSnapshot();
        });
        it("surrounds lists with newlines", () => {
            const html = "foo<ul><li>bar</li></ul>baz";
            const parts = normalize(parseEvent(htmlMessage(html), createPartCreator()));
            expect(parts).toMatchSnapshot();
        });
        it("preserves nested formatting", () => {
            const html = "a<sub>b<em>c<strong>d<u>e</u></strong></em></sub>";
            const parts = normalize(parseEvent(htmlMessage(html), createPartCreator()));
            expect(parts).toMatchSnapshot();
        });
        it("escapes backticks in code blocks", () => {
            const html =
                "<p><code>this → ` is a backtick</code></p><pre><code>and here are 3 of them:\n```</code></pre>";
            const parts = normalize(parseEvent(htmlMessage(html), createPartCreator()));
            expect(parts).toMatchSnapshot();
        });
        it("escapes backticks outside of code blocks", () => {
            const html = "some `backticks`";
            const parts = normalize(parseEvent(htmlMessage(html), createPartCreator()));
            expect(parts).toMatchSnapshot();
        });
        it("escapes backslashes", () => {
            const html = "C:\\My Documents";
            const parts = normalize(parseEvent(htmlMessage(html), createPartCreator()));
            expect(parts).toMatchSnapshot();
        });
        it("escapes asterisks", () => {
            const html = "*hello*";
            const parts = normalize(parseEvent(htmlMessage(html), createPartCreator()));
            expect(parts).toMatchSnapshot();
        });
        it("escapes underscores", () => {
            const html = "__emphasis__";
            const parts = normalize(parseEvent(htmlMessage(html), createPartCreator()));
            expect(parts).toMatchSnapshot();
        });
        it("escapes square brackets", () => {
            const html = "[not an actual link](https://example.org)";
            const parts = normalize(parseEvent(htmlMessage(html), createPartCreator()));
            expect(parts).toMatchSnapshot();
        });
        it("escapes angle brackets", () => {
            const html = "> \\<del>no formatting here\\</del>";
            const parts = normalize(parseEvent(htmlMessage(html), createPartCreator()));
            expect(parts).toMatchSnapshot();
        });
    });
    describe("plaintext messages", function () {
        it("turns html tags back into markdown", function () {
            const html = '<strong>bold</strong> and <em>emphasized</em> text <a href="http://example.com/">this</a>!';
            const parts = normalize(parseEvent(htmlMessage(html), createPartCreator(), { shouldEscape: false }));
            expect(parts.length).toBe(1);
            expect(parts[0]).toStrictEqual({
                type: "plain",
                text: "**bold** and _emphasized_ text [this](http://example.com/)!",
            });
        });
        it("keeps backticks unescaped", () => {
            const html = "this → ` is a backtick and here are 3 of them:\n```";
            const parts = normalize(parseEvent(htmlMessage(html), createPartCreator(), { shouldEscape: false }));
            expect(parts.length).toBe(1);
            expect(parts[0]).toStrictEqual({
                type: "plain",
                text: "this → ` is a backtick and here are 3 of them:\n```",
            });
        });
        it("keeps backticks outside of code blocks", () => {
            const html = "some `backticks`";
            const parts = normalize(parseEvent(htmlMessage(html), createPartCreator(), { shouldEscape: false }));
            expect(parts.length).toBe(1);
            expect(parts[0]).toStrictEqual({
                type: "plain",
                text: "some `backticks`",
            });
        });
        it("keeps backslashes", () => {
            const html = "C:\\My Documents";
            const parts = normalize(parseEvent(htmlMessage(html), createPartCreator(), { shouldEscape: false }));
            expect(parts.length).toBe(1);
            expect(parts[0]).toStrictEqual({
                type: "plain",
                text: "C:\\My Documents",
            });
        });
        it("keeps asterisks", () => {
            const html = "*hello*";
            const parts = normalize(parseEvent(htmlMessage(html), createPartCreator(), { shouldEscape: false }));
            expect(parts.length).toBe(1);
            expect(parts[0]).toStrictEqual({
                type: "plain",
                text: "*hello*",
            });
        });
        it("keeps underscores", () => {
            const html = "__emphasis__";
            const parts = normalize(parseEvent(htmlMessage(html), createPartCreator(), { shouldEscape: false }));
            expect(parts.length).toBe(1);
            expect(parts[0]).toStrictEqual({
                type: "plain",
                text: "__emphasis__",
            });
        });
        it("keeps square brackets", () => {
            const html = "[not an actual link](https://example.org)";
            const parts = normalize(parseEvent(htmlMessage(html), createPartCreator(), { shouldEscape: false }));
            expect(parts.length).toBe(1);
            expect(parts[0]).toStrictEqual({
                type: "plain",
                text: "[not an actual link](https://example.org)",
            });
        });
        it("escapes angle brackets", () => {
            const html = "> &lt;del&gt;no formatting here&lt;/del&gt;";
            const parts = normalize(parseEvent(htmlMessage(html), createPartCreator(), { shouldEscape: false }));
            expect(parts.length).toBe(1);
            expect(parts[0]).toStrictEqual({
                type: "plain",
                text: "> <del>no formatting here</del>",
            });
        });
        it("strips plaintext replies", () => {
            const body = "> Sender: foo\n\nMessage";
            const parts = normalize(parseEvent(textMessageReply(body), createPartCreator(), { shouldEscape: false }));
            expect(parts.length).toBe(1);
            expect(parts[0]).toStrictEqual({
                type: "plain",
                text: "Message",
            });
        });
    });
});

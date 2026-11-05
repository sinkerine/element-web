/*
Copyright 2024 New Vector Ltd.
Copyright 2022 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, vi } from "vitest";
import { type MatrixEvent } from "matrix-js-sdk/src/matrix";

import { parseEvent } from "./deserialize";
import EditorModel from "./model";
import DocumentOffset from "./offset";
import { htmlSerializeIfNeeded, textSerialize } from "./serialize";
import { createPartCreator } from "./__mocks__";
import SettingsStore from "../settings/SettingsStore";
import SdkConfig from "../SdkConfig";

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

async function md2html(markdown: string): Promise<string> {
    const pc = createPartCreator();
    const oldModel = new EditorModel([], pc, () => {});
    await oldModel.update(markdown, "insertText", new DocumentOffset(markdown.length, false));
    return htmlSerializeIfNeeded(oldModel, { forceHTML: true })!;
}

function html2md(html: string): string {
    const pc = createPartCreator();
    const parts = parseEvent(htmlMessage(html), pc);
    const newModel = new EditorModel(parts, pc);
    return textSerialize(newModel);
}

async function roundTripMarkdown(markdown: string): Promise<string> {
    return html2md(await md2html(markdown));
}

async function roundTripHtml(html: string): Promise<string> {
    return await md2html(html2md(html));
}

describe("editor/roundtrip", function () {
    describe("maths", () => {
        beforeEach(() => {
            vi.spyOn(SettingsStore, "getValue").mockImplementation((name) => name === "feature_latex_maths");
        });

        it.each([
            String.raw`Euler $e^{i\pi}+1=0$`,
            "Identity ($a+b$) holds",
            "$a$ and $x$",
            "Tickets are $5/$10",
            "Range $5-$10",
            "$3,$4",
            "I paid $5 and $10",
            "Use `$x$`",
            String.raw`\$x\$`,
            String.raw`$$\int_0^1 x\,dx$$`,
            String.raw`\(\alpha\)`,
            "$$a$$\n$$b$$",
            "$$a\nb$$",
            "before\n$$a$$\nafter",
            "```\n$$x$$\n```\n\n$a$ and `b`",
            "`$a$` $b$ `c`",
            String.raw`$a+\$b$`,
            "**$x$**",
            String.raw`**\(x\)**`,
        ])("should keep HTML stable for %s", async (source) => {
            const html = await md2html(source);
            expect(await roundTripHtml(html)).toBe(html);
        });

        it("should retain maths elements with unsafe dollar contexts", async () => {
            const html = 'a<span data-mx-maths="x"><code>x</code></span>2';
            expect(html2md(html)).toBe(String.raw`a\(x\)2`);
            expect(await roundTripHtml(html)).toBe(html);
        });

        it.each([
            String.raw`Cost \$5 (\(x\))`,
            String.raw`Cost \$5 **today** (\(x\))`,
            String.raw`**Cost \$5** (\(x\))`,
        ])("should retain exactly one formula across repeated edits of %s", async (source) => {
            const original = await md2html(source);
            let html = original;
            for (let edit = 0; edit < 2; edit++) {
                html = await roundTripHtml(html);
                const parsed = new DOMParser().parseFromString(html, "text/html");
                expect(
                    [...parsed.querySelectorAll("[data-mx-maths]")].map((node) => node.getAttribute("data-mx-maths")),
                ).toEqual(["x"]);
                expect(parsed.body.textContent).toContain("$5");
                expect(html).toBe(original);
            }
        });

        it("should preserve earlier formulas and currency across repeated edits", async () => {
            const original = await md2html(String.raw`$a$ Cost \$5 (\(x\))`);
            let html = original;
            for (let edit = 0; edit < 2; edit++) {
                html = await roundTripHtml(html);
                const parsed = new DOMParser().parseFromString(html, "text/html");
                expect(
                    [...parsed.querySelectorAll("[data-mx-maths]")].map((node) => node.getAttribute("data-mx-maths")),
                ).toEqual(["a", "x"]);
                expect(html).toBe(original);
            }
        });

        it("should retain maths after an ignored newline following inline markup", async () => {
            const html = '<em>a</em>\n<span data-mx-maths="x"><code>x</code></span>';
            expect(html2md(html)).toBe(String.raw`_a_\(x\)`);
            const resent = await roundTripHtml(html);
            expect(resent).toBe(html.replace("\n", ""));
            expect(await roundTripHtml(resent)).toBe(resent);
        });

        it("should preserve the set of adjacent display values", async () => {
            const html = await md2html("$$a$$\n$$b$$");
            expect(html2md(html)).toBe("$$a$$\n\n$$b$$");
            expect(await roundTripHtml(html)).toBe(html);
        });

        it("should keep multiline display text literal when editing a plain-text message", async () => {
            const body = "$$\na\n$$";
            const pc = createPartCreator();
            const event = { getContent: () => ({ msgtype: "m.text", body }) } as unknown as MatrixEvent;
            const model = new EditorModel(parseEvent(event, pc), pc);
            const html = await md2html(textSerialize(model));
            expect(html).toBe("$$<br>a<br>$$");
            expect(html).not.toContain("data-mx-maths");
            expect(await roundTripHtml(html)).toBe(html);
        });

        it.each([
            '$$<br>a<br>$$ and <span data-mx-maths="x"><code>x</code></span>',
            '<strong>$$<br>a<br>$$</strong> and <span data-mx-maths="x"><code>x</code></span>',
            '$$<br>a<br>$$ @room <div data-mx-maths="b"><code>b</code></div>',
        ])("should preserve literal text and real maths across repeated edits of %s", async (html) => {
            const first = await roundTripHtml(html);
            const parsed = new DOMParser().parseFromString(first, "text/html");
            expect(
                [...parsed.querySelectorAll("[data-mx-maths]")].map((node) => node.getAttribute("data-mx-maths")),
            ).toEqual(html.includes('data-mx-maths="x"') ? ["x"] : ["b"]);
            expect(parsed.body.textContent).toContain("$$a$$");
            expect(await roundTripHtml(first)).toBe(first);
        });

        it("should round-trip configured delimiters", async () => {
            const original = SdkConfig.get();
            SdkConfig.put({
                latex_maths_delims: {
                    inline: { left: "@", right: "@", pattern: { tex: "(^| )@([^@]+)@" } },
                },
            });
            try {
                const html = await md2html("@x@");
                expect(html2md(html)).toBe("@x@");
                expect(await roundTripHtml(html)).toBe(html);
            } finally {
                SdkConfig.put(original);
            }
        });
    });

    describe("markdown messages should round-trip if they contain", function () {
        it.each([
            ["newlines", "hello\nworld"],
            ["pills", "text message for @room"],
            ["pills with interesting characters in mxid", "text message for @alice\\\\\\_\\]#>&:hs.example.com"],
            ["styling", "**bold** and _emphasised_"],
            ["bold within a word", "abso**fragging**lutely"],
            ["escaped html", "a\\<foo>b"],
            ["escaped markdown", "\\*\\*foo\\*\\* \\_bar\\_ \\[a\\](b)"],
            ["escaped backslashes", "C:\\\\Program Files"],
            ["code in backticks", "foo ->`x`"],
            ["code blocks containing backticks", "```\nfoo ->`x`\nbar\n```"],
            ["code blocks containing markdown", "```\n__init__.py\n```"],
            ["nested formatting", "a<del>b **c _d_ e** f</del>g"],
            ["an ordered list", "A\n\n1. b\n2. c\n3. d\nE"],
            ["an ordered list starting later", "A\n\n9. b\n10. c\n11. d\nE"],
            ["an unordered list", "A\n\n- b\n- c\n- d\nE"],
            ["code block followed by text after a blank line", "```A\nfoo(bar).baz();\n\n3\n```\n\nB"],
            ["just a code block", "```\nfoo(bar).baz();\n\n3\n```"],
            ["code block with language specifier", "```bash\nmake install\n\n```"],
            ["inline code", "there's no place `127.0.0.1` like"],
            ["nested quotations", "saying\n\n> > foo\n\n> NO\n\nis valid"],
            ["quotations", "saying\n\n> NO\n\nis valid"],
            ["links", "click [this](http://example.com/)!"],
        ])("%s", async (_name, markdown) => {
            expect(await roundTripMarkdown(markdown)).toEqual(markdown);
        });

        it.skip.each([
            // Removes trailing spaces
            ["a code block followed by newlines", "```\nfoo(bar).baz();\n\n3\n```\n\n"],
            // Adds a space after the code block
            ["a code block surrounded by text", "```A\nfoo(bar).baz();\n\n3\n```\nB"],
            // Adds a space before the list
            ["an unordered list directly preceded by text", "A\n- b\n- c\n- d\nE"],
            // Re-numbers to 1, 2, 3
            ["an ordered list where everything is 1", "A\n\n1. b\n1. c\n1. d\nE"],
            // Adds a space before the list
            ["an ordered list directly preceded by text", "A\n1. b\n2. c\n3. d\nE"],
            // Adds and removes spaces before the nested list
            ["nested unordered lists", "A\n- b\n- c\n    - c1\n    - c2\n- d\nE"],
            // Adds and removes spaces before the nested list
            ["nested ordered lists", "A\n\n1. b\n2. c\n    1. c1\n    2. c2\n3. d\nE"],
            // Adds and removes spaces before the nested list
            ["nested mixed lists", "A\n\n1. b\n2. c\n    - c1\n    - c2\n3. d\nE"],
            // Backslashes get doubled
            ["backslashes", "C:\\Program Files"],
            // Deletes the whitespace
            ["newlines with trailing and leading whitespace", "hello \n world"],
            // Escapes the underscores
            ["underscores within a word", "abso_fragging_lutely"],
            // Includes the trailing text into the quotation
            // https://github.com/vector-im/element-web/issues/22341
            ["quotations without separating newlines", "saying\n> NO\nis valid"],
            // Removes trailing and leading whitespace
            ["quotations with trailing and leading whitespace", "saying \n\n> NO\n\n is valid"],
        ])("%s", async (_name, markdown) => {
            expect(await roundTripMarkdown(markdown)).toEqual(markdown);
        });

        it("styling, but * becomes _ and __ becomes **", async function () {
            expect(await roundTripMarkdown("__bold__ and *emphasised*")).toEqual("**bold** and _emphasised_");
        });
    });

    describe("HTML messages should round-trip if they contain", function () {
        it.each([
            ["backslashes", "C:\\Program Files"],
            [
                "nested blockquotes",
                "<blockquote>\n<p>foo</p>\n<blockquote>\n<p>bar</p>\n</blockquote>\n</blockquote>\n",
            ],
            ["ordered lists", "<ol>\n<li>asd</li>\n<li>fgd</li>\n</ol>\n"],
            ["ordered lists starting later", '<ol start="3">\n<li>asd</li>\n<li>fgd</li>\n</ol>\n'],
            ["unordered lists", "<ul>\n<li>asd</li>\n<li>fgd</li>\n</ul>\n"],
            ["code blocks with surrounding text", "<p>a</p>\n<pre><code>a\ny;\n</code></pre>\n<p>b</p>\n"],
            ["code blocks", "<pre><code>a\ny;\n</code></pre>\n"],
            ["code blocks containing markdown", "<pre><code>__init__.py\n</code></pre>\n"],
            ["code blocks with language specifier", '<pre><code class="language-bash">__init__.py\n</code></pre>\n'],
            ["paragraphs including formatting", "<p>one</p>\n<p>t <em>w</em> o</p>\n"],
            ["paragraphs", "<p>one</p>\n<p>two</p>\n"],
            ["links", "http://more.example.com/"],
            ["escaped html", "This &gt;em&lt;isn't&gt;em&lt; important"],
            ["markdown-like symbols", "You _would_ **type** [a](http://this.example.com) this."],
            ["formatting within a word", "abso<strong>fragging</strong>lutely"],
            ["formatting", "This <em>is</em> im<strong>port</strong>ant"],
            ["line breaks", "one<br>two"],
        ])("%s", async (_name, html) => {
            expect(await roundTripHtml(html)).toEqual(html);
        });

        it.skip.each([
            // Strips out the pill - maybe needs some user lookup to work?
            ["user pills", '<a href="https://matrix.to/#/@alice:hs.tld">Alice</a>'],
            // Appends a slash to the URL
            // https://github.com/vector-im/element-web/issues/22342
            ["links without trailing slashes", 'Go <a href="http://more.example.com">here</a> to see more'],
            // Inserts newlines after tags
            ["paragraphs without newlines", "<p>one</p><p>two</p>"],
            // Inserts a code block
            ["nested lists", "<ol>\n<li>asd</li>\n<li>\n<ul>\n<li>fgd</li>\n<li>sdf</li>\n</ul>\n</li>\n</ol>\n"],
        ])("%s", async (_name, html) => {
            expect(await roundTripHtml(html)).toEqual(html);
        });
    });
});

/*
Copyright 2024 New Vector Ltd.
Copyright 2022 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React, { type ReactElement } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "test-utils-rtl";
import parse from "html-react-parser";
import { getMockClientWithEventEmitter } from "test-utils";
import katex from "katex";
import { logger } from "matrix-js-sdk/src/logger";

import {
    bodyToHtml,
    bodyToNode,
    formatEmojis,
    sanitizedHtmlNode,
    topicToHtml,
    type EventRenderOpts,
} from "./HtmlUtils";
import SettingsStore from "./settings/SettingsStore";
import { SettingLevel } from "./settings/SettingLevel";
import SdkConfig from "./SdkConfig";
import Markdown from "./Markdown";

describe("topicToHtml", () => {
    function getContent() {
        return screen.getByRole("contentinfo").children[0].innerHTML;
    }

    it("converts plain text topic to HTML", () => {
        render(<div role="contentinfo">{topicToHtml("pizza", undefined, null, false)}</div>);
        expect(getContent()).toEqual("pizza");
    });

    it("converts plain text topic with emoji to HTML", () => {
        render(<div role="contentinfo">{topicToHtml("pizza 🍕", undefined, null, false)}</div>);
        expect(getContent()).toEqual('pizza <span class="mx_Emoji" title=":pizza:">🍕</span>');
    });

    it("converts literal HTML topic to HTML", async () => {
        render(<div role="contentinfo">{topicToHtml("<b>pizza</b>", undefined, null, false)}</div>);
        expect(getContent()).toEqual("&lt;b&gt;pizza&lt;/b&gt;");
    });

    it("converts true HTML topic to HTML", async () => {
        render(<div role="contentinfo">{topicToHtml("**pizza**", "<b>pizza</b>", null, false)}</div>);
        expect(getContent()).toEqual("<b>pizza</b>");
    });

    it("converts true HTML topic with emoji to HTML", async () => {
        render(<div role="contentinfo">{topicToHtml("**pizza** 🍕", "<b>pizza</b> 🍕", null, false)}</div>);
        expect(getContent()).toEqual('<b>pizza</b> <span class="mx_Emoji" title=":pizza:">🍕</span>');
    });
});

describe("bodyToHtml", () => {
    it("should apply highlights to HTML messages", () => {
        const html = bodyToHtml(
            {
                body: "test **foo** bar",
                msgtype: "m.text",
                formatted_body: "test <b>foo</b> bar",
                format: "org.matrix.custom.html",
            },
            ["test"],
        );

        expect(html).toMatchInlineSnapshot(`"<span class="mx_EventTile_searchHighlight">test</span> <b>foo</b> bar"`);
    });

    it("should apply highlights to plaintext messages", () => {
        const html = bodyToHtml(
            {
                body: "test foo bar",
                msgtype: "m.text",
            },
            ["test"],
        );

        expect(html).toMatchInlineSnapshot(`"<span class="mx_EventTile_searchHighlight">test</span> foo bar"`);
    });

    it("preserves source links when rendering composer quotes", () => {
        const html = bodyToHtml(
            {
                body: "Example",
                msgtype: "m.text",
                formatted_body: '<a href="https://example.org" target="_self">Example</a>',
                format: "org.matrix.custom.html",
            },
            [],
            { forComposerQuote: true },
        );

        expect(html).toBe('<a href="https://example.org" target="_self">Example</a>');
    });

    it("should not respect HTML tags in plaintext message highlighting", () => {
        const html = bodyToHtml(
            {
                body: "test foo <b>bar",
                msgtype: "m.text",
            },
            ["test"],
        );

        expect(html).toMatchInlineSnapshot(`"<span class="mx_EventTile_searchHighlight">test</span> foo &lt;b&gt;bar"`);
    });

    it("should linkify and hightlight parts of links in plaintext message highlighting", () => {
        getMockClientWithEventEmitter({});

        const html = bodyToHtml(
            {
                body: "foo http://link.example/test/path bar",
                msgtype: "m.text",
            },
            ["test"],
            {
                linkify: true,
            },
        );

        expect(html).toMatchInlineSnapshot(
            `"foo <a href="http://link.example/test/path" target="_blank" rel="noreferrer noopener" data-linkified="true">http://link.example/<span class="mx_EventTile_searchHighlight">test</span>/path</a> bar"`,
        );
    });

    it("should hightlight parts of links in HTML message highlighting", () => {
        const html = bodyToHtml(
            {
                body: "foo http://link.example/test/path bar",
                msgtype: "m.text",
                formatted_body: 'foo <a href="http://link.example/test/path">http://link.example/test/path</a> bar',
                format: "org.matrix.custom.html",
            },
            ["test"],
            {
                linkify: true,
            },
        );

        expect(html).toMatchInlineSnapshot(
            `"foo <a href="http://link.example/test/path" target="_blank" rel="noreferrer noopener">http://link.example/<span class="mx_EventTile_searchHighlight">test</span>/path</a> bar"`,
        );
    });

    it("should ignore data-linkified in incoming links but should be applied to linkified links", () => {
        getMockClientWithEventEmitter({});
        const html = bodyToHtml(
            {
                body: "foo http://link.example/test/path bar",
                msgtype: "m.text",
                formatted_body:
                    'foo <a data-linkfied="true" href="http://link.example/test/path">http://link.example/test/path</a> bar with https://example.org',
                format: "org.matrix.custom.html",
            },
            [],
            {
                linkify: true,
            },
        );

        expect(html).toMatchInlineSnapshot(
            `"foo <a href="http://link.example/test/path" target="_blank" rel="noreferrer noopener">http://link.example/test/path</a> bar with <a href="https://example.org" target="_blank" rel="noreferrer noopener" data-linkified="true">https://example.org</a>"`,
        );
    });

    it("does not mistake characters in text presentation mode for emoji", () => {
        const { asFragment } = render(
            <span className="mx_EventTile_body translate" dir="auto">
                {parse(bodyToHtml({ body: "↔ ❗︎", msgtype: "m.text" }, [], {}))}
            </span>,
        );

        expect(asFragment()).toMatchSnapshot();
    });

    describe("feature_latex_maths", () => {
        function renderMaths(
            formattedBody: string | undefined,
            rawBody = "maths fallback",
            opts: EventRenderOpts = {},
        ): HTMLElement {
            const html = bodyToHtml(
                {
                    body: rawBody,
                    msgtype: "m.text",
                    formatted_body: formattedBody,
                    format: formattedBody === undefined ? undefined : "org.matrix.custom.html",
                },
                [],
                opts,
            );
            return new DOMParser().parseFromString(html, "text/html").body;
        }

        beforeEach(async () => {
            await SettingsStore.setValue("feature_latex_maths", null, SettingLevel.DEVICE, true);
        });

        afterEach(() => {
            vi.restoreAllMocks();
            SettingsStore.reset();
            SdkConfig.reset();
        });

        it("should render inline katex", () => {
            const html = bodyToHtml(
                {
                    body: "hello \\xi world",
                    msgtype: "m.text",
                    formatted_body: 'hello <span data-mx-maths="\\xi"><code>\\xi</code></span> world',
                    format: "org.matrix.custom.html",
                },
                [],
            );
            expect(html).toMatchSnapshot();
        });

        it("should render block katex", () => {
            const html = bodyToHtml(
                {
                    body: "hello \\xi world",
                    msgtype: "m.text",
                    formatted_body: '<p>hello</p><div data-mx-maths="\\xi"><code>\\xi</code></div><p>world</p>',
                    format: "org.matrix.custom.html",
                },
                [],
            );
            expect(html).toMatchSnapshot();
        });

        it.each([
            [String.raw`Inline \(\frac{1}{n}\) formula`, false, String.raw`\frac{1}{n}`],
            [String.raw`\[\frac{1}{n}\]`, true, String.raw`\frac{1}{n}`],
            ["Before\n$$\\sum_{n=1}^\\infty n^{-2}$$\nAfter", true, String.raw`\sum_{n=1}^\infty n^{-2}`],
        ])("should render explicit delimiters in plain received messages: %s", (raw, displayMode, tex) => {
            const body = renderMaths(undefined, raw);

            expect(body.querySelectorAll("math")).toHaveLength(1);
            expect(body.querySelector("annotation")?.textContent).toBe(tex);
            expect(body.querySelector("math")?.getAttribute("display")).toBe(displayMode ? "block" : null);
        });

        it("should render delimiters in formatted messages while preserving surrounding markup", () => {
            const body = renderMaths(
                String.raw`<p><strong>Answer</strong>: \(x &lt; y\). <a href="https://example.org">Proof</a></p><p>\[a^2\] and $$b^2$$</p>`,
            );

            expect(body.querySelectorAll("math")).toHaveLength(3);
            expect(Array.from(body.querySelectorAll("annotation"), (node) => node.textContent)).toEqual([
                "x < y",
                "a^2",
                "b^2",
            ]);
            expect(body.querySelector("strong")?.textContent).toBe("Answer");
            expect(body.querySelector("a")?.getAttribute("href")).toBe("https://example.org");
            expect(body.textContent).toContain(". Proof");
        });

        it.each(["\n", "<br>", "<br />"])(
            "should recover Markdown-stripped display delimiters from the raw bot body with %s breaks",
            (lineBreak) => {
                const body = renderMaths(
                    `<p><strong>Bot answer</strong></p><p>[${lineBreak}\\frac{1}{n}${lineBreak}]</p><p><em>Done</em></p>`,
                    "**Bot answer**\n\n\\[\n\\frac{1}{n}\n\\]\n\n*Done*",
                );

                expect(body.querySelectorAll("math")).toHaveLength(1);
                expect(body.querySelector("math")?.getAttribute("display")).toBe("block");
                expect(body.querySelector("annotation")?.textContent).toBe("\n\\frac{1}{n}\n");
                expect(body.querySelector("strong")?.textContent).toBe("Bot answer");
                expect(body.querySelector("em")?.textContent).toBe("Done");
            },
        );

        it("should recover a bot message passed through ordinary Markdown", () => {
            const raw = "**Result**\n\n\\[\n\\frac{1}{n}\n\\]\n\n[Explanation](https://example.org)";
            const body = renderMaths(new Markdown(raw).toHTML(), raw);

            expect(body.querySelectorAll("math")).toHaveLength(1);
            expect(body.querySelector("annotation")?.textContent).toBe("\n\\frac{1}{n}\n");
            expect(body.querySelector("strong")?.textContent).toBe("Result");
            expect(body.querySelector("a")?.textContent).toBe("Explanation");
        });

        it("should leave ambiguous repeated stripped delimiters as text", () => {
            const body = renderMaths("<p>(x)</p><p>(x)</p>", String.raw`\(x\) and (x)`);

            expect(body.querySelector("math")).toBeNull();
            expect(body.innerHTML).toBe("<p>(x)</p><p>(x)</p>");
        });

        it.each([String.raw`<p>\(x\) and (x)</p>`, '<p><span data-mx-maths="x"><code>x</code></span> and (x)</p>'])(
            "should not recover literal brackets when the raw formula is already represented: %s",
            (formatted) => {
                const body = renderMaths(formatted, String.raw`\(x\) and (x)`);

                expect(body.querySelectorAll("math")).toHaveLength(1);
                expect(body.querySelector("annotation")?.textContent).toBe("x");
                expect(body.textContent).toContain(" and (x)");
            },
        );

        it("should recover the remaining source formula after accounting for an explicit occurrence", () => {
            const body = renderMaths(String.raw`<p>\(x\) and (x)</p>`, String.raw`\(x\) and \(x\)`);

            expect(body.querySelectorAll("math")).toHaveLength(2);
        });

        it("should leave recovery ambiguous when multiple raw occurrences have only one destination", () => {
            const body = renderMaths("<p>(x)</p>", String.raw`\(x\) and \(x\)`);

            expect(body.querySelector("math")).toBeNull();
            expect(body.textContent).toBe("(x)");
        });

        it("should recover only formatted messages and retain plain literal brackets", () => {
            const body = renderMaths(undefined, String.raw`\(x\) and (x)`);

            expect(body.querySelectorAll("math")).toHaveLength(1);
            expect(body.textContent).toContain(" and (x)");
        });

        it("should preserve line breaks around a received formula", () => {
            const body = renderMaths(String.raw`<p>Before<br>\(x\)<br>After</p>`);

            expect(body.querySelectorAll("br")).toHaveLength(2);
            expect(body.querySelector("p")?.firstChild?.textContent).toBe("Before");
            expect(body.querySelector("p")?.lastChild?.textContent).toBe("After");
        });

        it("should recover stripped inline delimiters only when the raw body retains them", () => {
            const body = renderMaths(String.raw`<p>Answer (\alpha)!</p>`, String.raw`Answer \(\alpha\)!`);

            expect(body.querySelector("annotation")?.textContent).toBe(String.raw`\alpha`);
            expect(body.textContent).toMatch(/^Answer .*!$/);
        });

        it.each([
            ["[\n\\frac{1}{n}\n]", "[\n\\frac{1}{n}\n]"],
            ["(\\alpha)", "(\\alpha)"],
            ["\\frac{1}{n}", "\\frac{1}{n}"],
            ["[\n\\frac{1}{n}\n]", "\\[\n\\frac{1}{m}\n\\]"],
            ["[\n\\frac{1}{n}\n]", "maths fallback"],
            ["(x)", "Use `\\(x\\)` literally"],
        ])("should leave non-matching or unmarked TeX as text: %s", (formatted, raw) => {
            const body = renderMaths(`<p>${formatted}</p>`, raw);

            expect(body.querySelector("math")).toBeNull();
            expect(body.textContent).toBe(formatted);
        });

        it("should not render code or pre text or parse the fallback inside Matrix maths twice", () => {
            const body = renderMaths(
                String.raw`<p><code>\(x\)</code></p><pre>\[y\]</pre><pre><code>$$z$$</code></pre><span data-mx-maths="a"><code>\(a\)</code></span>`,
                String.raw`\(x\) \[y\] $$z$$`,
            );

            expect(body.querySelectorAll("math")).toHaveLength(1);
            expect(body.querySelector("annotation")?.textContent).toBe("a");
            expect(body.querySelector("p code")?.textContent).toBe(String.raw`\(x\)`);
            expect(body.querySelectorAll("pre")[0].textContent).toBe(String.raw`\[y\]`);
            expect(body.querySelectorAll("pre")[1].textContent).toBe("$$z$$");
        });

        it.each([
            "Use `\\(x\\)` literally",
            "```latex\n\\[x\\]\n```",
            "~~~latex\n$$x$$\n~~~",
            String.raw`Escaped \\(x\\) and \\[y\\]`,
            "Tickets are $5/$10, range $5-$10, $3,$4 and $x$",
        ])("should preserve literal plain received text: %s", (raw) => {
            const body = renderMaths(undefined, raw);

            expect(body.querySelector("math")).toBeNull();
            expect(body.textContent).toBe(raw);
        });

        describe.each([false, true])("backtick run boundaries with linkify=%s", (linkify) => {
            it.each([
                "`a `` \\(x\\) b`",
                "``a ` \\(x\\) b``",
                "``a ``` \\(x\\) b``",
                "Use ```a `` \\(x\\) b``` literally",
            ])("should keep embedded runs literal and infer maths after the code span: %s", (raw) => {
                getMockClientWithEventEmitter({});
                const code = linkify ? raw.replace("a ", "a https://example.org ") : raw;
                const body = renderMaths(undefined, `${code}\nOutside \\(y\\)`, { linkify });

                expect(body.querySelectorAll("math")).toHaveLength(1);
                expect(body.querySelector("annotation")?.textContent).toBe("y");
                expect(body.textContent?.startsWith(`${code}\nOutside `)).toBe(true);
                if (linkify) expect(body.querySelector("a")?.textContent).toBe("https://example.org");
            });

            it.each(["``a \\(x\\) b`", "`a \\(x\\) b``"])(
                "should infer maths between unequal delimiter runs: %s",
                (raw) => {
                    getMockClientWithEventEmitter({});
                    const code = linkify ? raw.replace("a ", "a https://example.org ") : raw;
                    const body = renderMaths(undefined, `${code}\nOutside \\(y\\)`, { linkify });

                    expect(Array.from(body.querySelectorAll("annotation"), (node) => node.textContent)).toEqual([
                        "x",
                        "y",
                    ]);
                    if (linkify) expect(body.querySelector("a")?.textContent).toBe("https://example.org");
                },
            );
        });

        it.each([
            "`https://example.org \\(x\\)`",
            "```latex\nhttps://example.org \\[x\\]\n```",
            "~~~latex\nhttps://example.org $$x$$\n~~~",
        ])("should mask complete plain code spans before linkification splits them: %s", (raw) => {
            getMockClientWithEventEmitter({});
            const body = renderMaths(undefined, `${raw}\nOutside \\(y\\)`, { linkify: true });

            expect(body.querySelectorAll("math")).toHaveLength(1);
            expect(body.querySelector("annotation")?.textContent).toBe("y");
            expect(body.querySelector("a")?.textContent).toBe("https://example.org");
            expect(body.textContent).toContain(raw);
        });

        it("should sanitize HTML and use safe KaTeX options for received delimiters", () => {
            const body = renderMaths(
                String.raw`<p onclick="alert(1)">\(\href{javascript:alert(1)}{x}\) \(\rule{1000em}{1em}\)</p><script>alert(1)</script>`,
            );

            expect(body.querySelectorAll("math")).toHaveLength(2);
            expect(body.querySelector("[onclick], script, a[href]")).toBeNull();
            expect(body.querySelector<HTMLElement>(".katex-rule")?.style.borderRightWidth).toBe("20em");
        });

        it("should keep entities as TeX text without interpreting them as HTML", () => {
            const tex = String.raw`\verb|&lt;img src=x onerror=alert(1)&gt;|`;
            const body = renderMaths(undefined, `\\(${tex}\\)`);

            expect(body.querySelector("annotation")?.textContent).toBe(tex);
            expect(body.querySelector("img, [onerror]")).toBeNull();
        });

        it("should keep explicit source on unexpected failure and render later formulae", () => {
            vi.spyOn(katex, "renderToString").mockImplementationOnce(() => {
                throw new Error("Unexpected KaTeX failure");
            });
            vi.spyOn(logger, "warn").mockImplementation(() => {});
            const body = renderMaths(undefined, String.raw`Before \(x\), then \(y\).`);

            expect(body.querySelector("[data-mx-maths]")?.textContent).toBe(String.raw`\(x\)`);
            expect(body.querySelector("annotation")?.textContent).toBe("y");
            expect(body.textContent).toContain("Before \\(x\\), then ");
        });

        it("should leave ordinary received delimiters unchanged when disabled", async () => {
            await SettingsStore.setValue("feature_latex_maths", null, SettingLevel.DEVICE, false);
            const renderToString = vi.spyOn(katex, "renderToString");
            const raw = String.raw`\(x\) \[y\] $$z$$`;
            const formatted = String.raw`<p><strong>Answer</strong> [\frac{1}{n}] \(x\)</p>`;

            expect(renderMaths(undefined, raw).textContent).toBe(raw);
            expect(renderMaths(formatted, String.raw`\[\frac{1}{n}\]`).innerHTML).toBe(formatted);
            expect(renderToString).not.toHaveBeenCalled();
        });

        it.each([String.raw`\href{javascript:alert(1)}{x}`, String.raw`\url{https://example.org}`])(
            "should not trust links in %s",
            (tex) => {
                const body = renderMaths(`<span data-mx-maths="${tex}"><code>fallback</code></span>`);

                expect(body.querySelector(".katex")).not.toBeNull();
                expect(body.querySelector("a[href]")).toBeNull();
            },
        );

        it("should clamp sizes to 20em", () => {
            const body = renderMaths(String.raw`<span data-mx-maths="\rule{1000em}{1em}"><code>rule</code></span>`);
            const rule = body.querySelector<HTMLElement>(".katex-html .katex-rule");

            expect(rule).not.toBeNull();
            expect(rule!.style.borderRightWidth).toBe("20em");
        });

        it("should show invalid TeX with an error title and colour", () => {
            const tex = String.raw`\frac{1}{2`;
            const body = renderMaths(`<span data-mx-maths="${tex}"><code>fallback</code></span>`);
            const error = body.querySelector<HTMLElement>(".katex-error");

            expect(error?.textContent).toBe(tex);
            expect(error?.title).toContain("KaTeX parse error");
            expect(error?.style.color).toBe("#cc0000");
        });

        it("should stop excessive macro expansion", () => {
            const tex = String.raw`\def\a{\a}\a`;
            const body = renderMaths(`<span data-mx-maths="${tex}"><code>fallback</code></span>`);

            expect(body.querySelector(".katex-error")?.getAttribute("title")).toContain("Too many expansions");
        });

        it("should keep the sanitized fallback on unexpected failure and render later elements", () => {
            const error = new Error("Unexpected KaTeX failure");
            vi.spyOn(katex, "renderToString").mockImplementationOnce(() => {
                throw error;
            });
            const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
            const body = renderMaths(
                '<span data-mx-maths="tex"><code onclick="alert(1)">tex</code><script>alert(1)</script></span>' +
                    '<div data-mx-maths="x"><code>x</code></div>',
            );

            expect(body.querySelector("[data-mx-maths]")?.outerHTML).toBe(
                '<span data-mx-maths="tex"><code>tex</code></span>',
            );
            expect(body.querySelector(".katex-display math")?.getAttribute("display")).toBe("block");
            expect(body.querySelector("annotation")?.textContent).toBe("x");
            expect(warn).toHaveBeenCalledExactlyOnceWith("Failed to render maths", error);
        });

        it("should keep inline and block code fallbacks when the flag is off", async () => {
            await SettingsStore.setValue("feature_latex_maths", null, SettingLevel.DEVICE, false);
            const renderToString = vi.spyOn(katex, "renderToString");
            const fallback = '<span data-mx-maths="x"><code>x</code></span><div data-mx-maths="y"><code>y</code></div>';

            expect(renderMaths(fallback).innerHTML).toBe(fallback);
            expect(renderToString).not.toHaveBeenCalled();
        });

        it("should not mangle code blocks", () => {
            const html = bodyToHtml(
                {
                    body: "hello \\xi world",
                    msgtype: "m.text",
                    formatted_body: "<p>hello</p><pre><code>$\\xi$</code></pre><p>world</p>",
                    format: "org.matrix.custom.html",
                },
                [],
            );
            expect(html).toMatchSnapshot();
        });

        it("should not mangle divs", () => {
            const html = bodyToHtml(
                {
                    body: "hello world",
                    msgtype: "m.text",
                    formatted_body: "<p>hello</p><div>world</div>",
                    format: "org.matrix.custom.html",
                },
                [],
            );
            expect(html).toMatchSnapshot();
        });
    });
});

describe("formatEmojis", () => {
    it.each([
        ["🏴󠁧󠁢󠁥󠁮󠁧󠁿", [["🏴󠁧󠁢󠁥󠁮󠁧󠁿", "flag-england"]]],
        ["🏴󠁧󠁢󠁳󠁣󠁴󠁿", [["🏴󠁧󠁢󠁳󠁣󠁴󠁿", "flag-scotland"]]],
        ["🏴󠁧󠁢󠁷󠁬󠁳󠁿", [["🏴󠁧󠁢󠁷󠁬󠁳󠁿", "flag-wales"]]],
    ])("%s emoji", (emoji, expectations) => {
        const res = formatEmojis(emoji, false);
        expect(res).toHaveLength(expectations.length);
        for (let i = 0; i < res.length; i++) {
            const [emoji, title] = expectations[i];
            expect(res[i].props.children).toEqual(emoji);
            expect(res[i].props.title).toEqual(`:${title}:`);
        }
    });
});

describe("bodyToNode", () => {
    it("should retain plain-message whitespace styling around received maths", async () => {
        await SettingsStore.setValue("feature_latex_maths", null, SettingLevel.DEVICE, true);
        try {
            const { className, formattedBody } = bodyToNode(
                { body: "Before  maths\n\\(x\\)\nAfter  maths", msgtype: "m.text" },
                [],
                { linkify: true },
            );
            const body = new DOMParser().parseFromString(formattedBody!, "text/html").body;

            expect(className.split(" ")).not.toContain("markdown-body");
            expect(body.querySelectorAll("math")).toHaveLength(1);
            expect(body.firstChild?.textContent).toBe("Before  maths\n");
            expect(body.lastChild?.textContent).toBe("\nAfter  maths");
        } finally {
            SettingsStore.reset();
        }
    });

    it("generates big emoji for emoji made of multiple characters", () => {
        const { className, emojiBodyElements } = bodyToNode(
            {
                body: "👨‍👩‍👧‍👦 ↔️ 🇮🇸",
                msgtype: "m.text",
            },
            [],
            {
                stripReplyFallback: true,
            },
        );

        const { asFragment } = render(
            <span className={className} dir="auto">
                {emojiBodyElements}
            </span>,
        );

        expect(asFragment()).toMatchSnapshot();
    });

    it("should generate big emoji for an emoji-only reply to a message", () => {
        const { className, formattedBody } = bodyToNode(
            {
                "body": "> <@sender1:server> Test\n\n🥰",
                "format": "org.matrix.custom.html",
                "formatted_body":
                    '<mx-reply><blockquote><a href="https://matrix.to/#/!roomId:server/$eventId">In reply to</a> <a href="https://matrix.to/#/@sender1:server">@sender1:server</a><br>Test</blockquote></mx-reply>🥰',
                "m.relates_to": {
                    "m.in_reply_to": {
                        event_id: "$eventId",
                    },
                },
                "msgtype": "m.text",
            },
            [],
            {
                stripReplyFallback: true,
            },
        );

        const { asFragment } = render(
            <span className={className} dir="auto" dangerouslySetInnerHTML={{ __html: formattedBody! }} />,
        );

        expect(asFragment()).toMatchSnapshot();
    });

    it.each([[true], [false]])(
        "uses the app-specific MXC image transform when mediaIsVisible is %s",
        (mediaIsVisible) => {
            const cli = getMockClientWithEventEmitter({
                mxcUrlToHttp: vi.fn().mockReturnValue("https://example.org/img"),
            });
            const { className, formattedBody } = bodyToNode(
                {
                    "body": "![foo](mxc://going/knowwhere) Hello there",
                    "format": "org.matrix.custom.html",
                    "formatted_body": `<img src="mxc://going/knowwhere">foo</img> Hello there`,
                    "m.relates_to": {
                        "m.in_reply_to": {
                            event_id: "$eventId",
                        },
                    },
                    "msgtype": "m.text",
                },
                [],
                {
                    mediaIsVisible,
                },
            );

            const { asFragment } = render(
                <span className={className} dir="auto" dangerouslySetInnerHTML={{ __html: formattedBody! }} />,
            );
            expect(asFragment()).toMatchSnapshot();
            // We do not want to download untrusted media.
            // eslint-disable-next-line no-restricted-properties
            expect(cli.mxcUrlToHttp).toHaveBeenCalledTimes(mediaIsVisible ? 1 : 0);
        },
    );

    afterEach(() => {
        vi.resetAllMocks();
    });
});

describe("sanitizedHtmlNode", () => {
    it("should respect className", () => {
        const sanitized = sanitizedHtmlNode('<a href="https://google.com">Link</a>', "testClass");
        const { asFragment, getByText } = render(sanitized as ReactElement);
        expect(getByText("Link").parentNode).toHaveClass("testClass");
        expect(asFragment()).toMatchSnapshot();
    });
});

/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { afterEach, describe, expect, it } from "vitest";

import SdkConfig from "../SdkConfig";
import {
    DEFAULT_MATHS_PATTERNS,
    escapeMathsDelimiters,
    getMathsPattern,
    mathsToComposerText,
    replaceMathsDelimiters,
} from "./maths";

// Syntax acceptance cases; code is restored after Markdown parsing in serialize.ts.
const syntaxCases = [
    [String.raw`Euler $e^{i\pi}+1=0$`, "span", String.raw`e^{i\pi}+1=0`],
    ["Identity ($a+b$) holds", "span", "a+b"],
    ["Tickets are $5/$10", null, null],
    ["Range $5-$10", null, null],
    ["$3,$4", null, null],
    ["I paid $5 and $10", null, null],
    [String.raw`\$x\$`, null, null],
    [String.raw`$$\int_0^1 x\,dx$$`, "div", String.raw`\int_0^1 x\,dx`],
    [String.raw`\(\alpha\)`, "span", String.raw`\alpha`],
] as const;

describe("editor/maths", () => {
    afterEach(() => SdkConfig.reset());

    describe("replaceMathsDelimiters", () => {
        it.each(syntaxCases)("should detect maths in %s", (source, tag, tex) => {
            const replaced = replaceMathsDelimiters(source);
            if (tag) {
                expect(replaced).toContain(`<${tag} data-mx-maths="${tex}">`);
            } else {
                expect(replaced).toBe(source);
            }
        });

        it.each(["(", "[", "{", '"', "'", ".", ",", "!", "?", ":", ";", " "])(
            "should allow opening punctuation %s",
            (before) => expect(replaceMathsDelimiters(before + "$x$")).toContain('data-mx-maths="x"'),
        );

        it.each(["$ x$", "$x $", String.raw`$x\$`, "a$x$", "$x$2"])(
            "should leave invalid delimiters %s alone",
            (source) => expect(replaceMathsDelimiters(source)).toBe(source),
        );

        it("should preserve escaped dollars inside TeX and encode HTML", () => {
            expect(replaceMathsDelimiters(String.raw`$x+\$y$`)).toBe(String.raw`<span data-mx-maths="x+\$y"></span>`);
            expect(replaceMathsDelimiters('$x<"y$')).toContain('data-mx-maths="x&lt;&quot;y"');
        });

        it("should support multiline display and adjacent display blocks", () => {
            expect(replaceMathsDelimiters("$$a\nb$$\n$$c$$")).toBe(
                '<div data-mx-maths="a\nb">\n\n</div>\n\n\n<div data-mx-maths="c">\n\n</div>\n\n',
            );
            expect(replaceMathsDelimiters(String.raw`\[x\]`)).toContain('<div data-mx-maths="x">');
        });

        it("should use configured patterns", () => {
            SdkConfig.put({ latex_maths_delims: { inline: { pattern: { tex: "(^| )@([^@]+)@" } } } });
            expect(getMathsPattern("tex", "inline")).toBe("(^| )@([^@]+)@");
            expect(getMathsPattern("tex", "display")).toBe(DEFAULT_MATHS_PATTERNS.tex.display);
            expect(replaceMathsDelimiters("@x@")).toBe('<span data-mx-maths="x"></span>');
            expect(replaceMathsDelimiters("$x$")).toBe("$x$");
        });
    });

    describe("mathsToComposerText", () => {
        it.each([
            ["", "", "$x$"],
            ["(", ")", "$x$"],
            ["a", "", String.raw`\(x\)`],
            ["", "2", String.raw`\(x\)`],
            [null, "", String.raw`\(x\)`],
            ["", null, String.raw`\(x\)`],
        ])("should respect neighbouring characters %s and %s", (prev, next, expected) => {
            expect(mathsToComposerText("x", "inline", prev, next)).toBe(expected);
        });

        it.each([" x", "x ", "x$y", "x\ny"])("should fall back for unsafe inline TeX %s", (tex) => {
            expect(mathsToComposerText(tex, "inline", "", "")).toBe(`\\(${tex}\\)`);
        });

        it("should check display delimiters against the whole TeX", () => {
            expect(mathsToComposerText("a\nb", "display", null, null)).toBe("$$a\nb$$");
            expect(mathsToComposerText("a$b", "display", "", "")).toBe(String.raw`\[a$b\]`);
        });

        it("should respect configured detection when choosing dollars", () => {
            SdkConfig.put({ latex_maths_delims: { inline: { pattern: { tex: "(^)@([^@]+)@" } } } });
            expect(mathsToComposerText("x", "inline", "", "")).toBe(String.raw`\(x\)`);
        });

        it.each([
            ["inline", { left: "<", right: ">" }, "<x>"],
            ["inline", { left: "<" }, String.raw`<x\)`],
            ["inline", { right: ">" }, String.raw`\(x>`],
            ["display", { left: "<" }, String.raw`<x\]`],
            ["display", { right: ">" }, String.raw`\[x>`],
            ["inline", { left: "", right: "" }, "x"],
        ] as const)("should respect custom %s delimiters %j", (kind, config, expected) => {
            SdkConfig.put({ latex_maths_delims: { [kind]: config } });
            expect(mathsToComposerText("x", kind, null, null)).toBe(expected);
        });
    });

    describe("escapeMathsDelimiters", () => {
        it.each(["()\\$([^$]+)\\$", "()@([^@]+)@", "()(?=x)(x)"])(
            "should stop escaping when a custom pattern ignores backslashes: %s",
            (pattern) => {
                SdkConfig.put({ latex_maths_delims: { inline: { pattern: { tex: pattern } } } });
                const source = "$x$ @y@";
                const result = escapeMathsDelimiters(source);
                expect(result).not.toBe(source);
                expect(result.length).toBeLessThanOrEqual(source.length * 2);
                expect(escapeMathsDelimiters(result)).toBe(result);
            },
        );

        it.each([
            ["$x$", String.raw`\$x$`],
            ["($x$) and $y$", String.raw`(\$x$) and \$y$`],
            ["$$a$$\n$$b$$", "\\$$a$$\n\\$$b$$"],
            ["$a $b$ c$", String.raw`\$a \$b$ c$`],
            ["$a $b $c $d $e $f$", String.raw`\$a \$b \$c \$d \$e \$f$`],
            [String.raw`\$x\$`, String.raw`\$x\$`],
            ["Tickets are $5/$10", "Tickets are $5/$10"],
            ["Range $5-$10", "Range $5-$10"],
            ["$3,$4", "$3,$4"],
            ["I paid $5 and $10", "I paid $5 and $10"],
            ["ordinary text", "ordinary text"],
        ])("should preserve literal text %s", (source, escaped) => {
            const result = escapeMathsDelimiters(source);
            expect(result).toBe(escaped);
            expect(replaceMathsDelimiters(result)).toBe(result);
            expect(escapeMathsDelimiters(result)).toBe(result);
        });
    });
});

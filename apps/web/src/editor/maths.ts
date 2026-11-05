/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { encode } from "html-entities";

import SdkConfig from "../SdkConfig";

/** Kind of maths element: a span (inline) or a div (display). */
export type MathsKind = "inline" | "display";

/** Delimiter family: dollars (tex) or backslashed parentheses and brackets (latex). */
export type MathsSyntax = "tex" | "latex";

/** Regex sources with flags gms: group 1 is the preceding text, group 2 is the TeX. */
export const DEFAULT_MATHS_PATTERNS: Readonly<Record<MathsSyntax, Readonly<Record<MathsKind, string>>>> = {
    tex: {
        display: "(^)\\$\\$(([^$]|\\\\\\$)+?)\\$\\$$",
        // Opening punctuation is allowed; a digit after the closing dollar indicates currency.
        inline: "(^|[\\s.,!?:;(\\[{\"'])(?!\\\\)\\$(?!\\s)(([^$\\n]|\\\\\\$)*([^\\\\\\s\\$]|\\\\\\$)(?:\\\\\\$)?)\\$(?!\\d)",
    },
    latex: {
        display: "(^)\\\\\\[(?!\\\\\\])(.*?)\\\\\\]$",
        inline: "(^|[^\\\\])\\\\\\((?!\\\\\\))(.*?)\\\\\\)",
    },
};

/** Returns the configured detection pattern, or the default for this syntax and kind. */
export function getMathsPattern(syntax: MathsSyntax, kind: MathsKind): string {
    return SdkConfig.get("latex_maths_delims")?.[kind]?.pattern?.[syntax] || DEFAULT_MATHS_PATTERNS[syntax][kind];
}

/** Replaces delimiters in Markdown with encoded maths elements, before Markdown parsing. */
export function replaceMathsDelimiters(md: string): string {
    for (const syntax of ["tex", "latex"] as const) {
        for (const kind of ["display", "inline"] as const) {
            md = md.replace(new RegExp(getMathsPattern(syntax, kind), "gms"), (_match, before, tex) => {
                const encoded = encode(tex);
                return kind === "display"
                    ? `${before}<div data-mx-maths="${encoded}">\n\n</div>\n\n`
                    : `${before}<span data-mx-maths="${encoded}"></span>`;
            });
        }
    }
    // Block tags must start on their own line for the Markdown parser.
    return md.replace(/(.)<div/g, "$1\n<div");
}

/**
 * Returns composer text whose delimiters will detect the same TeX when the edit is sent.
 * @param prevChar - Previous character on the same line, empty at its start, or null if unknown.
 * @param nextChar - Next character on the same line, empty at its end, or null if unknown.
 */
export function mathsToComposerText(
    tex: string,
    kind: MathsKind,
    prevChar: string | null,
    nextChar: string | null,
): string {
    const configured = SdkConfig.get("latex_maths_delims")?.[kind];
    const left = kind === "inline" ? "\\(" : "\\[";
    const right = kind === "inline" ? "\\)" : "\\]";
    if (configured?.left !== undefined || configured?.right !== undefined) {
        return `${configured?.left ?? left}${tex}${configured?.right ?? right}`;
    }

    const dollars = kind === "inline" ? `$${tex}$` : `$$${tex}$$`;
    if (kind === "display" || (prevChar !== null && nextChar !== null)) {
        const before = kind === "inline" ? prevChar! : "";
        const after = kind === "inline" ? nextChar! : "";
        const match = new RegExp(getMathsPattern("tex", kind), "gms").exec(before + dollars + after);
        if (match?.index === 0 && match[0].length === before.length + dollars.length && match[2] === tex) {
            return dollars;
        }
    }
    return left + tex + right;
}

/** Escapes openings of dollar-delimited maths so literal text survives editing. */
export function escapeMathsDelimiters(text: string): string {
    // Escaping an opening can expose another, so continue while there are new openings to escape.
    while (true) {
        const openings = new Set<number>();
        for (const kind of ["display", "inline"] as const) {
            for (const match of text.matchAll(new RegExp(getMathsPattern("tex", kind), "gms"))) {
                const index = match.index + match[1].length;
                // Custom patterns may still match escaped openings. Escape each original character at most once.
                if (index < text.length && text[index] !== "\\" && text[index - 1] !== "\\") {
                    openings.add(index);
                }
            }
        }
        if (!openings.size) break;
        for (const index of [...openings].sort((a, b) => b - a)) {
            text = text.slice(0, index) + "\\" + text.slice(index);
        }
    }
    return text;
}

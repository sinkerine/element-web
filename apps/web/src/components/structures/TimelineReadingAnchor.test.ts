/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { TimelineReadingAnchor } from "./TimelineReadingAnchor";

function rect(top: number, height = 40): DOMRect {
    return { top, bottom: top + height, height } as DOMRect;
}

describe("TimelineReadingAnchor", () => {
    it("resolves a passage after its DOM is replaced by an append-only edit", () => {
        const tile = document.createElement("li");
        tile.innerHTML = "<p>Earlier</p><p>Reading here</p>";
        tile.getBoundingClientRect = () => rect(-100);
        tile.children[0].getBoundingClientRect = () => rect(-100);
        tile.children[1].getBoundingClientRect = () => rect(-10);
        const anchor = TimelineReadingAnchor.capture(tile, 0)!;
        expect(anchor.getOffset(tile)).toBe(90);
        tile.innerHTML = "<p>Earlier, now taller</p><p>Reading here and more</p><p>Later</p>";
        tile.children[1].getBoundingClientRect = () => rect(60);
        expect(anchor.getOffset(tile)).toBe(160);
    });

    it("retains the tile offset if an edit removes or rewrites the passage", () => {
        const tile = document.createElement("li");
        tile.innerHTML = "<p>Earlier</p><p>Reading here</p>";
        tile.getBoundingClientRect = () => rect(-100);
        tile.children[0].getBoundingClientRect = () => rect(-100);
        tile.children[1].getBoundingClientRect = () => rect(-10);
        const anchor = TimelineReadingAnchor.capture(tile, 0)!;
        tile.children[1].textContent = "Different passage";
        expect(anchor.getOffset(tile)).toBe(90);
        tile.children[1].remove();
        expect(anchor.getOffset(tile)).toBe(90);
    });

    it("prefers the first visible paragraph start to the clipped paragraph above it", () => {
        const tile = document.createElement("li");
        tile.innerHTML = "<p>Partly clipped</p><p>Reading here</p><p>Below viewport</p>";
        tile.getBoundingClientRect = () => rect(-100);
        tile.children[0].getBoundingClientRect = () => rect(-10);
        tile.children[1].getBoundingClientRect = () => rect(30);
        tile.children[2].getBoundingClientRect = () => rect(350);
        const anchor = TimelineReadingAnchor.capture(tile, 0, 300)!;
        tile.children[1].getBoundingClientRect = () => rect(60);
        expect(anchor.getOffset(tile)).toBe(160);
    });

    it("uses a clipped block if its next sibling is outside the viewport", () => {
        const tile = document.createElement("li");
        tile.innerHTML = "<pre>Long code</pre><p>Below viewport</p>";
        tile.getBoundingClientRect = () => rect(-100);
        tile.children[0].getBoundingClientRect = () => rect(-10, 400);
        tile.children[1].getBoundingClientRect = () => rect(400);
        const anchor = TimelineReadingAnchor.capture(tile, 0, 300)!;
        tile.children[0].getBoundingClientRect = () => rect(60, 400);
        expect(anchor.getOffset(tile)).toBe(160);
    });

    it("recovers a unique passage when an edit replaces the body wrappers", () => {
        const tile = document.createElement("li");
        tile.innerHTML = "<div><p>Reading here</p></div>";
        tile.getBoundingClientRect = () => rect(-100);
        tile.querySelector("p")!.getBoundingClientRect = () => rect(-10);
        const anchor = TimelineReadingAnchor.capture(tile, 0)!;
        tile.innerHTML = "<section><div><p>Reading here</p></div></section>";
        tile.querySelector("p")!.getBoundingClientRect = () => rect(60);
        expect(anchor.getOffset(tile)).toBe(160);
        tile.innerHTML = "<p>Reading here</p><p>Reading here</p>";
        expect(anchor.getOffset(tile)).toBe(90);
    });

    it("tracks the passage inside a quote instead of the entire quote", () => {
        const tile = document.createElement("li");
        tile.innerHTML = "<blockquote><p>Earlier</p><p>Reading here</p></blockquote>";
        tile.getBoundingClientRect = () => rect(-100);
        const quote = tile.firstElementChild!;
        quote.getBoundingClientRect = () => rect(-100, 200);
        quote.children[0].getBoundingClientRect = () => rect(-100);
        quote.children[1].getBoundingClientRect = () => rect(-10);
        const anchor = TimelineReadingAnchor.capture(tile, 0)!;
        quote.children[1].getBoundingClientRect = () => rect(60);
        expect(anchor.getOffset(tile)).toBe(160);
    });

    it("ignores hidden blocks and returns no anchor for a media-only tile", () => {
        const tile = document.createElement("li");
        tile.innerHTML = "<p hidden>Hidden</p><img>";
        tile.children[0].getBoundingClientRect = () => rect(0, 0);
        expect(TimelineReadingAnchor.capture(tile, 0)).toBeUndefined();
    });
});

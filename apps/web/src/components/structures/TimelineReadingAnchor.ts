/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

/** A visible text block within a timeline tile, retained across append-only message edits. */
export class TimelineReadingAnchor {
    private constructor(
        private readonly path: number[],
        private readonly tag: string,
        private readonly text: string,
        private readonly offset: number,
    ) {}

    /** Prefer the first block starting in the viewport, falling back to a partially visible block. */
    public static capture(
        tile: HTMLElement,
        viewportTop: number,
        viewportBottom = Infinity,
    ): TimelineReadingAnchor | undefined {
        let partial: HTMLElement | undefined;
        const selector = "p, pre, li, blockquote, h1, h2, h3, h4, h5, h6, tr";
        const blocks = tile.querySelectorAll<HTMLElement>(selector);
        for (const block of blocks) {
            // Prefer the passage inside a quote or list, rather than its entire container.
            if (block.querySelector(selector)) continue;
            const rect = block.getBoundingClientRect();
            if (rect.height === 0 || rect.bottom <= viewportTop || !block.textContent) continue;

            if (rect.top >= viewportBottom) break;
            if (rect.top >= viewportTop) return this.fromBlock(tile, block);
            partial = block;
        }
        if (partial) return this.fromBlock(tile, partial);
    }

    private static fromBlock(tile: HTMLElement, block: HTMLElement): TimelineReadingAnchor {
        const path: number[] = [];
        let node: Element = block;
        while (node !== tile) {
            const parent = node.parentElement!;
            path.unshift(Array.prototype.indexOf.call(parent.children, node));
            node = parent;
        }
        return new TimelineReadingAnchor(
            path,
            block.tagName,
            block.textContent.slice(0, 64),
            block.getBoundingClientRect().top - tile.getBoundingClientRect().top,
        );
    }

    /** Resolve after HTML replacement; fall back to the tile offset if the passage was rewritten. */
    public getOffset(tile: HTMLElement): number {
        let node: Element | undefined = tile;
        for (const index of this.path) {
            node = node?.children[index];
        }
        if (node?.tagName !== this.tag || !node.textContent?.startsWith(this.text)) {
            // An edit can replace the body wrappers. Recover only an unambiguous passage
            // in the same event; repeated text must not select an unrelated block.
            const matches = Array.from(tile.getElementsByTagName(this.tag)).filter((block) =>
                block.textContent?.startsWith(this.text),
            );
            if (matches.length !== 1) return this.offset;
            node = matches[0];
        }
        return node.getBoundingClientRect().top - tile.getBoundingClientRect().top;
    }
}

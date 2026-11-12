/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
    BaseViewModel,
    type AnswerNavigationViewModel as AnswerNavigationViewModelInterface,
    type AnswerNavigationViewSnapshot,
} from "@element-hq/web-shared-components";

const spoilerSelector = ".mx_EventTile_spoiler, [data-mx-spoiler]";
const excludedContent = `blockquote, mx-reply, pre, code, ${spoilerSelector}`;
const headingSelector = "h1, h2, h3, h4, h5, h6";
const sourceHeading = /^(sources|references)$/iu;
const controlSelector = "[data-answer-navigation-control]";
const text = (element: Element): string => {
    // Local heading actions must never become authored labels or contribute to answer length.
    const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) =>
            node.parentElement?.closest(controlSelector) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    const parts: string[] = [];
    while (walker.nextNode()) parts.push(walker.currentNode.textContent ?? "");
    return parts.join("").replace(/\s+/gu, " ").trim();
};

/** Navigates the current sanitized DOM of one long, structured message, without fetching links. */
export class AnswerNavigationViewModel
    extends BaseViewModel<AnswerNavigationViewSnapshot, void>
    implements AnswerNavigationViewModelInterface
{
    private element: HTMLElement | null = null;
    private observer?: MutationObserver;
    private headings: HTMLElement[] = [];
    private links: HTMLAnchorElement[] = [];

    public constructor() {
        super(undefined, { sections: [], sources: [], isIndexOpen: false });
        this.disposables.track(() => {
            this.observer?.disconnect();
            this.element = null;
            this.headings = [];
            this.links = [];
        });
    }

    /** Observe the rendered body, so replacements, reply stripping and sanitization stay authoritative. */
    public setElement = (element: HTMLElement | null): void => {
        this.observer?.disconnect();
        this.element = element;
        this.refresh();
        if (!element) return;
        this.observer = new MutationObserver((records) => {
            // React portals add controls to headings, but do not change the message itself.
            const contentChanged = records.some((record) => {
                if (record.target instanceof Element && record.target.closest(controlSelector)) return false;
                if (record.type !== "childList") return true;
                return [...record.addedNodes, ...record.removedNodes].some(
                    (node) => !(node instanceof Element && node.matches(controlSelector)),
                );
            });
            if (contentChanged) this.refresh();
        });
        this.observer.observe(element, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: ["href", "target"],
        });
    };

    private refresh = (): void => {
        const element = this.element;
        const headings = element
            ? Array.from(element.querySelectorAll<HTMLElement>(headingSelector)).filter(
                  (heading) =>
                      !heading.closest(excludedContent) && !heading.querySelector(spoilerSelector) && text(heading),
              )
            : [];
        // Three sections and roughly a page of text avoid adding controls to everyday short messages.
        this.headings = element && headings.length >= 3 && text(element).length >= 2000 ? headings : [];
        this.links = [];
        const sources: AnswerNavigationViewSnapshot["sources"] = [];
        const seen = new Set<string>();
        for (const [index, heading] of this.headings.entries()) {
            if (!sourceHeading.test(text(heading))) continue;
            const end = this.headings.slice(index + 1).find((next) => next.tagName <= heading.tagName);
            const range = document.createRange();
            range.setStartAfter(heading);
            if (end) range.setEndBefore(end);
            else range.setEndAfter(element!.lastChild!);
            for (const link of element!.querySelectorAll<HTMLAnchorElement>("a[href]")) {
                if (!range.intersectsNode(link) || link.closest(excludedContent) || link.querySelector(spoilerSelector))
                    continue;
                // Use only existing external links: preserve Element's safe-link handling and tab behavior.
                if (
                    link.target !== "_blank" ||
                    !/^https?:\/\//iu.test(link.getAttribute("href") ?? "") ||
                    seen.has(link.href)
                )
                    continue;
                let host: string;
                try {
                    host = new URL(link.href).host;
                } catch {
                    continue;
                }
                const label = text(link);
                if (!label) continue;
                seen.add(link.href);
                this.links.push(link);
                sources.push({ label, host });
            }
        }
        const previous = this.getSnapshot();
        const currentHeading = previous.sections[previous.currentSection ?? -1]?.heading;
        const currentSection = currentHeading ? this.headings.indexOf(currentHeading) : -1;
        this.snapshot.merge({
            sections: this.headings.map((heading) => ({
                label: text(heading),
                level: Number(heading.tagName[1]),
                heading,
            })),
            sources,
            isIndexOpen: previous.isIndexOpen && this.headings.length > 0,
            currentSection: currentSection >= 0 ? currentSection : undefined,
        });
    };

    /** Open the message-scoped index without changing the reading position. */
    public openIndex = (index?: number): void => {
        if (!this.headings.length || (index !== undefined && !this.headings[index])) return;
        this.snapshot.merge({ isIndexOpen: true, currentSection: index ?? this.getSnapshot().currentSection });
    };

    /** Dismiss the index without requesting a scroll. */
    public closeIndex = (): void => {
        this.snapshot.merge({ isIndexOpen: false });
    };

    /** Element references distinguish repeated headings without trusting message-provided IDs. */
    public goToSection = (index: number): void => {
        const heading = this.headings[index];
        if (!heading) return;
        this.snapshot.merge({ isIndexOpen: false, currentSection: index });
        heading.scrollIntoView({ block: "start", behavior: "instant" });
    };

    /** Activate the original sanitized link, including the app's existing link handlers. */
    public openSource = (index: number): void => {
        this.closeIndex();
        this.links[index]?.click();
    };
}

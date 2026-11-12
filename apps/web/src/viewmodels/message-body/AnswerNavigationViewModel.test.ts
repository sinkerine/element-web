/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import { AnswerNavigationViewModel } from "./AnswerNavigationViewModel";

const longText = "A paragraph explaining the recommendation. ".repeat(55);
const answer = `<h2>Overview</h2><p>${longText}</p><h2>Details</h2><table><tr><td>Result</td></tr></table>
<pre><code>example</code></pre><h2>Details</h2><p>Another passage.</p><h2>Sources</h2>
<ul><li><a href="https://example.org/paper" target="_blank" rel="noreferrer noopener">Original paper</a></li></ul>`;
const models: AnswerNavigationViewModel[] = [];
const setup = (html = answer): { vm: AnswerNavigationViewModel; body: HTMLDivElement } => {
    const body = document.createElement("div");
    body.innerHTML = html;
    const vm = new AnswerNavigationViewModel();
    models.push(vm);
    vm.setElement(body);
    return { vm, body };
};

afterEach(() => models.splice(0).forEach((vm) => vm.dispose()));

describe("AnswerNavigationViewModel", () => {
    it("navigates repeated headings independently without assigning IDs", () => {
        const { vm, body } = setup();
        expect(vm.getSnapshot().sections.map((entry) => entry.label)).toEqual([
            "Overview",
            "Details",
            "Details",
            "Sources",
        ]);
        const headings = body.querySelectorAll("h2");
        const first = vi.fn();
        const second = vi.fn();
        headings[1].scrollIntoView = first;
        headings[2].scrollIntoView = second;
        vm.goToSection(2);
        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledWith({ block: "start", behavior: "instant" });
        expect(body.querySelector("[id]")).toBeNull();
    });

    it("uses the existing link and supplied label with the visible host", () => {
        const { vm, body } = setup();
        expect(vm.getSnapshot().sources).toEqual([{ label: "Original paper", host: "example.org" }]);
        const click = vi.spyOn(body.querySelector("a")!, "click").mockImplementation(() => {});
        vm.openSource(0);
        expect(click).toHaveBeenCalledOnce();
    });

    it("does not classify ordinary links as sources and respects section boundaries", () => {
        const { vm } =
            setup(`<h2>Overview</h2><p>${longText}<a href="https://ordinary.test" target="_blank">Ordinary</a></p>
<h2>References</h2><a href="https://source.test" target="_blank">Evidence</a>
<h2>Next steps</h2><a href="https://other.test" target="_blank">Other</a>`);
        expect(vm.getSnapshot().sources).toEqual([{ label: "Evidence", host: "source.test" }]);
    });

    it("ignores unsafe, internal, duplicate and quoted source links", () => {
        const { vm } = setup(
            answer +
                `<a href="https://example.org/paper" target="_blank">Duplicate</a>
<a href="javascript:alert(1)" target="_blank">Unsafe</a><a href="https://internal.test">Internal</a>
<a href="https://[" target="_blank">Malformed</a><a href="/relative" target="_blank">Relative</a>
<blockquote><a href="https://quote.test" target="_blank">Quoted</a></blockquote>
<span data-mx-spoiler><a href="https://hidden.test" target="_blank">Hidden</a></span>`,
        );
        expect(vm.getSnapshot().sources).toHaveLength(1);
    });

    it.each([
        "Plain message with https://example.org",
        "<h2>One</h2><h2>Two</h2><h2>Three</h2><p>Short answer.</p>",
        `<h2>One</h2><p>${longText}</p>`,
        `<blockquote>${answer}</blockquote>`,
        `<span class="mx_EventTile_spoiler">${answer}</span>`,
    ])("omits controls for short, unstructured or quoted content", (html) => {
        expect(setup(html).vm.getSnapshot()).toEqual({ sections: [], sources: [], isIndexOpen: false });
    });

    it("rebuilds navigation when an edit replaces the content", async () => {
        const { vm, body } = setup();
        body.innerHTML = answer
            .replaceAll("Details", "Updated section")
            .replace("https://example.org/paper", "https://updated.test/paper");
        await vi.waitFor(() => expect(vm.getSnapshot().sections[1].label).toBe("Updated section"));
        expect(vm.getSnapshot().sources[0].host).toBe("updated.test");
        body.textContent = "Now a short answer";
        await vi.waitFor(() => expect(vm.getSnapshot().sections).toEqual([]));
        expect(vm.getSnapshot().sources).toEqual([]);
        expect(() => vm.goToSection(2)).not.toThrow();
        expect(() => vm.openSource(0)).not.toThrow();
    });

    it("does not expose spoiler text nested inside heading or source labels", () => {
        const { vm } = setup(
            answer +
                `<a href="https://secret.test" target="_blank"><span data-mx-spoiler>Secret source</span></a>
<h2><span class="mx_EventTile_spoiler">Secret heading</span></h2>`,
        );
        expect(vm.getSnapshot().sections).toHaveLength(4);
        expect(vm.getSnapshot().sources).toEqual([{ label: "Original paper", host: "example.org" }]);
    });

    it("opens from a repeated heading and dismisses without requesting a scroll", () => {
        const { vm, body } = setup();
        const scroll = vi.fn();
        body.querySelectorAll("h2").forEach((heading) => {
            heading.scrollIntoView = scroll;
        });
        vm.openIndex(2);
        expect(vm.getSnapshot()).toMatchObject({ isIndexOpen: true, currentSection: 2 });
        vm.closeIndex();
        expect(vm.getSnapshot()).toMatchObject({ isIndexOpen: false, currentSection: 2 });
        expect(scroll).not.toHaveBeenCalled();
        vm.openIndex();
        expect(vm.getSnapshot()).toMatchObject({ isIndexOpen: true, currentSection: 2 });
        vm.goToSection(1);
        expect(vm.getSnapshot()).toMatchObject({ isIndexOpen: false, currentSection: 1 });
        expect(scroll).toHaveBeenCalledOnce();
        vm.openIndex(99);
        expect(vm.getSnapshot().isIndexOpen).toBe(false);
    });

    it("ignores its generated heading controls when observing and labeling content", async () => {
        const { vm, body } = setup();
        const changed = vi.fn();
        vm.subscribe(changed);
        const control = document.createElement("span");
        control.setAttribute("data-answer-navigation-control", "");
        control.textContent = "Sections";
        body.querySelector("h2")!.append(control);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(changed).not.toHaveBeenCalled();
        body.querySelector("a")!.href = "https://updated.test";
        await vi.waitFor(() => expect(vm.getSnapshot().sources[0].host).toBe("updated.test"));
        expect(vm.getSnapshot().sections[0].label).toBe("Overview");
        control.textContent = "Translated Sections";
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(vm.getSnapshot().sections[0].label).toBe("Overview");
    });

    it("clears an obsolete current marker and closes the index when an edit becomes ineligible", async () => {
        const { vm, body } = setup();
        vm.openIndex(2);
        body.innerHTML = answer.replaceAll("Details", "Updated");
        await vi.waitFor(() => expect(vm.getSnapshot().sections[1].label).toBe("Updated"));
        expect(vm.getSnapshot().currentSection).toBeUndefined();
        expect(vm.getSnapshot().isIndexOpen).toBe(true);
        body.textContent = "Short replacement";
        await vi.waitFor(() => expect(vm.getSnapshot().isIndexOpen).toBe(false));
        vm.openIndex();
        expect(vm.getSnapshot().isIndexOpen).toBe(false);
    });

    it("refreshes source destinations when only link attributes change", async () => {
        const { vm, body } = setup();
        body.querySelector("a")!.href = "https://revised.test/evidence";
        await vi.waitFor(() => expect(vm.getSnapshot().sources[0].host).toBe("revised.test"));
    });

    it("disconnects old content and releases targets when detached or disposed", async () => {
        const { vm, body } = setup();
        vm.setElement(null);
        body.innerHTML = answer;
        await Promise.resolve();
        expect(vm.getSnapshot()).toEqual({ sections: [], sources: [], isIndexOpen: false });
        vm.setElement(body);
        vm.dispose();
        const click = vi.spyOn(body.querySelector("a")!, "click");
        vm.openSource(0);
        expect(click).not.toHaveBeenCalled();
    });
});

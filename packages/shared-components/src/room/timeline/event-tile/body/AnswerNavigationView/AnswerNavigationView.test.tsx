/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React from "react";
import { render, screen, waitFor, fireEvent } from "@test-utils";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AnswerNavigationView, type AnswerNavigationViewSnapshot } from "./AnswerNavigationView";
import { BaseViewModel } from "../../../../../core/viewmodel";

class TestViewModel extends BaseViewModel<AnswerNavigationViewSnapshot, void> {
    public constructor(snapshot: Partial<AnswerNavigationViewSnapshot> = {}) {
        super(undefined, { sections: [], sources: [], isIndexOpen: false, ...snapshot });
    }
    public openIndex = vi.fn((index?: number) => this.snapshot.merge({ isIndexOpen: true, currentSection: index }));
    public closeIndex = vi.fn(() => this.snapshot.merge({ isIndexOpen: false }));
    public goToSection = vi.fn((index: number) => this.snapshot.merge({ isIndexOpen: false, currentSection: index }));
    public openSource = vi.fn(() => this.snapshot.merge({ isIndexOpen: false }));
    public clear = (): void => this.snapshot.merge({ sections: [], sources: [], isIndexOpen: false });
}

const headings: HTMLElement[] = [];
const makeHeading = (label: string): HTMLHeadingElement => {
    const heading = document.createElement("h2");
    const title = document.createElement("span");
    title.setAttribute("data-answer-navigation-title", "");
    title.textContent = label;
    heading.append(title);
    document.body.append(heading);
    headings.push(heading);
    return heading;
};
afterEach(() => headings.splice(0).forEach((heading) => heading.remove()));

describe("AnswerNavigationView", () => {
    it("opens a numbered index and dismisses before navigating or opening a source", async () => {
        const vm = new TestViewModel({
            sections: [
                { label: "Details", level: 2 },
                { label: "Details", level: 3 },
            ],
            sources: [{ label: "Original study", host: "example.org" }],
        });
        const user = userEvent.setup();
        render(<AnswerNavigationView vm={vm} />);
        expect(screen.queryByRole("dialog")).toBeNull();
        await user.click(screen.getByRole("button", { name: "In this message" }));
        await user.click(screen.getByRole("button", { name: "2. Details" }));
        expect(vm.goToSection).toHaveBeenCalledWith(1);
        expect(screen.queryByRole("dialog")).toBeNull();
        await user.click(screen.getByRole("button", { name: "In this message" }));
        await user.click(screen.getByRole("button", { name: "Original study (example.org)" }));
        expect(vm.openSource).toHaveBeenCalledWith(0);
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("reopens from a heading, marks its section Current, and supports close and native cancel", async () => {
        const heading = makeHeading("Details");
        const vm = new TestViewModel({
            sections: [
                { label: "Details", level: 2 },
                { label: "Details", level: 2, heading },
            ],
        });
        render(<AnswerNavigationView vm={vm} />);
        const user = userEvent.setup();
        const action = screen.getByRole("button", { name: "Sections" });
        await user.click(action);
        expect(vm.openIndex).toHaveBeenCalledWith(1);
        expect(screen.getByRole("button", { name: "2. Details Current" })).toHaveAttribute("aria-current", "true");
        await user.click(screen.getByRole("button", { name: "Close" }));
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(vm.goToSection).not.toHaveBeenCalled();
        await user.click(action);
        fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        expect(vm.goToSection).not.toHaveBeenCalled();
        await user.click(action);
        fireEvent(screen.getByRole("dialog"), new Event("close"));
        expect(screen.getByRole("dialog")).toBeVisible();
        fireEvent.keyDown(screen.getByRole("dialog"), { key: "x" });
        expect(screen.getByRole("dialog")).toBeVisible();
        fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        expect(vm.goToSection).not.toHaveBeenCalled();
    });

    it("closes on backdrop clicks but keeps the dialog open for interior clicks", async () => {
        const vm = new TestViewModel({ sections: [{ label: "Details", level: 2 }], isIndexOpen: true });
        render(<AnswerNavigationView vm={vm} />);
        const dialog = await screen.findByRole("dialog");
        const bounds = dialog.getBoundingClientRect();
        fireEvent.click(dialog, { clientX: bounds.left + 5, clientY: bounds.top + 5 });
        expect(screen.getByRole("dialog")).toBeVisible();
        fireEvent.click(dialog, { clientX: bounds.left - 5, clientY: bounds.top - 5 });
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    });

    it("does not show a sources area for ordinary links", async () => {
        const vm = new TestViewModel({ sections: [{ label: "Details", level: 2 }], isIndexOpen: true });
        render(<AnswerNavigationView vm={vm} />);
        await screen.findByRole("dialog");
        expect(screen.queryByText("Sources")).toBeNull();
    });

    it("wraps long titles with a heading action in a phone-width column", async () => {
        const heading = makeHeading("A long section heading ".repeat(8));
        heading.style.width = "320px";
        const vm = new TestViewModel({
            sections: [{ label: heading.textContent!, level: 2, heading }],
            sources: [{ label: "https://example.org/" + "long-path".repeat(30), host: "example.org" }],
        });
        render(<AnswerNavigationView vm={vm} />);
        await userEvent.click(screen.getByRole("button", { name: "Sections" }));
        expect(heading.scrollWidth).toBeLessThanOrEqual(320);
        const dialog = screen.getByRole("dialog");
        expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
    });

    it("removes heading controls and the open dialog when an edit removes eligibility", async () => {
        const heading = makeHeading("Details");
        const vm = new TestViewModel({ sections: [{ label: "Details", level: 2, heading }], isIndexOpen: true });
        render(<AnswerNavigationView vm={vm} />);
        await screen.findByRole("dialog");
        vm.clear();
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        expect(heading.querySelector("button")).toBeNull();
    });

    it("renders nothing when there is no useful outline", () => {
        const vm = new TestViewModel();
        const { container } = render(<AnswerNavigationView vm={vm} />);
        expect(container).toBeEmptyDOMElement();
    });
});

/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import "@vector-im/compound-design-tokens/assets/web/css/compound-design-tokens.css";
import "@vector-im/compound-web/dist/style.css";
import React from "react";
import { fireEvent, render, screen, within } from "@test-utils";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { MockViewModel } from "../../../../../core/viewmodel/MockViewModel";
import { InteractiveUiView } from "./InteractiveUiView";
import type { InteractiveUiRenderNode, InteractiveUiViewActions, InteractiveUiViewSnapshot } from "./types";
import { catalog } from "./InteractiveUiView.stories";

function setup(root: InteractiveUiRenderNode = catalog, snapshot: Partial<InteractiveUiViewSnapshot> = {}) {
    const actions: InteractiveUiViewActions = {
        setValue: vi.fn(),
        activate: vi.fn(),
        submitForm: vi.fn(),
        selectGraphNode: vi.fn(),
        setGraphListMode: vi.fn(),
        setChartDataMode: vi.fn(),
        sortTable: vi.fn(),
        setShowAsText: vi.fn(),
        setCarouselIndex: vi.fn(),
        activateCarouselItem: vi.fn(),
        openLink: vi.fn(),
        retryAfterOverdue: vi.fn(),
    };
    const vm = Object.assign(
        new MockViewModel<InteractiveUiViewSnapshot>({
            status: "active",
            root,
            showAsText: false,
            confirmationOverdue: false,
            ...snapshot,
        }),
        actions,
    );
    return { ...render(<InteractiveUiView vm={vm} fallback={<p>Complete fallback</p>} />), actions, vm };
}

function node(id: string): InteractiveUiRenderNode {
    if (catalog.kind !== "stack") throw new Error("Expected catalog stack");
    const found = catalog.children.find((item) => item.id === id);
    if (!found) throw new Error(`Missing catalog node ${id}`);
    return found;
}

const input: Extract<InteractiveUiRenderNode, { kind: "text_input" }> = {
    kind: "text_input",
    id: "input",
    label: "Your note",
    value: "",
    multiline: false,
    maxLength: 12,
    required: true,
    invalid: true,
    disabled: false,
};
const number: Extract<InteractiveUiRenderNode, { kind: "number_input" }> = {
    kind: "number_input",
    id: "number",
    label: "Amount",
    value: null,
    min: 1,
    max: 10,
    step: 1,
    display: "field",
    invalid: true,
    disabled: false,
};
const button: Extract<InteractiveUiRenderNode, { kind: "button" }> = {
    kind: "button",
    id: "action",
    label: "Act",
    variant: "primary",
    disabled: false,
    pending: false,
    external: false,
};

describe("InteractiveUiView", () => {
    it.each(["light", "dark"])("keeps muted and validation text readable on %s surfaces", (theme) => {
        const { container } = setup(
            {
                kind: "stack",
                id: "contrast",
                direction: "vertical",
                gap: "md",
                children: [
                    node("text"),
                    input,
                    { kind: "card", id: "card", title: "Contrast card", children: [node("unknown")] },
                    node("products"),
                ],
            },
            { status: "awaiting_confirmation" },
        );
        container.classList.add(`cpd-theme-${theme}`);
        const canvas = document.createElement("div");
        canvas.style.backgroundColor = "var(--cpd-color-bg-canvas-default)";
        container.append(canvas);
        const canvasColor = getComputedStyle(canvas).backgroundColor;
        const luminance = (color: string): number => {
            const [red, green, blue] = color.match(/\d+/g)!.map((value) => {
                const channel = Number(value) / 255;
                return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
        };
        const samples = [
            [screen.getByRole("region", { name: "Interactive content" }), screen.getByText(/Choose a branch/)],
            [screen.getByRole("region", { name: "Interactive content" }), screen.getByText("Check this value.")],
            [screen.getByRole("region", { name: "Contrast card" }), screen.getByText(/More content is available/)],
            [screen.getByRole("article", { name: "Brown sugar" }), screen.getByText("For rich flavour")],
            [screen.getByRole("status"), screen.getByRole("status").querySelector("p")!],
        ];
        for (const [surface, text] of samples) {
            const background = getComputedStyle(surface).backgroundColor;
            expect(background).toBe(canvasColor);
            const foregroundLuminance = luminance(getComputedStyle(text).color);
            const backgroundLuminance = luminance(background);
            const contrast =
                (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
                (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
            expect(contrast).toBeGreaterThanOrEqual(4.5);
        }
    });

    it.each(["chart", "graph", "table", "products"])("keeps repeated %s data areas out of page landmarks", (kind) => {
        const child =
            kind === "graph"
                ? (node("card") as Extract<InteractiveUiRenderNode, { kind: "card" }>).children[1]
                : node(kind);
        setup({
            kind: "stack",
            id: "repeated",
            direction: "vertical",
            gap: "md",
            children: [child, { ...child, id: `${child.id}-copy` }],
        });
        expect(screen.getAllByRole("region")).toEqual([screen.getByRole("region", { name: "Interactive content" })]);
        const scrollers = screen.getAllByRole("group").filter((element) => element.tabIndex === 0);
        expect(scrollers).toHaveLength(2);
        for (const scroller of scrollers) {
            expect(scroller).toHaveAccessibleName();
            scroller.focus();
            expect(scroller).toHaveFocus();
        }
    });

    it.each(["chart", "graph", "table"])("keeps %s local controls from submitting forms", async (kind) => {
        const child =
            kind === "graph"
                ? (node("card") as Extract<InteractiveUiRenderNode, { kind: "card" }>).children[1]
                : node(kind);
        const { actions } = setup({
            kind: "form",
            id: "outer",
            submitLabel: "Submit",
            disabled: false,
            pending: false,
            children: [child],
        });
        const name = kind === "chart" ? "Data table" : kind === "graph" ? "Relationships as list" : "Name";
        expect(screen.getByRole("button", { name })).toHaveAttribute("type", "button");
        await userEvent.click(screen.getByRole("button", { name }));
        expect(actions.submitForm).not.toHaveBeenCalled();
        expect(
            kind === "chart"
                ? actions.setChartDataMode
                : kind === "graph"
                  ? actions.setGraphListMode
                  : actions.sortTable,
        ).toHaveBeenCalledOnce();
    });

    it("supports nested form actions, Enter, multiline input and descendant submit isolation", async () => {
        const { actions, container } = setup({
            kind: "form",
            id: "outer",
            submitLabel: "Outer",
            disabled: false,
            pending: false,
            children: [
                {
                    kind: "form",
                    id: "inner",
                    submitLabel: "Inner",
                    disabled: false,
                    pending: false,
                    children: [input, { ...input, id: "multi", label: "Multiline", multiline: true }],
                },
            ],
        });
        expect(container.querySelector("form form")).toBeNull();
        await userEvent.click(screen.getByRole("button", { name: "Inner" }));
        expect(actions.submitForm).toHaveBeenCalledExactlyOnceWith("inner");
        vi.mocked(actions.submitForm).mockClear();
        await userEvent.click(screen.getByRole("textbox", { name: "Your note" }));
        await userEvent.keyboard("{Enter}");
        expect(actions.submitForm).toHaveBeenCalledExactlyOnceWith("inner");
        vi.mocked(actions.submitForm).mockClear();
        await userEvent.click(screen.getByRole("textbox", { name: "Multiline" }));
        await userEvent.keyboard("{Enter}");
        expect(actions.submitForm).not.toHaveBeenCalled();
        fireEvent.submit(screen.getByRole("form", { name: "Inner" }));
        expect(actions.submitForm).toHaveBeenCalledExactlyOnceWith("inner");
    });

    it("lets composing Enter confirm an IME candidate before ordinary Enter submits only the nearest form", async () => {
        const { actions } = setup({
            kind: "form",
            id: "outer",
            submitLabel: "Outer",
            disabled: false,
            pending: false,
            children: [
                { kind: "form", id: "inner", submitLabel: "Inner", disabled: false, pending: false, children: [input] },
            ],
        });
        const field = screen.getByRole("textbox", { name: "Your note" });
        const composingEnter = new KeyboardEvent("keydown", {
            key: "Enter",
            isComposing: true,
            bubbles: true,
            cancelable: true,
        });
        fireEvent(field, composingEnter);
        expect(composingEnter.defaultPrevented).toBe(false);
        for (const action of Object.values(actions)) expect(action).not.toHaveBeenCalled();
        field.focus();
        await userEvent.keyboard("{Enter}");
        expect(actions.submitForm).toHaveBeenCalledExactlyOnceWith("inner");
    });

    it.each(["sending", "awaiting_confirmation", "submitted", "expired", "superseded", "disabled", "pending"])(
        "blocks all custom interactions in %s context",
        async (state) => {
            const form: InteractiveUiRenderNode = {
                kind: "form",
                id: "guarded",
                submitLabel: "Send",
                disabled: state === "disabled",
                pending: state === "pending",
                children: [catalog],
            };
            const { actions } = setup(form, {
                status:
                    state === "disabled" || state === "pending"
                        ? "active"
                        : (state as InteractiveUiViewSnapshot["status"]),
            });
            for (const name of ["Data table", "Name", "Relationships as list", "Next item", "Previous item"])
                expect(screen.getByRole("button", { name })).toBeDisabled();
            fireEvent.click(screen.getByRole("button", { name: "Data table" }));
            fireEvent.click(screen.getByRole("button", { name: "Name" }));
            fireEvent.keyDown(screen.getAllByRole("group", { name: "Graph" })[0], { key: "Escape" });
            const track = screen.getAllByRole("group", { name: "Suggested ingredients" })[1];
            expect(track).toHaveAttribute("aria-disabled", "true");
            fireEvent.keyDown(track, { key: "ArrowRight" });
            track.scrollLeft = (track.children[1] as HTMLElement).offsetLeft;
            fireEvent.scroll(track);
            fireEvent.change(screen.getByRole("textbox", { name: "Notes" }), { target: { value: "changed" } });
            for (const action of [
                actions.setChartDataMode,
                actions.sortTable,
                actions.selectGraphNode,
                actions.setGraphListMode,
                actions.setCarouselIndex,
                actions.setValue,
                actions.submitForm,
            ])
                expect(action).not.toHaveBeenCalled();
            expect(screen.getByRole("button", { name: "Show as text" })).toBeEnabled();
        },
    );

    it("keeps only the selected tab in the actual Tab sequence", async () => {
        setup(node("tabs"));
        const selected = screen.getByRole("tab", { name: "Overview" });
        const other = screen.getByRole("tab", { name: "Details" });
        expect(selected.tabIndex).toBe(0);
        expect(other.tabIndex).toBe(-1);
        screen.getByRole("button", { name: "Show as text" }).focus();
        await userEvent.tab();
        expect(selected).toHaveFocus();
        await userEvent.tab();
        expect(other).not.toHaveFocus();
    });

    it("contains sanitized wide images and tables within a bordered 360px root", async () => {
        const src =
            "data:image/svg+xml," +
            encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"></svg>');
        const { container } = setup({
            kind: "stack",
            id: "root",
            direction: "vertical",
            gap: "md",
            children: [
                {
                    kind: "rich_text",
                    id: "wide",
                    text: "Image and table",
                    safeHtml: `<img src="${src}" alt="Wide" width="800" height="400" style="max-width:800px;width:800px;height:400px"><table><tbody><tr><td style="min-width:1000px">Wide table</td></tr></tbody></table>`,
                },
            ],
        });
        container.style.width = "360px";
        const root = screen.getByRole("region", { name: "Interactive content" });
        const style = getComputedStyle(root);
        expect(parseFloat(style.borderTopWidth)).toBeGreaterThan(0);
        expect(parseFloat(style.paddingTop)).toBeGreaterThan(0);
        expect(parseFloat(style.borderTopLeftRadius)).toBeGreaterThan(0);
        const image = screen.getByRole("img", { name: "Wide" });
        await vi.waitFor(() => expect(image.getBoundingClientRect().height).toBeGreaterThan(0));
        expect(image.getBoundingClientRect().width).toBeLessThan(360);
        expect(image.getBoundingClientRect().width / image.getBoundingClientRect().height).toBeCloseTo(2);
        const table = screen.getByRole("table");
        expect(table.scrollWidth).toBeGreaterThan(table.clientWidth);
        expect(getComputedStyle(table).overflowX).toBe("auto");
        expect(container.scrollWidth).toBeLessThanOrEqual(360);
    });

    it("renders sanitized disclosures as static visible content in inactive cards", () => {
        const { container } = setup(
            {
                kind: "rich_text",
                id: "disclosure",
                text: "Text",
                safeHtml: "<details><summary><strong>Summary</strong></summary><p>Full details</p></details>",
            },
            { status: "submitted" },
        );
        expect(screen.getByText("Summary")).toBeVisible();
        expect(screen.getByText("Full details")).toBeVisible();
        expect(container.querySelector("details, summary")).toBeNull();
    });

    it("renders the content catalog, resolved images and named controls", () => {
        const { container } = setup();
        expect(screen.getByRole("heading", { name: "Explore ingredients" })).toBeVisible();
        expect(screen.getByText("explore").tagName).toBe("STRONG");
        expect(screen.getByText("Available")).toHaveAttribute("data-tone", "success");
        expect(screen.getByText("Region").tagName).toBe("DT");
        expect(screen.getByText("Worldwide").tagName).toBe("DD");
        expect(screen.getByText("Find a topic")).toBeVisible();
        expect(screen.getByRole("img", { name: "Green ingredient illustration" })).toHaveAttribute(
            "src",
            expect.stringContaining("data:image/svg+xml"),
        );
        expect(screen.getByRole("separator")).toBeVisible();
        expect(screen.getByRole("combobox", { name: "Knowledge branch" })).toBeEnabled();
        expect(screen.getByRole("group", { name: "Interests" })).toBeVisible();
        expect(screen.getByRole("switch", { name: "Include examples" })).toBeChecked();
        expect(screen.getByRole("textbox", { name: "Notes" })).toHaveAttribute("required");
        expect(screen.getByRole("slider", { name: "Quantity" })).toHaveValue("2");
        expect(screen.getByRole("button", { name: "Read article (External link)" })).toBeVisible();
        expect(screen.getByText("More content is available in text mode.")).toBeVisible();
        expect(container.querySelector("ol")).toBeInTheDocument();
        expect(container.querySelector("a[href]")).toBeNull();
    });

    it("renders text sizes, heading levels, unordered lists, missing images and unknown defaults", () => {
        setup({
            kind: "stack",
            id: "content",
            direction: "vertical",
            gap: "none",
            children: [
                { kind: "heading", id: "h1", text: "First heading", level: 1 },
                { kind: "heading", id: "h2", text: "Second heading", level: 2 },
                { kind: "text", id: "text", text: "Two\nlines", tone: "emphasis", size: "body" },
                { kind: "rich_text", id: "plain", text: "<strong>plain</strong>" },
                { kind: "image", id: "missing", alt: "Unavailable illustration" },
                { kind: "list", id: "unordered", ordered: false, items: [{ text: "Unordered item" }] },
                { kind: "unknown", id: "unsupported" },
            ],
        });
        expect(screen.getByRole("heading", { name: "First heading", level: 1 })).toBeVisible();
        expect(screen.getByRole("heading", { name: "Second heading", level: 2 })).toBeVisible();
        expect(screen.getByText("Two lines")).toHaveAttribute("data-tone", "emphasis");
        expect(screen.getByText("<strong>plain</strong>").querySelector("strong")).toBeNull();
        expect(screen.getByText("Unavailable illustration")).toBeVisible();
        expect(screen.getByRole("list").tagName).toBe("UL");
        expect(screen.getByText("This content cannot be displayed.")).toBeVisible();
    });

    it("preserves VM-sanitized rich formatting while making nested anchors presentation only", () => {
        const { container } = setup({
            kind: "rich_text",
            id: "rich",
            text: "Fallback",
            safeHtml:
                '<p>Read <a href="https://example.org" target="_blank"><strong>this <em>source</em></strong></a>.</p><blockquote>Quoted</blockquote><code>&lt;script&gt;</code>',
        });
        expect(container.querySelector("strong em")).toHaveTextContent("source");
        expect(container.querySelector("blockquote")).toHaveTextContent("Quoted");
        expect(container.querySelector("code")).toHaveTextContent("<script>");
        expect(container.querySelector("[href]")).toBeNull();
        expect(screen.queryByRole("link")).not.toBeInTheDocument();
        expect(screen.queryByText("Fallback")).not.toBeInTheDocument();
    });

    it("routes explicit source and external links and buttons without native navigation", async () => {
        const user = userEvent.setup();
        const { actions, container } = setup({
            kind: "stack",
            id: "links",
            direction: "horizontal",
            gap: "sm",
            children: [
                node("link"),
                { kind: "link", id: "external", label: "Read more", host: "example.net", sourceKind: "external" },
                button,
            ],
        });
        await user.click(screen.getByRole("button", { name: "Food science · example.org (Source)" }));
        expect(actions.openLink).toHaveBeenLastCalledWith("link");
        await user.click(screen.getByRole("button", { name: "Read more · example.net (External link)" }));
        expect(actions.openLink).toHaveBeenLastCalledWith("external");
        await user.click(screen.getByRole("button", { name: "Act" }));
        expect(actions.activate).toHaveBeenCalledWith("action");
        expect(container.querySelector("[href]")).toBeNull();
    });

    it("routes selected options, radio choices, multi choices and toggle values", async () => {
        const user = userEvent.setup();
        const { actions } = setup({
            kind: "stack",
            id: "controls",
            direction: "vertical",
            gap: "sm",
            children: [
                {
                    kind: "select",
                    id: "select",
                    label: "Branch",
                    value: null,
                    multiple: false,
                    disabled: false,
                    options: [{ value: "a", label: "Branch A" }],
                },
                {
                    kind: "select",
                    id: "multi",
                    label: "Branches",
                    value: [],
                    multiple: true,
                    disabled: false,
                    options: [
                        { value: "a", label: "Branch A" },
                        { value: "b", label: "Branch B" },
                    ],
                },
                {
                    kind: "choice",
                    id: "radio",
                    label: "One choice",
                    value: "a",
                    multiple: false,
                    disabled: false,
                    options: [
                        { value: "a", label: "First" },
                        { value: "b", label: "Second" },
                    ],
                },
                {
                    kind: "choice",
                    id: "choices",
                    label: "Many choices",
                    value: ["a"],
                    multiple: true,
                    disabled: false,
                    options: [
                        { value: "a", label: "First check" },
                        { value: "b", label: "Second check" },
                    ],
                },
                { kind: "toggle", id: "toggle", label: "Enabled", value: false, disabled: false },
            ],
        });
        await user.selectOptions(screen.getByRole("combobox", { name: "Branch" }), "a");
        expect(actions.setValue).toHaveBeenLastCalledWith("select", "a");
        await user.selectOptions(screen.getByRole("listbox", { name: "Branches" }), "b");
        expect(actions.setValue).toHaveBeenLastCalledWith("multi", ["b"]);
        await user.click(screen.getByRole("radio", { name: "Second" }));
        expect(actions.setValue).toHaveBeenLastCalledWith("radio", "b");
        await user.click(screen.getByRole("checkbox", { name: "Second check" }));
        expect(actions.setValue).toHaveBeenLastCalledWith("choices", ["a", "b"]);
        await user.click(screen.getByRole("checkbox", { name: "First check" }));
        expect(actions.setValue).toHaveBeenLastCalledWith("choices", []);
        await user.click(screen.getByRole("switch", { name: "Enabled" }));
        expect(actions.setValue).toHaveBeenLastCalledWith("toggle", true);
    });

    it("renders validation indicators and delegates string, multiline and numeric edits", async () => {
        const user = userEvent.setup();
        const { actions } = setup({
            kind: "stack",
            id: "inputs",
            direction: "vertical",
            gap: "sm",
            children: [
                input,
                { ...input, id: "long", label: "Long note", multiline: true, invalid: false },
                number,
                { ...number, id: "range", label: "Range", value: 3, display: "slider", invalid: false },
            ],
        });
        const field = screen.getByRole("textbox", { name: "Your note" });
        expect(field).toHaveAttribute("aria-invalid", "true");
        expect(field).toHaveAccessibleDescription("Check this value.");
        expect(field).toHaveAttribute("maxlength", "12");
        await user.type(field, "a");
        expect(actions.setValue).toHaveBeenLastCalledWith("input", "a");
        expect(screen.getByRole("textbox", { name: "Long note" }).tagName).toBe("TEXTAREA");
        await user.type(screen.getByRole("textbox", { name: "Long note" }), "b");
        expect(actions.setValue).toHaveBeenLastCalledWith("long", "b");
        await user.type(screen.getByRole("spinbutton", { name: "Amount" }), "4");
        expect(actions.setValue).toHaveBeenLastCalledWith("number", 4);
        expect(screen.getByRole("spinbutton", { name: "Amount" })).toHaveAccessibleDescription("Check this value.");
        expect(screen.getByRole("slider", { name: "Range" })).toHaveAttribute("min", "1");
    });

    it("passes null when a numeric field is cleared", async () => {
        const user = userEvent.setup();
        const { actions } = setup({ ...number, value: 4 });
        await user.clear(screen.getByRole("spinbutton", { name: "Amount" }));
        expect(actions.setValue).toHaveBeenLastCalledWith("number", null);
    });

    it("submits the originating form and leaves validation to the view model", async () => {
        const user = userEvent.setup();
        const { actions } = setup({
            kind: "form",
            id: "form",
            submitLabel: "Submit note",
            disabled: false,
            pending: false,
            children: [input],
        });
        await user.click(screen.getByRole("button", { name: "Submit note" }));
        expect(actions.submitForm).toHaveBeenCalledExactlyOnceWith("form");
        expect(actions.activate).not.toHaveBeenCalled();
    });

    it.each(["disabled", "pending"] as const)("disables %s buttons and forms", async (state) => {
        const user = userEvent.setup();
        const { actions } = setup({
            kind: "stack",
            id: "disabled",
            direction: "vertical",
            gap: "md",
            children: [
                { ...button, [state]: true },
                {
                    kind: "form",
                    id: "form",
                    submitLabel: "Submit",
                    disabled: state === "disabled",
                    pending: state === "pending",
                    children: [input],
                },
            ],
        });
        expect(screen.getByRole("textbox", { name: "Your note" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "Act" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "Submit" })).toBeDisabled();
        await user.click(screen.getByRole("button", { name: "Act" }));
        await user.click(screen.getByRole("button", { name: "Submit" }));
        expect(actions.activate).not.toHaveBeenCalled();
        expect(actions.submitForm).not.toHaveBeenCalled();
    });

    it.each(["sending", "awaiting_confirmation", "submitted", "expired", "superseded"] as const)(
        "disables interactions when %s and renders status",
        async (status) => {
            const { actions } = setup(catalog, { status });
            expect(screen.getByRole("status")).toBeVisible();
            expect(screen.getByRole("button", { name: "Explain this mechanism" })).toBeDisabled();
            expect(screen.getByRole("combobox", { name: "Knowledge branch" })).toBeDisabled();
            expect(screen.getByRole("tab", { name: "Overview" })).toBeDisabled();
            expect(screen.getByRole("button", { name: "More information" })).toBeDisabled();
            expect(screen.getByRole("button", { name: "Choose brown sugar" })).toBeDisabled();
            expect(screen.getByRole("button", { name: "Food science · example.org (Source)" })).toBeDisabled();
            await userEvent.click(screen.getByRole("button", { name: "Sugar" }));
            expect(actions.selectGraphNode).not.toHaveBeenCalled();
        },
    );

    it("shows supplied status text and overdue retry without activating an action", async () => {
        const user = userEvent.setup();
        const { actions } = setup(button, {
            status: "awaiting_confirmation",
            statusText: "Waiting for the sender",
            confirmationOverdue: true,
        });
        expect(within(screen.getByRole("status")).getByText("Waiting for the sender")).toBeVisible();
        expect(
            within(screen.getByRole("status")).getByText("No confirmation received yet. You can try again."),
        ).toBeVisible();
        await user.click(screen.getByRole("button", { name: "Try again" }));
        expect(actions.retryAfterOverdue).toHaveBeenCalledOnce();
        expect(actions.activate).not.toHaveBeenCalled();
    });

    it("swaps in fallback and delegates both text mode requests", async () => {
        const user = userEvent.setup();
        const { actions, unmount } = setup(button);
        await user.click(screen.getByRole("button", { name: "Show as text" }));
        expect(actions.setShowAsText).toHaveBeenCalledWith(true);
        unmount();
        const text = setup(button, { showAsText: true });
        expect(screen.getByText("Complete fallback")).toBeVisible();
        expect(screen.queryByRole("button", { name: "Act" })).not.toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Show as text" }));
        expect(text.actions.setShowAsText).toHaveBeenCalledWith(false);
    });

    it("renders selected tabs only and routes click and arrow keyboard navigation", async () => {
        const user = userEvent.setup();
        const { actions } = setup(node("tabs"));
        expect(screen.getByRole("tabpanel")).toHaveAccessibleName("Overview");
        expect(screen.queryByText("A closer look")).not.toBeInTheDocument();
        await user.click(screen.getByRole("tab", { name: "Details" }));
        expect(actions.setValue).toHaveBeenLastCalledWith("tabs", "detail");
        screen.getByRole("tab", { name: "Overview" }).focus();
        await user.keyboard("{ArrowRight}");
        expect(actions.setValue).toHaveBeenLastCalledWith("tabs", "detail");
        expect(screen.getByRole("tab", { name: "Details" })).toHaveFocus();
    });

    it.each([true, false])("renders controlled collapsible open=%s", async (open) => {
        const user = userEvent.setup();
        const collapsible = node("more");
        if (collapsible.kind !== "collapsible") throw new Error("Expected collapsible");
        const { actions } = setup({ ...collapsible, open });
        expect(screen.getByRole("button", { name: "More information" })).toHaveAttribute("aria-expanded", String(open));
        expect(screen.queryByText("Browse each relationship.") !== null).toBe(open);
        await user.click(screen.getByRole("button", { name: "More information" }));
        expect(actions.setValue).toHaveBeenCalledWith("more", !open);
    });

    it("composes T2 graph, chart and table callbacks with exact parent IDs", async () => {
        const user = userEvent.setup();
        const { actions } = setup();
        await user.click(screen.getByRole("button", { name: "Sugar" }));
        expect(actions.selectGraphNode).toHaveBeenCalledWith("graph", "sugar");
        await user.keyboard("{Escape}");
        expect(actions.selectGraphNode).toHaveBeenCalledWith("graph", null);
        await user.click(screen.getByRole("button", { name: "Relationships as list" }));
        expect(actions.setGraphListMode).toHaveBeenCalledWith("graph", true);
        await user.click(screen.getByRole("button", { name: "Data table" }));
        expect(actions.setChartDataMode).toHaveBeenCalledWith("chart", true);
        await user.click(screen.getByRole("button", { name: "Name" }));
        expect(actions.sortTable).toHaveBeenCalledWith("table", "name");
    });

    it("routes carousel buttons, arrow keys and exact item activation", async () => {
        const user = userEvent.setup();
        const { actions } = setup(node("products"));
        const carousel = screen.getAllByRole("group", { name: "Suggested ingredients" })[0];
        expect(within(carousel).getByText("Item 1 of 3")).toHaveAttribute("aria-live", "polite");
        expect(screen.getByRole("button", { name: "Previous item" })).toBeDisabled();
        await user.click(screen.getByRole("button", { name: "Next item" }));
        expect(actions.setCarouselIndex).toHaveBeenLastCalledWith("products", 1);
        screen.getAllByRole("group", { name: "Suggested ingredients" })[1].focus();
        await user.keyboard("{ArrowRight}");
        expect(actions.setCarouselIndex).toHaveBeenLastCalledWith("products", 1);
        await user.click(screen.getByRole("button", { name: "Choose white sugar" }));
        expect(actions.activateCarouselItem).toHaveBeenCalledExactlyOnceWith("products", "two");
    });

    it("routes scroll/swipe position changes and respects last-item bounds", async () => {
        const carousel = node("products");
        if (carousel.kind !== "carousel") throw new Error("Expected carousel");
        const { actions, unmount } = setup(carousel);
        const track = screen.getAllByRole("group", { name: "Suggested ingredients" })[1];
        track.scrollLeft = (track.children[1] as HTMLElement).offsetLeft;
        fireEvent.scroll(track);
        expect(actions.setCarouselIndex).toHaveBeenLastCalledWith("products", 1);
        unmount();
        const last = setup({ ...carousel, index: 2 });
        expect(screen.getByText("Item 3 of 3")).toBeVisible();
        expect(screen.getByRole("button", { name: "Next item" })).toBeDisabled();
        screen.getAllByRole("group", { name: "Suggested ingredients" })[1].focus();
        await userEvent.keyboard("{ArrowRight}");
        expect(last.actions.setCarouselIndex).not.toHaveBeenCalled();
        await userEvent.keyboard("{ArrowLeft}");
        expect(last.actions.setCarouselIndex).toHaveBeenLastCalledWith("products", 1);
        await userEvent.click(screen.getByRole("button", { name: "Previous item" }));
        expect(last.actions.setCarouselIndex).toHaveBeenLastCalledWith("products", 1);
    });

    it("preserves the selected carousel item across resize before accepting user navigation", async () => {
        const carousel = node("products");
        if (carousel.kind !== "carousel") throw new Error("Expected carousel");
        const selected = {
            ...carousel,
            index: 2,
            items: Array.from({ length: 5 }, (_, index) => ({ ...carousel.items[0], id: `item-${index}` })),
        };
        const viewport = { width: innerWidth, height: innerHeight };
        await page.viewport(1280, 1000);
        const { actions, container, rerender, vm } = setup(selected);
        container.style.width = "min(626px, calc(100vw - 118px))";
        vi.mocked(actions.setCarouselIndex).mockImplementation((_id, index) => {
            const updated = Object.assign(
                new MockViewModel({ ...vm.getSnapshot(), root: { ...selected, index } }),
                actions,
            );
            rerender(<InteractiveUiView vm={updated} fallback={<p>Complete fallback</p>} />);
        });
        const track = screen.getAllByRole("group", { name: "Suggested ingredients" })[1];
        const third = track.children[2] as HTMLElement;
        try {
            await vi.waitFor(() => expect(track.scrollLeft).toBe(third.offsetLeft));
            track.focus();
            // The responsive app shell briefly collapses the timeline before laying it out at its new width.
            container.style.width = "0px";
            await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
            expect(track.clientWidth).toBe(0);
            container.style.width = "min(626px, calc(100vw - 118px))";
            await page.viewport(360, 1000);
            await vi.waitFor(() => expect(container.clientWidth).toBe(242));
            // Wait through browser scroll and ResizeObserver delivery after layout has changed.
            await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
            expect(screen.getByText("Item 3 of 5")).toBeVisible();
            expect(track.scrollLeft).toBe(third.offsetLeft);
            expect(actions.setCarouselIndex).not.toHaveBeenCalled();
            track.focus();
            await userEvent.keyboard("{ArrowRight}");
            await vi.waitFor(() => expect(screen.getByText("Item 4 of 5")).toBeVisible());
            expect(actions.setCarouselIndex).toHaveBeenCalledExactlyOnceWith("products", 3);
        } finally {
            await page.viewport(viewport.width, viewport.height);
        }
    });

    it("keeps inactive carousel selection on resize and disconnects its observer on unmount", async () => {
        const carousel = node("products");
        if (carousel.kind !== "carousel") throw new Error("Expected carousel");
        const observe = vi.spyOn(ResizeObserver.prototype, "observe");
        const disconnect = vi.spyOn(ResizeObserver.prototype, "disconnect");
        try {
            const { actions, container, unmount } = setup({ ...carousel, index: 1 }, { status: "submitted" });
            const track = screen.getAllByRole("group", { name: "Suggested ingredients" })[1];
            const observer = observe.mock.contexts[observe.mock.calls.findIndex(([element]) => element === track)];
            expect(observer).toBeDefined();
            container.style.width = "242px";
            await vi.waitFor(() => expect(track.scrollLeft).toBe((track.children[1] as HTMLElement).offsetLeft));
            track.scrollLeft = (track.children[2] as HTMLElement).offsetLeft;
            fireEvent.scroll(track);
            expect(actions.setCarouselIndex).not.toHaveBeenCalled();
            unmount();
            expect(disconnect.mock.contexts).toContain(observer);
        } finally {
            observe.mockRestore();
            disconnect.mockRestore();
        }
    });

    it("honors disabled flags on individual controls and carousel actions", async () => {
        const carousel = node("products");
        if (carousel.kind !== "carousel") throw new Error("Expected carousel");
        const { actions } = setup({
            kind: "stack",
            id: "flags",
            direction: "vertical",
            gap: "sm",
            children: [
                { ...input, disabled: true },
                { ...number, disabled: true },
                {
                    kind: "select",
                    id: "select",
                    label: "Disabled select",
                    value: "a",
                    multiple: false,
                    disabled: true,
                    options: [{ value: "a", label: "A" }],
                },
                {
                    kind: "choice",
                    id: "choice",
                    label: "Disabled choices",
                    value: "a",
                    multiple: false,
                    disabled: true,
                    options: [{ value: "a", label: "Disabled radio" }],
                },
                { kind: "toggle", id: "toggle", label: "Disabled toggle", value: false, disabled: true },
                { ...carousel, items: [{ ...carousel.items[0], disabled: true }] },
            ],
        });
        for (const control of [
            screen.getByRole("textbox"),
            screen.getByRole("spinbutton"),
            screen.getByRole("combobox"),
            screen.getByRole("radio"),
            screen.getByRole("switch"),
            screen.getByRole("button", { name: "Choose brown sugar" }),
        ])
            expect(control).toBeDisabled();
        await userEvent.click(screen.getByRole("button", { name: "Choose brown sugar" }));
        expect(actions.activateCarouselItem).not.toHaveBeenCalled();
        expect(actions.setValue).not.toHaveBeenCalled();
    });

    it("renders a single carousel item without navigation buttons", () => {
        const carousel = node("products");
        if (carousel.kind !== "carousel") throw new Error("Expected carousel");
        setup({ ...carousel, items: [carousel.items[0]] });
        expect(screen.getByText("Item 1 of 1")).toBeVisible();
        expect(screen.queryByRole("button", { name: "Next item" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Previous item" })).not.toBeInTheDocument();
    });

    it("wraps horizontal stacks and confines carousel scrolling at 360px", () => {
        const { container } = setup();
        container.style.width = "360px";
        const action = screen.getByRole("button", { name: "Explain this mechanism" });
        expect(getComputedStyle(action.parentElement!).flexWrap).toBe("wrap");
        const track = screen.getAllByRole("group", { name: "Suggested ingredients" })[1];
        expect(getComputedStyle(track).overflowX).toBe("auto");
        expect(track.scrollWidth).toBeGreaterThan(track.clientWidth);
        expect(container.scrollWidth).toBeLessThanOrEqual(360);
    });
});

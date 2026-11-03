/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React, { type JSX, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { useMockedViewModel } from "../../../../../core/viewmodel";
import { InteractiveUiView } from "./InteractiveUiView";
import type { InteractiveUiRenderNode, InteractiveUiViewActions, InteractiveUiViewSnapshot } from "./types";
import { layoutLayeredGraph } from "./graph/GraphLayout";

const image =
    "data:image/svg+xml," +
    encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="100"><rect width="240" height="100" fill="#b4ddae"/><circle cx="120" cy="50" r="30" fill="#426c3b"/></svg>',
    );

/** Representative content and controls, also available as a narrow catalog. */
export const catalog: InteractiveUiRenderNode = {
    kind: "stack",
    id: "catalog",
    direction: "vertical",
    gap: "md",
    children: [
        { kind: "heading", id: "heading", text: "Explore ingredients", level: 3 },
        {
            kind: "rich_text",
            id: "intro",
            text: "Knowledge you can explore",
            safeHtml: "<p>Knowledge you can <strong>explore</strong>.</p>",
        },
        {
            kind: "text",
            id: "text",
            text: "Choose a branch to learn more.\nYour choices stay in this view.",
            tone: "muted",
            size: "caption",
        },
        { kind: "badge", id: "badge", text: "Available", tone: "success" },
        { kind: "key_value", id: "facts", items: [{ label: "Region", value: "Worldwide" }] },
        {
            kind: "list",
            id: "list",
            ordered: true,
            items: [{ text: "Choose", secondary: "Find a topic" }, { text: "Explore" }],
        },
        { kind: "image", id: "image", alt: "Green ingredient illustration", src: image, width: 240, height: 100 },
        {
            kind: "tabs",
            id: "tabs",
            selected: "overview",
            tabs: [
                {
                    value: "overview",
                    label: "Overview",
                    content: {
                        kind: "text",
                        id: "overview",
                        text: "How heat creates flavour",
                        tone: "default",
                        size: "body",
                    },
                },
                {
                    value: "detail",
                    label: "Details",
                    content: { kind: "text", id: "details", text: "A closer look", tone: "default", size: "body" },
                },
            ],
        },
        {
            kind: "collapsible",
            id: "more",
            label: "More information",
            open: true,
            children: [
                { kind: "text", id: "more-text", text: "Browse each relationship.", tone: "default", size: "body" },
            ],
        },
        {
            kind: "card",
            id: "card",
            title: "Knowledge map",
            children: [
                {
                    kind: "select",
                    id: "branch",
                    label: "Knowledge branch",
                    value: "cooking",
                    multiple: false,
                    disabled: false,
                    options: [
                        { value: "cooking", label: "Cooking" },
                        { value: "plants", label: "Plants" },
                    ],
                },
                {
                    kind: "graph",
                    id: "graph",
                    graph: layoutLayeredGraph({
                        layers: [{ label: "Ingredient" }, { label: "Result" }],
                        nodes: [
                            { id: "sugar", label: "Sugar", layer: 0 },
                            { id: "flavour", label: "Flavour", layer: 1 },
                        ],
                        edges: [{ from: "sugar", to: "flavour" }],
                    }),
                    selectedId: null,
                    showAsList: false,
                },
            ],
        },
        {
            kind: "table",
            id: "table",
            caption: "Ingredients",
            columns: [
                { key: "name", label: "Name" },
                { key: "amount", label: "Amount", kind: "number" },
            ],
            rows: [["Sugar", 2]],
            sortable: true,
        },
        {
            kind: "chart",
            id: "chart",
            chart: {
                kind: "bar",
                title: "Amounts",
                categories: ["Sugar", "Salt"],
                series: [{ name: "Grams", values: [2, 1] }],
            },
            showData: false,
        },
        {
            kind: "form",
            id: "form",
            submitLabel: "Send choices",
            disabled: false,
            pending: false,
            children: [
                {
                    kind: "choice",
                    id: "choice",
                    label: "Interests",
                    value: ["science"],
                    multiple: true,
                    disabled: false,
                    options: [
                        { value: "science", label: "Science" },
                        { value: "history", label: "History" },
                    ],
                },
                { kind: "toggle", id: "toggle", label: "Include examples", value: true, disabled: false },
                {
                    kind: "text_input",
                    id: "notes",
                    label: "Notes",
                    value: "",
                    multiline: true,
                    maxLength: 200,
                    required: true,
                    invalid: false,
                    disabled: false,
                },
                {
                    kind: "number_input",
                    id: "quantity",
                    label: "Quantity",
                    value: 2,
                    min: 0,
                    max: 10,
                    step: 1,
                    display: "slider",
                    invalid: false,
                    disabled: false,
                },
            ],
        },
        {
            kind: "stack",
            id: "actions",
            direction: "horizontal",
            gap: "sm",
            children: [
                {
                    kind: "button",
                    id: "explain",
                    label: "Explain this mechanism",
                    variant: "primary",
                    disabled: false,
                    pending: false,
                    external: false,
                },
                {
                    kind: "button",
                    id: "remove",
                    label: "Remove selection",
                    variant: "danger",
                    disabled: false,
                    pending: false,
                    external: false,
                },
                {
                    kind: "button",
                    id: "external",
                    label: "Read article",
                    variant: "secondary",
                    disabled: false,
                    pending: false,
                    external: true,
                },
            ],
        },
        { kind: "divider", id: "divider" },
        {
            kind: "carousel",
            id: "products",
            label: "Suggested ingredients",
            index: 0,
            items: [
                {
                    id: "one",
                    title: "Brown sugar",
                    subtitle: "For rich flavour",
                    src: image,
                    alt: "Sugar illustration",
                    meta: ["250 g", "Organic"],
                    badge: { text: "Popular", tone: "info" },
                    actionLabel: "Choose brown sugar",
                    disabled: false,
                },
                {
                    id: "two",
                    title: "White sugar",
                    src: image,
                    alt: "Sugar illustration",
                    meta: ["500 g"],
                    actionLabel: "Choose white sugar",
                    disabled: false,
                },
                { id: "three", title: "Unavailable ingredient", alt: "No image", meta: [], disabled: true },
            ],
        },
        { kind: "link", id: "link", label: "Food science", host: "example.org", sourceKind: "source" },
        { kind: "unknown", id: "unknown", fallback: "More content is available in text mode." },
    ],
};

function StoryView({ root, ...snapshot }: InteractiveUiViewSnapshot): JSX.Element {
    const [tree, setTree] = useState(root);
    const [showAsText, setShowAsText] = useState(snapshot.showAsText);
    const update = (id: string, changes: Record<string, unknown>): void => {
        const visit = (node: InteractiveUiRenderNode): InteractiveUiRenderNode => {
            if (node.id === id) return { ...node, ...changes } as InteractiveUiRenderNode;
            if ("children" in node) return { ...node, children: node.children.map(visit) };
            if (node.kind === "tabs")
                return { ...node, tabs: node.tabs.map((tab) => ({ ...tab, content: visit(tab.content) })) };
            return node;
        };
        setTree((current) => visit(current));
    };
    const actions: InteractiveUiViewActions = {
        setValue: (id, value) => {
            const find = (node: InteractiveUiRenderNode): InteractiveUiRenderNode | undefined =>
                node.id === id ? node : "children" in node ? node.children.map(find).find(Boolean) : undefined;
            const node = find(tree);
            update(
                id,
                node?.kind === "tabs"
                    ? { selected: value }
                    : node?.kind === "collapsible"
                      ? { open: value }
                      : { value },
            );
        },
        activate: fn(),
        submitForm: fn(),
        openLink: fn(),
        activateCarouselItem: fn(),
        retryAfterOverdue: fn(),
        setShowAsText,
        setCarouselIndex: (id, index) => update(id, { index }),
        selectGraphNode: (id, selectedId) => update(id, { selectedId }),
        setGraphListMode: (id, showAsList) => update(id, { showAsList }),
        setChartDataMode: (id, showData) => update(id, { showData }),
        sortTable: fn(),
    };
    const vm = useMockedViewModel({ ...snapshot, root: tree, showAsText }, actions);
    return (
        <InteractiveUiView
            vm={vm}
            fallback={<p>Ingredients: sugar and salt. Heat creates flavour. Read more at example.org.</p>}
        />
    );
}

const meta = {
    title: "Timeline/Interactive UI/Tree",
    component: StoryView,
    args: {
        title: "Interactive answer",
        root: catalog,
        status: "active",
        confirmationOverdue: false,
        showAsText: false,
    },
} satisfies Meta<typeof StoryView>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Light: Story = { globals: { theme: "light" } };
export const Dark: Story = { globals: { theme: "dark" } };
export const Mobile: Story = {
    decorators: [
        (Story) => (
            <div style={{ width: 360, maxWidth: "100%" }}>
                <Story />
            </div>
        ),
    ],
};
export const Sending: Story = { args: { status: "sending" } };
export const AwaitingConfirmation: Story = { args: { status: "awaiting_confirmation" } };
export const ConfirmationOverdue: Story = { args: { status: "awaiting_confirmation", confirmationOverdue: true } };
export const Submitted: Story = { args: { status: "submitted", statusText: "Your choices were received." } };
export const Expired: Story = { args: { status: "expired" } };
export const Superseded: Story = { args: { status: "superseded" } };
export const TextFallback: Story = { args: { showAsText: true } };
export const InvalidForm: Story = {
    args: {
        root: {
            kind: "form",
            id: "invalid",
            submitLabel: "Send",
            disabled: false,
            pending: false,
            children: [
                {
                    kind: "text_input",
                    id: "required",
                    label: "Required note",
                    value: "",
                    multiline: false,
                    maxLength: 100,
                    required: true,
                    invalid: true,
                    disabled: false,
                },
            ],
        },
    },
};
export const OneItemCarousel: Story = {
    args: {
        root: {
            kind: "carousel",
            id: "single",
            label: "Recommended",
            index: 0,
            items: [
                {
                    id: "only",
                    title: "Brown sugar",
                    src: image,
                    alt: "Sugar illustration",
                    meta: ["250 g"],
                    disabled: false,
                    actionLabel: "Choose",
                },
            ],
        },
    },
};

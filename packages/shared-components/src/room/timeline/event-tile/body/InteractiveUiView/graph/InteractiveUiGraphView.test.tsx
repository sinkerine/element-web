/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import "@vector-im/compound-design-tokens/assets/web/css/compound-design-tokens.css";
import React, { useState } from "react";
import { render, screen, within } from "@test-utils";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { InteractiveUiGraphView } from "./InteractiveUiGraphView";
import { layoutLayeredGraph } from "./GraphLayout";
import { graphGeometry } from "./graphGeometry";

const layout = layoutLayeredGraph({
    layers: [{ label: "Input" }, { label: "Output" }],
    nodes: [
        { id: "a", label: "First", detail: "First detail", layer: 0 },
        { id: "b", label: "Second", layer: 1 },
        { id: "c", label: "Third", layer: 1 },
    ],
    edges: [
        { from: "a", to: "b", label: "forward" },
        { from: "b", to: "a", label: "back" },
        { from: "b", to: "c", style: "dashed", label: "same layer" },
    ],
});

describe("InteractiveUiGraphView", () => {
    it("should select with Enter and Space, clear with Escape and retain reading order", async () => {
        const user = userEvent.setup();
        const onSelect = vi.fn();
        function Controlled(): React.JSX.Element {
            const [selectedId, setSelectedId] = useState<string | null>(null);
            return (
                <InteractiveUiGraphView
                    layout={layout}
                    selectedId={selectedId}
                    showAsList={false}
                    onSelect={(id) => {
                        onSelect(id);
                        setSelectedId(id);
                    }}
                    onToggleList={vi.fn()}
                />
            );
        }
        const { container } = render(<Controlled />);
        screen.getByRole("button", { name: "Relationships as list" }).focus();
        await user.tab(); // The scroll region itself is keyboard-scrollable.
        await user.tab();
        expect(screen.getByRole("button", { name: "First" })).toHaveFocus();
        await user.keyboard("{Enter}");
        expect(onSelect).toHaveBeenLastCalledWith("a");
        expect(screen.getByText("First detail")).toBeVisible();
        expect(container.querySelectorAll('g[data-selected="true"]')).toHaveLength(2);
        await user.tab();
        expect(screen.getByRole("button", { name: "Second" })).toHaveFocus();
        await user.keyboard(" ");
        expect(onSelect).toHaveBeenLastCalledWith("b");
        await user.keyboard("{Escape}");
        expect(onSelect).toHaveBeenLastCalledWith(null);
        expect(screen.queryByText("First detail")).not.toBeInTheDocument();
    });
    it("should request list mode and list every relationship", async () => {
        const user = userEvent.setup();
        const onToggleList = vi.fn();
        const { rerender } = render(
            <InteractiveUiGraphView
                layout={layout}
                selectedId={null}
                showAsList={false}
                onSelect={vi.fn()}
                onToggleList={onToggleList}
            />,
        );
        await user.click(screen.getByRole("button", { name: "Relationships as list" }));
        expect(onToggleList).toHaveBeenCalledWith(true);
        rerender(
            <InteractiveUiGraphView
                layout={layout}
                selectedId={null}
                showAsList
                onSelect={vi.fn()}
                onToggleList={onToggleList}
            />,
        );
        expect(within(screen.getAllByRole("list")[1]).getAllByRole("listitem")).toHaveLength(layout.edges.length);
        expect(screen.getByText("Second → First: back")).toBeVisible();
    });
    it.each(["left_to_right", "top_to_bottom"] as const)(
        "should contain fixed geometry and finite back-edge routes in %s",
        (direction) => {
            const geometry = graphGeometry({ ...layout, direction });
            expect(geometry.paths).toHaveLength(3);
            for (const box of geometry.boxes.values()) {
                expect(box.width).toBe(168);
                expect(box.height).toBe(56);
                expect(box.x + box.width).toBeLessThan(geometry.width);
                expect(box.y + box.height).toBeLessThan(geometry.height);
            }
            expect(JSON.stringify(geometry.paths)).not.toMatch(/NaN|Infinity/);
        },
    );
    it.each(["left_to_right", "top_to_bottom"] as const)(
        "should route self, back, same-layer and forward edges and their labels outside every node in %s",
        (direction) => {
            const routedLayout = layoutLayeredGraph({
                direction,
                layers: [{ label: "A" }, { label: "B" }, { label: "C" }],
                nodes: [
                    { id: "a", label: "A", layer: 0 },
                    { id: "b", label: "B", layer: 1 },
                    { id: "c", label: "C", layer: 2 },
                    { id: "d", label: "D", layer: 1 },
                ],
                edges: [
                    { from: "a", to: "c", label: "skipped forward" },
                    { from: "a", to: "b", label: "adjacent forward" },
                    { from: "c", to: "a", label: "back" },
                    { from: "b", to: "d", label: "same" },
                    { from: "b", to: "b", label: "self" },
                ],
            });
            const geometry = graphGeometry(routedLayout);
            const isInsideBox = (x: number, y: number): boolean =>
                [...geometry.boxes.values()].some(
                    (box) =>
                        x > box.x + 0.1 &&
                        x < box.x + box.width - 0.1 &&
                        y > box.y + 0.1 &&
                        y < box.y + box.height - 0.1,
                );
            for (const route of geometry.paths) {
                expect(isInsideBox(route.labelBox.x, route.labelBox.y)).toBe(false);
                const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
                path.setAttribute("d", route.d);
                const length = path.getTotalLength();
                for (let distance = 1; distance < length - 1; distance += 2) {
                    const point = path.getPointAtLength(distance);
                    for (const box of geometry.boxes.values()) {
                        const inside =
                            point.x > box.x + 0.1 &&
                            point.x < box.x + box.width - 0.1 &&
                            point.y > box.y + 0.1 &&
                            point.y < box.y + box.height - 0.1;
                        expect(inside).toBe(false);
                    }
                }
            }
        },
    );
    it.each([
        ["left_to_right", "W".repeat(60)],
        ["top_to_bottom", "W".repeat(60)],
        ["left_to_right", "知识图谱关系说明".repeat(7)],
        ["top_to_bottom", "知识图谱关系说明".repeat(7)],
    ] as const)("should bound rendered labels for every edge class in %s with %s", (direction, label) => {
        const labelledLayout = layoutLayeredGraph({
            direction,
            layers: [{ label: "A" }, { label: "B" }, { label: "C" }],
            nodes: [
                { id: "a", label: "A", layer: 0 },
                { id: "b", label: "B", layer: 1 },
                { id: "c", label: "C", layer: 2 },
            ],
            edges: [
                { from: "a", to: "c", label },
                { from: "a", to: "b", label },
                { from: "c", to: "a", label },
                { from: "b", to: "b", label },
            ],
        });
        // Add a second node only for the same-layer variant; retain the one-node-wide repro above.
        const sameLayer = layoutLayeredGraph({
            ...labelledLayout,
            nodes: [...labelledLayout.nodes, { id: "d", label: "D", layer: 1 }],
            edges: [...labelledLayout.edges, { from: "b", to: "d", label }],
        });
        const { rerender } = render(
            <div style={{ width: 360 }}>
                <InteractiveUiGraphView
                    layout={labelledLayout}
                    selectedId={null}
                    showAsList={false}
                    onSelect={vi.fn()}
                    onToggleList={vi.fn()}
                />
            </div>,
        );
        for (const graph of [labelledLayout, sameLayer]) {
            rerender(
                <div style={{ width: 360 }}>
                    <InteractiveUiGraphView
                        layout={graph}
                        selectedId={null}
                        showAsList={false}
                        onSelect={vi.fn()}
                        onToggleList={vi.fn()}
                    />
                </div>,
            );
            const svg = document.querySelector("svg")!;
            const viewport = svg.getBoundingClientRect();
            const boxes = screen
                .getAllByRole("button")
                .filter((button) => button.hasAttribute("aria-pressed") && button.title)
                .map((button) => button.getBoundingClientRect());
            const labels = [...svg.querySelectorAll("foreignObject")];
            expect(labels).toHaveLength(graph.edges.length);
            for (const element of labels) {
                const bounds = element.getBoundingClientRect();
                for (const other of labels) {
                    if (other === element) continue;
                    const otherBounds = other.getBoundingClientRect();
                    expect(
                        bounds.left < otherBounds.right &&
                            bounds.right > otherBounds.left &&
                            bounds.top < otherBounds.bottom &&
                            bounds.bottom > otherBounds.top,
                    ).toBe(false);
                }
                expect(element.getBBox().width).toBeGreaterThan(0);
                expect(bounds.left).toBeGreaterThanOrEqual(viewport.left);
                expect(bounds.top).toBeGreaterThanOrEqual(viewport.top);
                expect(bounds.right).toBeLessThanOrEqual(viewport.right);
                expect(bounds.bottom).toBeLessThanOrEqual(viewport.bottom);
                for (const box of boxes) {
                    expect(
                        bounds.left < box.right &&
                            bounds.right > box.left &&
                            bounds.top < box.bottom &&
                            bounds.bottom > box.top,
                    ).toBe(false);
                }
                const text = element.firstElementChild as HTMLElement;
                expect(text.title).toBe(label);
                expect(text.textContent).toBe(label);
                expect(text.getBoundingClientRect().width).toBeLessThanOrEqual(bounds.width);
                expect(getComputedStyle(text).textOverflow).toBe("ellipsis");
                expect(getComputedStyle(text).overflow).toBe("hidden");
            }
            expect(screen.getByRole("group", { name: "Graph" }).getBoundingClientRect().width).toBeLessThanOrEqual(360);
        }
    });
    it.each(["left_to_right", "top_to_bottom"] as const)(
        "should separate reciprocal and converging rendered labels in %s and retain their routes",
        (direction) => {
            const graph = layoutLayeredGraph({
                direction,
                layers: [{ label: "A" }, { label: "B" }, { label: "C" }],
                nodes: [
                    { id: "a", label: "A", layer: 0 },
                    { id: "b", label: "B", layer: 1 },
                    { id: "c", label: "C", layer: 2 },
                    { id: "d", label: "D", layer: 0 },
                ],
                edges: [
                    { from: "a", to: "c", label: "activates" },
                    { from: "c", to: "a", label: "inhibits" },
                    { from: "a", to: "b", label: "first input" },
                    { from: "a", to: "b", label: "second input" },
                    { from: "d", to: "b", label: "converging input" },
                    { from: "a", to: "a", label: "self regulation" },
                    { from: "a", to: "d", label: "same layer" },
                    { from: "d", to: "a", label: "return on same layer" },
                    { from: "a", to: "c", label: "another skipped relationship" },
                ],
            });
            const { container } = render(
                <div style={{ width: 360 }}>
                    <InteractiveUiGraphView
                        layout={graph}
                        selectedId={null}
                        showAsList={false}
                        onSelect={vi.fn()}
                        onToggleList={vi.fn()}
                    />
                </div>,
            );
            const svg = container.querySelector("svg")!;
            const viewport = svg.getBoundingClientRect();
            const nodes = screen
                .getAllByRole("button")
                .filter((button) => button.title)
                .map((button) => button.getBoundingClientRect());
            const labels = [...svg.querySelectorAll("foreignObject")];
            const overlaps = (a: DOMRect, b: DOMRect): boolean =>
                a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
            expect(labels).toHaveLength(graph.edges.length);
            for (const [index, label] of labels.entries()) {
                const bounds = label.getBoundingClientRect();
                expect(bounds.width).toBeGreaterThan(0);
                expect(bounds.left).toBeGreaterThanOrEqual(viewport.left);
                expect(bounds.top).toBeGreaterThanOrEqual(viewport.top);
                expect(bounds.right).toBeLessThanOrEqual(viewport.right);
                expect(bounds.bottom).toBeLessThanOrEqual(viewport.bottom);
                for (const other of labels.slice(0, index))
                    expect(overlaps(bounds, other.getBoundingClientRect())).toBe(false);
                for (const node of nodes) expect(overlaps(bounds, node)).toBe(false);
                expect(label.firstElementChild).toHaveAttribute("title", graph.edges[index].label);
                expect(label).toHaveTextContent(graph.edges[index].label!);
            }
            const geometry = graphGeometry(graph);
            expect(geometry).toEqual(graphGeometry(graph));
            // A route that moves with a label must still stay outside every node box.
            for (const route of geometry.paths) {
                const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
                path.setAttribute("d", route.d);
                for (let distance = 1; distance < path.getTotalLength() - 1; distance += 2) {
                    const point = path.getPointAtLength(distance);
                    for (const box of geometry.boxes.values()) {
                        expect(
                            point.x > box.x + 0.1 &&
                                point.x < box.x + box.width - 0.1 &&
                                point.y > box.y + 0.1 &&
                                point.y < box.y + box.height - 0.1,
                        ).toBe(false);
                    }
                }
            }
            const reciprocalPaths = [...svg.querySelectorAll("g > path")].slice(0, 2);
            expect(reciprocalPaths[0].getAttribute("d")).not.toBe(reciprocalPaths[1].getAttribute("d"));
            expect(screen.getByRole("group", { name: "Graph" }).getBoundingClientRect().width).toBeLessThanOrEqual(360);
            expect(container.firstElementChild!.scrollWidth).toBeLessThanOrEqual(360);
        },
    );
    it("should wrap maximum-length relationship descriptions inside a 360px card", () => {
        const longLabel = "W".repeat(80);
        const longLayout = layoutLayeredGraph({
            layers: [{ label: "Layer" }],
            nodes: [
                { id: "a", label: longLabel, layer: 0 },
                { id: "b", label: longLabel, layer: 0 },
            ],
            edges: [{ from: "a", to: "b", label: "W".repeat(60) }],
        });
        const { container } = render(
            <div style={{ width: 360 }}>
                <InteractiveUiGraphView
                    layout={longLayout}
                    selectedId={null}
                    showAsList
                    onSelect={vi.fn()}
                    onToggleList={vi.fn()}
                />
            </div>,
        );
        const group = screen.getByRole("group", { name: "Graph" });
        const relationships = screen.getAllByRole("list")[1];
        expect(relationships.scrollWidth).toBeLessThanOrEqual(relationships.clientWidth);
        expect(group.scrollWidth).toBeLessThanOrEqual(360);
        expect(container.firstElementChild!.scrollWidth).toBeLessThanOrEqual(360);
    });
    it("should scroll inside a 360px card", () => {
        render(
            <div style={{ width: 360 }}>
                <InteractiveUiGraphView
                    layout={layout}
                    selectedId={null}
                    showAsList={false}
                    onSelect={vi.fn()}
                    onToggleList={vi.fn()}
                />
            </div>,
        );
        const region = screen.getAllByRole("region", { name: "Graph" }).find((element) => element.tabIndex === 0)!;
        expect(region.clientWidth).toBeLessThanOrEqual(360);
        expect(region.scrollWidth).toBeGreaterThan(region.clientWidth);
        expect(region.parentElement!.getBoundingClientRect().width).toBeLessThanOrEqual(360);
    });
});

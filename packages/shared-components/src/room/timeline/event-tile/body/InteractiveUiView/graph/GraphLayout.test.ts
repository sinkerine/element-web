/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { describe, expect, it } from "vitest";
import { layoutLayeredGraph, type GraphLayout, type LayeredGraphInput } from "./GraphLayout";

const fixtures = import.meta.glob("../../../../../../../../../apps/web/src/interactive-ui/fixtures/valid/*.json", {
    eager: true,
    import: "default",
});

function crossings(nodes: GraphLayout["nodes"], edges: GraphLayout["edges"]): number {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    let count = 0;
    for (let i = 0; i < edges.length; i++)
        for (let j = i + 1; j < edges.length; j++) {
            const a = byId.get(edges[i].from)!;
            const b = byId.get(edges[i].to)!;
            const c = byId.get(edges[j].from)!;
            const d = byId.get(edges[j].to)!;
            if (a.layer === c.layer && b.layer === d.layer && (a.order - c.order) * (b.order - d.order) < 0) count++;
        }
    return count;
}

describe("layoutLayeredGraph", () => {
    it("should deterministically remove a crossing, keep ties stable and preserve input", () => {
        const input: LayeredGraphInput = {
            layers: [{ label: "A" }, { label: "B" }],
            nodes: [
                { id: "a", label: "A", layer: 0 },
                { id: "b", label: "B", layer: 0 },
                { id: "c", label: "C", layer: 1 },
                { id: "d", label: "D", layer: 1 },
                { id: "e", label: "E", layer: 1 },
            ],
            edges: [
                { from: "a", to: "d" },
                { from: "b", to: "c" },
                { from: "b", to: "e" },
            ],
        };
        const before = structuredClone(input);
        const layout = layoutLayeredGraph(input);
        expect(layout).toEqual(layoutLayeredGraph(input));
        expect(input).toEqual(before);
        expect(crossings(layout.nodes, layout.edges)).toBe(0);
        expect(layout.nodes.filter((node) => node.layer === 1).map((node) => node.id)).toEqual(["d", "c", "e"]);
        expect(layout.nodes.every((node) => node.tone === "neutral")).toBe(true);
    });
    it("should retain disconnected input order", () => {
        const input: LayeredGraphInput = {
            layers: [{ label: "A" }],
            nodes: ["b", "a"].map((id) => ({ id, label: id, layer: 0 })),
            edges: [],
        };
        expect(layoutLayeredGraph(input).nodes.map((node) => node.id)).toEqual(["b", "a"]);
    });
    it("should never increase crossings for any valid graph fixture", () => {
        const graphs = Object.values(fixtures).flatMap((fixture) =>
            (fixture as { nodes: ({ type: string } & LayeredGraphInput)[] }).nodes.filter(
                (node) => node.type === "graph",
            ),
        );
        expect(graphs.length).toBeGreaterThan(0);
        for (const graph of graphs) {
            const layout = layoutLayeredGraph(graph);
            const counts = new Map<number, number>();
            const original = graph.nodes.map((node) => {
                const order = counts.get(node.layer) ?? 0;
                counts.set(node.layer, order + 1);
                return { ...node, tone: node.tone ?? ("neutral" as const), order };
            });
            expect(crossings(layout.nodes, layout.edges)).toBeLessThanOrEqual(crossings(original, layout.edges));
            expect(layoutLayeredGraph(graph)).toEqual(layout);
        }
    });
});

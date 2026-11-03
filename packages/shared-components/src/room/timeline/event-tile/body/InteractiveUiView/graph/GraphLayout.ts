/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import type { BadgeTone } from "./BadgeTone";

/** Ordered graph data; pixel geometry belongs to the view. */
export interface GraphLayout {
    direction: "left_to_right" | "top_to_bottom";
    layers: { label: string; index: number }[];
    nodes: { id: string; label: string; detail?: string; tone: BadgeTone; layer: number; order: number }[];
    edges: { from: string; to: string; label?: string; style: "solid" | "dashed" }[];
}

/** Validated graph input before ordering and default values are applied. */
export interface LayeredGraphInput {
    direction?: GraphLayout["direction"];
    layers: { label: string }[];
    nodes: { id: string; label: string; detail?: string; layer: number; tone?: BadgeTone }[];
    edges: { from: string; to: string; label?: string; style?: "solid" | "dashed" }[];
}

/** Apply four stable barycentre sweeps without mutating the input. */
export function layoutLayeredGraph(input: LayeredGraphInput): GraphLayout {
    const nodes = input.nodes.map((node) => ({ ...node, tone: node.tone ?? "neutral", order: 0 }));
    const layers = input.layers.map((layer, index) => ({ ...layer, index }));
    const groups = layers.map(({ index }) => nodes.filter((node) => node.layer === index));
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const setOrders = (): void => {
        for (const group of groups)
            group.forEach((node, order) => {
                node.order = order;
            });
    };
    setOrders();
    for (const down of [true, false, true, false]) {
        const indices = layers.map(({ index }) => index);
        if (!down) indices.reverse();
        for (const index of indices) {
            const adjacent = index + (down ? -1 : 1);
            if (adjacent < 0 || adjacent >= groups.length) continue;
            const scores = new Map(
                groups[index].map((node) => {
                    const neighbours = input.edges.flatMap((edge) => {
                        const other =
                            edge.from === node.id
                                ? byId.get(edge.to)
                                : edge.to === node.id
                                  ? byId.get(edge.from)
                                  : undefined;
                        return other?.layer === adjacent ? [other.order] : [];
                    });
                    return [
                        node.id,
                        neighbours.length
                            ? neighbours.reduce((sum, order) => sum + order, 0) / neighbours.length
                            : node.order,
                    ];
                }),
            );
            groups[index].sort((a, b) => scores.get(a.id)! - scores.get(b.id)! || a.order - b.order);
            setOrders();
        }
    }
    return {
        direction: input.direction ?? "left_to_right",
        layers,
        nodes: groups.flat(),
        edges: input.edges.map((edge) => ({ ...edge, style: edge.style ?? "solid" })),
    };
}

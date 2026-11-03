/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import type { GraphLayout } from "./GraphLayout";

// Fixed geometry is shared by HTML node buttons and SVG paths.
export const nodeWidth = 168;
export const nodeHeight = 56;
const layerGap = 72;
const nodeGap = 16;
const margin = 48;
const labelHeight = 32;
const labelWidth = 168;

/** Bounding box of a graph node in the diagram. */
export interface GraphBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** Calculate fixed geometry with outside lanes for edges that cannot use an adjacent-layer gap. */
export function graphGeometry(layout: GraphLayout): {
    width: number;
    height: number;
    boxes: Map<string, GraphBox>;
    headings: { x: number; y: number; label: string }[];
    paths: { d: string; labelBox: GraphBox }[];
} {
    const horizontal = layout.direction === "left_to_right";
    const count = Math.max(
        1,
        ...layout.layers.map((layer) => layout.nodes.filter((node) => node.layer === layer.index).length),
    );
    const width =
        margin * 2 +
        (horizontal
            ? layout.layers.length * (nodeWidth + layerGap) - layerGap
            : count * (nodeWidth + nodeGap) - nodeGap);
    const height =
        margin * 2 +
        (horizontal
            ? count * (nodeHeight + nodeGap) - nodeGap
            : layout.layers.length * (nodeHeight + layerGap) - layerGap);
    const boxes = new Map(
        layout.nodes.map((node) => [
            node.id,
            {
                x: margin + (horizontal ? node.layer * (nodeWidth + layerGap) : node.order * (nodeWidth + nodeGap)),
                y: margin + (horizontal ? node.order * (nodeHeight + nodeGap) : node.layer * (nodeHeight + layerGap)),
                width: nodeWidth,
                height: nodeHeight,
            },
        ]),
    );
    const byId = new Map(layout.nodes.map((node) => [node.id, node]));
    const intersects = (a: GraphBox, b: GraphBox): boolean =>
        a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
    const allocatedLabels: GraphBox[] = [];
    let outsideSlot = 0;
    const routeEdge = (
        edge: GraphLayout["edges"][number],
        index: number,
        slot?: number,
    ): { d: string; labelBox: GraphBox } => {
        const from = boxes.get(edge.from)!;
        const to = boxes.get(edge.to)!;
        // Only adjacent layers have a clear gap. Skipping a layer may intersect its nodes and labels.
        const adjacentForward = byId.get(edge.to)!.layer === byId.get(edge.from)!.layer + 1;
        if (adjacentForward && slot === undefined) {
            if (horizontal) {
                const x1 = from.x + nodeWidth;
                const y1 = from.y + nodeHeight / 2;
                const x2 = to.x;
                const y2 = to.y + nodeHeight / 2;
                const mid = (x1 + x2) / 2;
                return {
                    d: `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`,
                    labelBox: { x: x1 + 8, y: (y1 + y2) / 2 - labelHeight, width: layerGap - 16, height: labelHeight },
                };
            }
            const x1 = from.x + nodeWidth / 2;
            const y1 = from.y + nodeHeight;
            const x2 = to.x + nodeWidth / 2;
            const y2 = to.y;
            const mid = (y1 + y2) / 2;
            return {
                d: `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`,
                labelBox: {
                    x: (x1 + x2) / 2 - labelWidth / 2,
                    y: mid - labelHeight / 2,
                    width: labelWidth,
                    height: labelHeight,
                },
            };
        }
        // Use the gaps beside each layer to reach an outside lane without crossing node boxes.
        // Each segment is cubic, including the straight runs along the outside lane.
        const lane = 12 + (index % 5) * 6;
        if (horizontal) {
            const x1 = from.x + nodeWidth;
            const y1 = from.y + nodeHeight / 2;
            const x2 = to.x + nodeWidth;
            const y2 = to.y + nodeHeight / 2;
            const exit = x1 + 18;
            const entry = x2 + 36;
            // Labelled outside routes each have a separate lane and the label sits just below it.
            const y = slot === undefined ? height - lane : height + slot * (labelHeight + 16);
            return {
                d: `M ${x1} ${y1} C ${exit} ${y1}, ${exit} ${y1}, ${exit} ${y1} C ${exit} ${y1}, ${exit} ${y}, ${exit} ${y} C ${exit} ${y}, ${entry} ${y}, ${entry} ${y} C ${entry} ${y}, ${entry} ${y2}, ${entry} ${y2} C ${entry} ${y2}, ${x2} ${y2}, ${x2} ${y2}`,
                labelBox: {
                    x: Math.max(8, Math.min(width - labelWidth - 8, (exit + entry) / 2 - labelWidth / 2)),
                    y: slot === undefined ? height : y + 8,
                    width: labelWidth,
                    height: labelHeight,
                },
            };
        }
        const x1 = from.x + nodeWidth / 2;
        const y1 = from.y + nodeHeight;
        const x2 = to.x + nodeWidth / 2;
        const y2 = to.y + nodeHeight;
        const exit = y1 + 18;
        const entry = y2 + 36;
        const x = slot === undefined ? width - lane : width + slot * (labelWidth + 16);
        return {
            d: `M ${x1} ${y1} C ${x1} ${exit}, ${x1} ${exit}, ${x1} ${exit} C ${x1} ${exit}, ${x} ${exit}, ${x} ${exit} C ${x} ${exit}, ${x} ${entry}, ${x} ${entry} C ${x} ${entry}, ${x2} ${entry}, ${x2} ${entry} C ${x2} ${entry}, ${x2} ${y2}, ${x2} ${y2}`,
            labelBox: {
                x: slot === undefined ? width : x + 8,
                y: (exit + entry) / 2 - labelHeight / 2,
                width: labelWidth,
                height: labelHeight,
            },
        };
    };
    const paths = layout.edges.map((edge, index) => {
        const adjacentForward = byId.get(edge.to)!.layer === byId.get(edge.from)!.layer + 1;
        let route = routeEdge(edge, index, edge.label && !adjacentForward ? outsideSlot++ : undefined);
        if (edge.label) {
            // Converging adjacent edges can share a candidate label area. Move the entire route to
            // its own outside lane so the relocated label remains associated with its relationship.
            if (
                allocatedLabels.some((box) => intersects(box, route.labelBox)) ||
                [...boxes.values()].some((box) => intersects(box, route.labelBox))
            ) {
                route = routeEdge(edge, index, outsideSlot++);
            }
            allocatedLabels.push(route.labelBox);
        }
        return route;
    });
    const headings = layout.layers.map((layer) => ({
        x: horizontal ? margin + layer.index * (nodeWidth + layerGap) : margin,
        y: horizontal ? 24 : margin + layer.index * (nodeHeight + layerGap) - 16,
        label: layer.label,
    }));
    // Include complete label rectangles, not just their anchor points, in the scrollable canvas.
    const labelledPaths = paths.filter((_, index) => layout.edges[index].label);
    return {
        width: Math.max(
            width,
            nodeWidth + margin * 2,
            ...labelledPaths.map(({ labelBox }) => labelBox.x + labelBox.width + 8),
        ),
        height: Math.max(
            height,
            nodeHeight + margin * 2,
            ...labelledPaths.map(({ labelBox }) => labelBox.y + labelBox.height + 8),
        ),
        boxes,
        headings,
        paths,
    };
}

/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

// The payload provides no stable IDs for repeated chart values or graph edges; positions identify them.
/* oxlint-disable react/no-array-index-key */
// Scroll regions must receive keyboard focus so keyboard users can pan wide data.
/* oxlint-disable jsx-a11y/no-noninteractive-tabindex */

import React, { type JSX, useId } from "react";
import { Button, Text } from "@vector-im/compound-web";

import { useI18n } from "../../../../../../core/i18n/i18nContext";
import type { GraphLayout } from "./GraphLayout";
import { graphGeometry } from "./graphGeometry";
import styles from "./InteractiveUiGraphView.module.css";

interface Props {
    /** Ordered graph data, including labels and optional node details. */
    layout: GraphLayout;
    /** Selection owned by the caller; null clears the detail panel. */
    selectedId: string | null;
    /** Caller-owned alternative representation. */
    showAsList: boolean;
    /** Request a selection change. */
    onSelect: (id: string | null) => void;
    /** Request the relationship list or diagram. */
    onToggleList: (asList: boolean) => void;
}

/** A controlled graph with keyboard node buttons and a relationship list alternative. */
export function InteractiveUiGraphView({ layout, selectedId, showAsList, onSelect, onToggleList }: Props): JSX.Element {
    const _t = useI18n().translate;
    const markerId = useId();
    const detailId = useId();
    const geometry = graphGeometry(layout);
    const selected = layout.nodes.find((node) => node.id === selectedId);
    const nodes = [...layout.nodes].sort((a, b) => a.layer - b.layer || a.order - b.order);
    const labels = new Map(nodes.map((node) => [node.id, node.label]));
    const nodeButton = (node: GraphLayout["nodes"][number], diagram: boolean): JSX.Element => (
        <button
            key={node.id}
            type="button"
            className={styles.node}
            data-tone={node.tone}
            style={
                diagram
                    ? {
                          left: geometry.boxes.get(node.id)!.x,
                          top: geometry.boxes.get(node.id)!.y,
                          width: 168,
                          height: 56,
                      }
                    : undefined
            }
            aria-pressed={selectedId === node.id}
            aria-describedby={selectedId === node.id && node.detail ? detailId : undefined}
            title={node.label}
            onClick={() => onSelect(node.id)}
        >
            <span className={styles.label}>{node.label}</span>
        </button>
    );
    return (
        <div
            role="group"
            className={styles.container}
            aria-label={_t("interactive_ui|graph")}
            onKeyDown={(event) => {
                if (event.key === "Escape") {
                    event.stopPropagation();
                    onSelect(null);
                }
            }}
        >
            <Button
                type="button"
                kind="secondary"
                size="md"
                aria-pressed={showAsList}
                onClick={() => onToggleList(!showAsList)}
            >
                {_t("interactive_ui|relationships_list")}
            </Button>
            {showAsList ? (
                <>
                    <ol className={styles.nodes}>
                        {nodes.map((node) => (
                            <li key={node.id}>{nodeButton(node, false)}</li>
                        ))}
                    </ol>
                    <ul>
                        {layout.edges.map((edge, index) => (
                            <li key={index}>
                                {labels.get(edge.from)} → {labels.get(edge.to)}
                                {edge.label ? `: ${edge.label}` : ""}
                            </li>
                        ))}
                    </ul>
                </>
            ) : (
                <div className={styles.scroll} tabIndex={0} role="group" aria-label={_t("interactive_ui|graph")}>
                    <div className={styles.diagram} style={{ width: geometry.width, height: geometry.height }}>
                        <svg width={geometry.width} height={geometry.height} aria-hidden="true" focusable="false">
                            <defs>
                                <marker
                                    id={markerId}
                                    viewBox="0 0 10 10"
                                    refX="9"
                                    refY="5"
                                    markerWidth="6"
                                    markerHeight="6"
                                    orient="auto-start-reverse"
                                >
                                    <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
                                </marker>
                            </defs>
                            {layout.edges.map((edge, index) => (
                                <g
                                    key={index}
                                    className={styles.edge}
                                    data-selected={
                                        selectedId !== null && (edge.from === selectedId || edge.to === selectedId)
                                    }
                                >
                                    <path
                                        d={geometry.paths[index].d}
                                        fill="none"
                                        markerEnd={`url(#${markerId})`}
                                        strokeDasharray={edge.style === "dashed" ? "6 4" : undefined}
                                    />
                                    {edge.label && (
                                        <foreignObject {...geometry.paths[index].labelBox}>
                                            <div className={styles.edgeLabel} title={edge.label}>
                                                {edge.label}
                                            </div>
                                        </foreignObject>
                                    )}
                                </g>
                            ))}
                        </svg>
                        {geometry.headings.map((heading, index) => (
                            <Text
                                as="span"
                                key={index}
                                className={styles.heading}
                                title={heading.label}
                                style={{ left: heading.x, top: heading.y }}
                            >
                                {heading.label}
                            </Text>
                        ))}
                        {nodes.map((node) => nodeButton(node, true))}
                    </div>
                </div>
            )}
            <div aria-live="polite" id={detailId} className={styles.detail}>
                {selected && (
                    <>
                        <Text as="p" weight="semibold">
                            {selected.label}
                        </Text>
                        {selected.detail && <Text as="p">{selected.detail}</Text>}
                    </>
                )}
            </div>
        </div>
    );
}

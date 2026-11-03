/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import "@vector-im/compound-design-tokens/assets/web/css/compound-design-tokens.css";
import React from "react";
import { render, screen } from "@test-utils";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { InteractiveUiChartView } from "./InteractiveUiChartView";
import type { ChartModel } from "./ChartModel";

const models: ChartModel[] = [
    {
        kind: "bar",
        title: "Mass",
        categories: ["A", "B"],
        series: [
            { name: "First", values: [-2, 4] },
            { name: "Second", values: [3, 1] },
        ],
    },
    {
        kind: "line",
        categories: ["A", "B"],
        series: [
            { name: "First", values: [-1e308, 1e308] },
            { name: "Second", values: [0, 0] },
        ],
    },
    { kind: "pie", categories: ["Only"], values: [Number.MAX_VALUE] },
    {
        kind: "scatter",
        xLabel: "Distance",
        yLabel: "Mass",
        series: [
            {
                name: "First",
                points: [
                    { x: -1e308, y: 1e308, label: "Far" },
                    { x: 1e308, y: -1e308 },
                ],
            },
        ],
    },
];

describe("InteractiveUiChartView", () => {
    it.each(models)("should render accessible finite $kind SVG geometry and equivalent data", async (chart) => {
        const user = userEvent.setup();
        const onToggleData = vi.fn();
        const { container, rerender } = render(
            <InteractiveUiChartView chart={chart} showData={false} onToggleData={onToggleData} />,
        );
        expect(screen.getByRole("img")).toHaveAccessibleName(/data rows/);
        expect(container.querySelector("svg")!.outerHTML).not.toMatch(/NaN|Infinity/);
        await user.click(screen.getByRole("button", { name: "Data table" }));
        expect(onToggleData).toHaveBeenCalledWith(true);
        rerender(<InteractiveUiChartView chart={chart} showData onToggleData={onToggleData} />);
        expect(screen.getByRole("table")).toBeVisible();
        expect(screen.queryByRole("img")).not.toBeInTheDocument();
        if (chart.kind === "scatter") expect(screen.getByRole("columnheader", { name: "Distance" })).toBeVisible();
        else expect(screen.getByRole("cell", { name: chart.categories[0] })).toBeVisible();
    });
    it("should use a full circle for a single-value pie and patterns for multiple categories", () => {
        const { container, rerender } = render(
            <InteractiveUiChartView chart={models[2]} showData={false} onToggleData={vi.fn()} />,
        );
        expect(container.querySelector("circle")).toHaveAttribute("r", "116");
        rerender(
            <InteractiveUiChartView
                chart={{ kind: "pie", categories: ["A", "B", "Zero"], values: [1e308, 1e308, 0] }}
                showData={false}
                onToggleData={vi.fn()}
            />,
        );
        expect(container.querySelectorAll("pattern")).toHaveLength(3);
        expect(container.querySelector("svg")!.outerHTML).not.toMatch(/NaN|Infinity/);
    });
    it.each([
        { values: [-1, 1], explanation: /cannot represent negative values/ },
        { values: [-3, -2], explanation: /cannot represent negative values/ },
        { values: [0, 0], explanation: /zero total/ },
    ])(
        "should explain unrepresentable pie values $values and automatically show the unmodified data",
        ({ values, explanation }) => {
            const onToggleData = vi.fn();
            render(
                <InteractiveUiChartView
                    chart={{ kind: "pie", categories: ["A", "B"], values }}
                    showData={false}
                    onToggleData={onToggleData}
                />,
            );
            expect(screen.getByText(explanation)).toBeVisible();
            expect(screen.queryByRole("img")).not.toBeInTheDocument();
            const cells = screen.getAllByRole("cell").map((cell) => cell.textContent);
            expect(cells).toEqual(["A", String(values[0]), "B", String(values[1])]);
            expect(screen.getByRole("table")).toBeVisible();
            expect(onToggleData).not.toHaveBeenCalled();
        },
    );
    it("should uniquely number pie patterns and legend categories beyond eight", () => {
        const categories = Array.from({ length: 12 }, (_, index) => `Category ${index + 1}`);
        const { container } = render(
            <InteractiveUiChartView
                chart={{ kind: "pie", categories, values: categories.map(() => 1) }}
                showData={false}
                onToggleData={vi.fn()}
            />,
        );
        const patternLabels = [...container.querySelectorAll("pattern text")].map((text) => text.textContent);
        expect(patternLabels).toEqual(categories.map((_, index) => String(index + 1)));
        expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual(
            categories.map((name, index) => `${index + 1}. ${name}`),
        );
    });
    it.each(["bar", "line"] as const)("should thin 100-category %s ticks to prevent label overlap", (kind) => {
        const categories = Array.from({ length: 100 }, (_, index) => `Category ${index + 1}`);
        const { container } = render(
            <InteractiveUiChartView
                chart={{ kind, categories, series: [{ name: "Values", values: categories.map(() => 1) }] }}
                showData={false}
                onToggleData={vi.fn()}
            />,
        );
        const ticks = [...container.querySelectorAll<SVGTextElement>("svg text")].filter(
            (element) => element.querySelector("title") && element.getAttribute("y") === "300",
        );
        expect(ticks.length).toBe(5);
        const boxes = ticks.map((tick) => tick.getBoundingClientRect());
        for (let index = 1; index < boxes.length; index++)
            expect(boxes[index].left).toBeGreaterThan(boxes[index - 1].right);
        expect(
            container.querySelectorAll(kind === "bar" ? "rect[fill]" : "text[dominant-baseline=central]"),
        ).toHaveLength(100);
    });
    it("should distinguish line series with different markers and dashes", () => {
        const { container } = render(
            <InteractiveUiChartView chart={models[1]} showData={false} onToggleData={vi.fn()} />,
        );
        expect(container.querySelector('[stroke-dasharray="8 4"]')).toBeInTheDocument();
        expect(screen.getAllByText("●").length).toBeGreaterThan(0);
        expect(screen.getAllByText("■").length).toBeGreaterThan(0);
    });
    it("should scroll within a 360px card", () => {
        render(
            <div style={{ width: 360 }}>
                <InteractiveUiChartView chart={models[0]} showData={false} onToggleData={vi.fn()} />
            </div>,
        );
        const region = screen.getAllByRole("region").find((element) => element.tabIndex === 0)!;
        expect(region.clientWidth).toBeLessThanOrEqual(360);
        expect(region.scrollWidth).toBeGreaterThan(region.clientWidth);
    });
});

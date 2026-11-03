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
import { InteractiveUiTableView } from "../table/InteractiveUiTableView";
import type { TableCell, TableColumn } from "../table/types";
import type { ChartModel } from "./ChartModel";
import { niceTicks } from "./niceTicks";
import styles from "./InteractiveUiChartView.module.css";

interface Props {
    /** Data prepared by the caller. */
    chart: ChartModel;
    /** Caller-owned data-table mode. */
    showData: boolean;
    /** Request a display-mode change. */
    onToggleData: (show: boolean) => void;
}

const width = 640;
const height = 360;
const left = 88;
const right = 608;
const top = 28;
const bottom = 280;
const markers = ["●", "■", "▲", "◆", "+", "×", "○", "□"];
const dashes = [undefined, "8 4", "2 4", "10 3 2 3", "14 4", "4 4", "10 3 2 3 2 3", "2 2"];

/** Normalize before subtraction to avoid overflow for opposite large finite values. */
function axis(values: number[]): { position: (value: number) => number; ticks: number[] } {
    let min = Math.min(0, ...values);
    let max = Math.max(0, ...values);
    if (min === max) {
        min = 0;
        max = 1;
    }
    const scale = Math.max(Math.abs(min), Math.abs(max));
    const lo = min / scale;
    const span = max / scale - lo;
    return { position: (value) => (value / scale - lo) / span, ticks: niceTicks(min, max, 6) };
}

/** Four SVG chart kinds with non-colour series markers and an equivalent data table. */
export function InteractiveUiChartView({ chart, showData, onToggleData }: Props): JSX.Element {
    const _t = useI18n().translate;
    const patternId = useId();
    const kindLabel = {
        bar: _t("interactive_ui|chart_bar"),
        line: _t("interactive_ui|chart_line"),
        pie: _t("interactive_ui|chart_pie"),
        scatter: _t("interactive_ui|chart_scatter"),
    }[chart.kind];
    const title = chart.title ?? kindLabel;
    const columns: TableColumn[] =
        chart.kind === "scatter"
            ? [
                  { key: "series", label: _t("interactive_ui|series") },
                  { key: "label", label: _t("interactive_ui|category") },
                  { key: "x", label: chart.xLabel ?? _t("interactive_ui|x_axis"), kind: "number" },
                  { key: "y", label: chart.yLabel ?? _t("interactive_ui|y_axis"), kind: "number" },
              ]
            : [
                  {
                      key: "category",
                      label:
                          chart.kind !== "pie"
                              ? (chart.xLabel ?? _t("interactive_ui|category"))
                              : _t("interactive_ui|category"),
                  },
                  ...(chart.kind === "pie"
                      ? [{ key: "value", label: chart.unit ?? _t("interactive_ui|value"), kind: "number" as const }]
                      : chart.series.map((series, index) => ({
                            key: `series${index}`,
                            label: series.name,
                            kind: "number" as const,
                        }))),
              ];
    const rows: TableCell[][] =
        chart.kind === "scatter"
            ? chart.series.flatMap((series) =>
                  series.points.map((point) => [series.name, point.label ?? null, point.x, point.y]),
              )
            : chart.categories.map((category, index) => [
                  category,
                  ...(chart.kind === "pie"
                      ? [chart.values[index]]
                      : chart.series.map((series) => series.values[index])),
              ]);
    const pieExplanation =
        chart.kind === "pie"
            ? chart.values.some((value) => value < 0)
                ? _t("interactive_ui|pie_negative_values")
                : chart.values.every((value) => value === 0)
                  ? _t("interactive_ui|pie_zero_total")
                  : undefined
            : undefined;
    // Keep all values available when pie geometry cannot represent the supplied data.
    const displayData = showData || pieExplanation !== undefined;
    const categoryTickStride =
        chart.kind === "bar" || chart.kind === "line" ? Math.max(1, Math.ceil(chart.categories.length / 5)) : 1;
    const summary = _t("interactive_ui|chart_summary", { title, kind: kindLabel, count: rows.length });
    const yValues =
        chart.kind === "pie"
            ? chart.values
            : chart.kind === "scatter"
              ? chart.series.flatMap((series) => series.points.map((point) => point.y))
              : chart.series.flatMap((series) => series.values);
    const yAxis = axis(yValues);
    const xAxis = axis(
        chart.kind === "scatter" ? chart.series.flatMap((series) => series.points.map((point) => point.x)) : [],
    );
    const y = (value: number): number => bottom - yAxis.position(value) * (bottom - top);
    const x = (value: number): number => left + xAxis.position(value) * (right - left);
    const categoryX = (index: number): number =>
        left + ((index + 0.5) * (right - left)) / (chart.kind === "scatter" ? 1 : Math.max(1, chart.categories.length));
    const names = chart.kind === "pie" ? chart.categories : chart.series.map((series) => series.name);
    const pointTitle = (name: string, value: number): string =>
        `${name}: ${value}${chart.unit ? ` ${chart.unit}` : ""}`;
    const pieSlices = (): JSX.Element[] => {
        if (chart.kind !== "pie" || pieExplanation) return [];
        // Scale before summing so a set of individually finite values cannot overflow its total.
        const scale = Math.max(0, ...chart.values);
        const values = chart.values.map((value) => value / scale);
        const total = values.reduce((sum, value) => sum + value, 0);
        let angle = -Math.PI / 2;
        return values.map((value, index) => {
            const start = angle;
            const portion = total ? value / total : 0;
            angle += portion * Math.PI * 2;
            const radius = 116;
            const cx = 320;
            const cy = 150;
            const sliceTitle = <title>{pointTitle(chart.categories[index], chart.values[index])}</title>;
            const fill = `url(#${patternId}-${index})`;
            if (portion === 1)
                return (
                    <circle key={index} cx={cx} cy={cy} r={radius} fill={fill}>
                        {sliceTitle}
                    </circle>
                );
            if (!portion) return <g key={index}>{sliceTitle}</g>;
            return (
                <path
                    key={index}
                    fill={fill}
                    d={`M ${cx} ${cy} L ${cx + radius * Math.cos(start)} ${cy + radius * Math.sin(start)} A ${radius} ${radius} 0 ${portion > 0.5 ? 1 : 0} 1 ${cx + radius * Math.cos(angle)} ${cy + radius * Math.sin(angle)} Z`}
                >
                    {sliceTitle}
                </path>
            );
        });
    };
    return (
        <div role="group" className={styles.container} aria-label={title}>
            <Text as="p" weight="semibold">
                {title}
            </Text>
            {pieExplanation ? (
                <Text as="p">{pieExplanation}</Text>
            ) : (
                <Button
                    type="button"
                    kind="secondary"
                    size="md"
                    aria-pressed={showData}
                    onClick={() => onToggleData(!showData)}
                >
                    {_t("interactive_ui|data_table")}
                </Button>
            )}
            {displayData ? (
                <InteractiveUiTableView
                    caption={`${title}${chart.unit ? ` (${chart.unit})` : ""}`}
                    columns={columns}
                    rows={rows}
                    sortable={false}
                />
            ) : (
                <>
                    <div className={styles.scroll} tabIndex={0} role="region" aria-label={title}>
                        <svg
                            className={styles.chart}
                            width={width}
                            height={height}
                            viewBox={`0 0 ${width} ${height}`}
                            role="img"
                            aria-label={summary}
                        >
                            <title>{summary}</title>
                            <defs>
                                {names.map((_, index) => (
                                    <pattern
                                        id={`${patternId}-${index}`}
                                        key={index}
                                        patternUnits="userSpaceOnUse"
                                        width={chart.kind === "pie" ? 32 : 16}
                                        height="16"
                                    >
                                        <rect
                                            width={chart.kind === "pie" ? 32 : 16}
                                            height="16"
                                            className={styles.patternBackground}
                                            data-series={index % 8}
                                        />
                                        <text x="3" y="12" className={styles.patternMark}>
                                            {chart.kind === "pie" ? index + 1 : markers[index % 8]}
                                        </text>
                                    </pattern>
                                ))}
                            </defs>
                            {chart.kind === "pie" ? (
                                pieSlices()
                            ) : (
                                <>
                                    {yAxis.ticks.map((tick) => (
                                        <g key={tick}>
                                            <path className={styles.grid} d={`M ${left} ${y(tick)} H ${right}`} />
                                            <text x={left - 8} y={y(tick)} textAnchor="end" dominantBaseline="middle">
                                                {tick}
                                            </text>
                                        </g>
                                    ))}
                                    <path className={styles.axis} d={`M ${left} ${top} V ${bottom} H ${right}`} />
                                    {chart.kind === "scatter"
                                        ? xAxis.ticks.map((tick) => (
                                              <text key={tick} x={x(tick)} y={bottom + 20} textAnchor="middle">
                                                  {tick}
                                              </text>
                                          ))
                                        : chart.categories.map((category, index) =>
                                              index % categoryTickStride === 0 ? (
                                                  <text
                                                      key={index}
                                                      x={categoryX(index)}
                                                      y={bottom + 20}
                                                      textAnchor="middle"
                                                  >
                                                      <title>{category}</title>
                                                      {category.length > 12 ? `${category.slice(0, 11)}…` : category}
                                                  </text>
                                              ) : null,
                                          )}
                                    <text x={(left + right) / 2} y={height - 12} textAnchor="middle">
                                        {chart.xLabel}
                                    </text>
                                    <text
                                        transform={`translate(16 ${(top + bottom) / 2}) rotate(-90)`}
                                        textAnchor="middle"
                                    >
                                        {[chart.yLabel, chart.unit].filter(Boolean).join(" · ")}
                                    </text>
                                    {chart.kind === "bar"
                                        ? chart.series.map((series, seriesIndex) => {
                                              const groupWidth = (right - left) / Math.max(1, chart.categories.length);
                                              const barWidth = (groupWidth * 0.8) / Math.max(1, chart.series.length);
                                              return (
                                                  <g key={seriesIndex}>
                                                      {series.values.map((value, index) => (
                                                          <rect
                                                              key={index}
                                                              x={
                                                                  categoryX(index) -
                                                                  groupWidth * 0.4 +
                                                                  seriesIndex * barWidth
                                                              }
                                                              y={Math.min(y(0), y(value))}
                                                              width={barWidth}
                                                              height={Math.abs(y(value) - y(0))}
                                                              fill={`url(#${patternId}-${seriesIndex})`}
                                                          >
                                                              <title>
                                                                  {pointTitle(
                                                                      `${series.name}, ${chart.categories[index]}`,
                                                                      value,
                                                                  )}
                                                              </title>
                                                          </rect>
                                                      ))}
                                                  </g>
                                              );
                                          })
                                        : chart.series.map((series, seriesIndex) => {
                                              const points =
                                                  "points" in series
                                                      ? series.points.map((point) => ({
                                                            x: x(point.x),
                                                            y: y(point.y),
                                                            label: `${point.label ?? series.name}: ${point.x}, ${point.y}`,
                                                        }))
                                                      : series.values.map((value, index) => ({
                                                            x: categoryX(index),
                                                            y: y(value),
                                                            label: pointTitle(
                                                                `${series.name}, ${chart.kind !== "scatter" ? chart.categories[index] : ""}`,
                                                                value,
                                                            ),
                                                        }));
                                              return (
                                                  <g
                                                      key={seriesIndex}
                                                      data-series={seriesIndex}
                                                      className={styles.series}
                                                  >
                                                      {chart.kind === "line" && (
                                                          <path
                                                              fill="none"
                                                              stroke="currentColor"
                                                              strokeWidth="2"
                                                              strokeDasharray={dashes[seriesIndex % 8]}
                                                              d={points
                                                                  .map(
                                                                      (point, index) =>
                                                                          `${index ? "L" : "M"} ${point.x} ${point.y}`,
                                                                  )
                                                                  .join(" ")}
                                                          />
                                                      )}
                                                      {points.map((point, index) => (
                                                          <text
                                                              key={index}
                                                              className={styles.marker}
                                                              x={point.x}
                                                              y={point.y}
                                                              textAnchor="middle"
                                                              dominantBaseline="central"
                                                          >
                                                              <title>{point.label}</title>
                                                              {markers[seriesIndex % 8]}
                                                          </text>
                                                      ))}
                                                  </g>
                                              );
                                          })}
                                </>
                            )}
                        </svg>
                    </div>
                    <ul className={styles.legend} aria-label={_t("interactive_ui|legend")}>
                        {names.map((name, index) => (
                            <li key={index}>
                                <span aria-hidden={chart.kind !== "pie"}>
                                    {chart.kind === "pie" ? `${index + 1}. ` : `${markers[index % 8]} `}
                                </span>
                                {name}
                            </li>
                        ))}
                    </ul>
                    <Text as="p" size="sm">
                        {summary}
                    </Text>
                </>
            )}
        </div>
    );
}

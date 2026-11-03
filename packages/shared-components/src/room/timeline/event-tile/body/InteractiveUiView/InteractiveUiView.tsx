/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

// Catalog lists have no item IDs; their stable snapshot positions identify them.
/* oxlint-disable react/no-array-index-key */
// The carousel scroll region must be focusable for arrow-key navigation.
/* oxlint-disable jsx-a11y/no-noninteractive-tabindex */
import React, { type JSX, type ReactNode, useEffect, useId, useRef } from "react";
import { Button, Heading, Separator, Text } from "@vector-im/compound-web";
import parse, { domToReact, Element, type DOMNode, type HTMLReactParserOptions } from "html-react-parser";

import { useViewModel } from "../../../../../core/viewmodel";
import { useI18n } from "../../../../../core/i18n/i18nContext";
import { Flex } from "../../../../../core/utils/Flex";
import { InteractiveUiGraphView } from "./graph";
import { InteractiveUiChartView } from "./chart";
import { InteractiveUiTableView } from "./table";
import type { InteractiveUiRenderNode, InteractiveUiViewModel } from "./types";
import styles from "./InteractiveUiView.module.css";

interface Props {
    /** Observable, resolved tree and view actions. */
    vm: InteractiveUiViewModel;
    /** Complete textual event body, displayed when text mode is selected. */
    fallback: ReactNode;
}

// Sanitized anchors and disclosures are static: explicit catalog nodes own interaction.
const richTextOptions: HTMLReactParserOptions = {
    replace: (node) => {
        if (node instanceof Element && ["a", "details", "summary"].includes(node.name)) {
            return <span>{domToReact(node.children as DOMNode[], richTextOptions)}</span>;
        }
    },
};

interface NodeProps {
    node: InteractiveUiRenderNode;
    vm: InteractiveUiViewModel;
    inactive: boolean;
}

function Carousel({
    node,
    vm,
    inactive,
}: NodeProps & { node: Extract<InteractiveUiRenderNode, { kind: "carousel" }> }): JSX.Element {
    const _t = useI18n().translate;
    const track = useRef<HTMLDivElement>(null);
    const trackWidth = useRef(0);
    useEffect(() => {
        const element = track.current;
        if (!element) return;
        const alignSelectedItem = (): void => {
            trackWidth.current = element.clientWidth;
            const item = element.children[node.index] as HTMLElement | undefined;
            if (trackWidth.current > 0 && item) element.scrollTo({ left: item.offsetLeft, behavior: "instant" });
        };
        alignSelectedItem();
        const observer = new ResizeObserver(() => {
            if (element.clientWidth !== trackWidth.current) alignSelectedItem();
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, [node.index, node.items.length]);
    const multiple = node.items.length > 1;
    return (
        <section
            role="group"
            aria-label={node.label}
            aria-roledescription={_t("interactive_ui|carousel")}
            className={styles.carousel}
        >
            {multiple && (
                <Flex align="center" wrap="wrap" gap="var(--cpd-space-2x)">
                    <Button
                        type="button"
                        kind="secondary"
                        size="md"
                        disabled={inactive || node.index === 0}
                        onClick={() => !inactive && vm.setCarouselIndex(node.id, node.index - 1)}
                    >
                        {_t("interactive_ui|previous_item")}
                    </Button>
                    <Button
                        type="button"
                        kind="secondary"
                        size="md"
                        disabled={inactive || node.index === node.items.length - 1}
                        onClick={() => !inactive && vm.setCarouselIndex(node.id, node.index + 1)}
                    >
                        {_t("interactive_ui|next_item")}
                    </Button>
                </Flex>
            )}
            <Text as="p" size="sm" aria-live="polite" aria-atomic="true">
                {_t("interactive_ui|item_position", { index: node.index + 1, count: node.items.length })}
            </Text>
            <div
                ref={track}
                className={styles.carouselTrack}
                role="group"
                aria-label={node.label}
                tabIndex={multiple && !inactive ? 0 : undefined}
                aria-disabled={inactive}
                onKeyDown={(event) => {
                    if (inactive || event.target !== event.currentTarget) return;
                    const index =
                        event.key === "ArrowRight"
                            ? node.index + 1
                            : event.key === "ArrowLeft"
                              ? node.index - 1
                              : undefined;
                    if (index !== undefined) {
                        event.preventDefault();
                        if (index >= 0 && index < node.items.length) vm.setCarouselIndex(node.id, index);
                    }
                }}
                onScroll={(event) => {
                    if (inactive) return;
                    const element = event.currentTarget;
                    // Layout can clamp scrollLeft before ResizeObserver runs, including a briefly collapsed track.
                    if (element.clientWidth === 0 || element.clientWidth !== trackWidth.current) return;
                    const positions = Array.from(element.children, (item) =>
                        Math.abs((item as HTMLElement).offsetLeft - element.scrollLeft),
                    );
                    const index = positions.indexOf(Math.min(...positions));
                    if (index !== node.index) vm.setCarouselIndex(node.id, index);
                }}
            >
                {node.items.map((item) => (
                    <article key={item.id} className={styles.carouselCard} aria-label={item.title}>
                        {item.src && <img className={styles.image} src={item.src} alt={item.alt} />}
                        {!item.src && item.alt && (
                            <Text as="p" className={styles.muted}>
                                {item.alt}
                            </Text>
                        )}
                        <Text as="p" weight="semibold">
                            {item.title}
                        </Text>
                        {item.subtitle && <Text as="p">{item.subtitle}</Text>}
                        {item.meta.map((line, index) => (
                            <Text as="p" size="sm" key={index}>
                                {line}
                            </Text>
                        ))}
                        {item.badge && (
                            <span className={styles.badge} data-tone={item.badge.tone}>
                                {item.badge.text}
                            </span>
                        )}
                        {item.actionLabel && (
                            <Button
                                type="button"
                                size="md"
                                disabled={inactive || item.disabled}
                                onClick={() => !inactive && !item.disabled && vm.activateCarouselItem(node.id, item.id)}
                            >
                                {item.actionLabel}
                            </Button>
                        )}
                    </article>
                ))}
            </div>
        </section>
    );
}

function RenderNode({ node, vm, inactive: parentInactive }: NodeProps): JSX.Element {
    const inactive = parentInactive || ("disabled" in node && node.disabled) || ("pending" in node && node.pending);
    const _t = useI18n().translate;
    const controlId = useId();
    const children = (nodes: InteractiveUiRenderNode[]): ReactNode =>
        nodes.map((child) => <RenderNode key={child.id} node={child} vm={vm} inactive={inactive} />);
    const error = (
        <Text as="p" size="sm" id={`${controlId}-error`} className={styles.error}>
            {_t("interactive_ui|invalid_value")}
        </Text>
    );
    switch (node.kind) {
        case "stack":
            return (
                <Flex
                    className={styles.stack}
                    direction={node.direction === "horizontal" ? "row" : "column"}
                    wrap="wrap"
                    gap={
                        { none: "0", sm: "var(--cpd-space-2x)", md: "var(--cpd-space-4x)", lg: "var(--cpd-space-6x)" }[
                            node.gap
                        ]
                    }
                >
                    {children(node.children)}
                </Flex>
            );
        case "card":
            return (
                <section className={styles.card} aria-label={node.title}>
                    {node.title && (
                        <Heading as="h3" size="sm">
                            {node.title}
                        </Heading>
                    )}
                    {children(node.children)}
                </section>
            );
        case "tabs":
            return (
                <div className={styles.stack}>
                    <Flex role="tablist" aria-label={_t("interactive_ui|tabs")} wrap="wrap" gap="var(--cpd-space-2x)">
                        {node.tabs.map((tab, index) => (
                            <button
                                className={styles.tab}
                                key={tab.value}
                                type="button"
                                role="tab"
                                id={`${controlId}-tab-${index}`}
                                aria-controls={`${controlId}-panel-${index}`}
                                aria-selected={tab.value === node.selected}
                                tabIndex={tab.value === node.selected ? 0 : -1}
                                disabled={inactive}
                                onClick={() => !inactive && vm.setValue(node.id, tab.value)}
                                onKeyDown={(event) => {
                                    if (inactive) return;
                                    const next =
                                        event.key === "ArrowRight"
                                            ? (index + 1) % node.tabs.length
                                            : event.key === "ArrowLeft"
                                              ? (index + node.tabs.length - 1) % node.tabs.length
                                              : event.key === "Home"
                                                ? 0
                                                : event.key === "End"
                                                  ? node.tabs.length - 1
                                                  : undefined;
                                    if (next !== undefined) {
                                        event.preventDefault();
                                        vm.setValue(node.id, node.tabs[next].value);
                                        document.getElementById(`${controlId}-tab-${next}`)?.focus();
                                    }
                                }}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </Flex>
                    {node.tabs.map((tab, index) => (
                        <div
                            key={tab.value}
                            role="tabpanel"
                            id={`${controlId}-panel-${index}`}
                            aria-labelledby={`${controlId}-tab-${index}`}
                            hidden={tab.value !== node.selected}
                        >
                            {tab.value === node.selected && children([tab.content])}
                        </div>
                    ))}
                </div>
            );
        case "collapsible":
            return (
                <section className={styles.stack}>
                    <Button
                        type="button"
                        kind="secondary"
                        size="md"
                        aria-expanded={node.open}
                        aria-controls={controlId}
                        disabled={inactive}
                        onClick={() => !inactive && vm.setValue(node.id, !node.open)}
                    >
                        {node.label}
                    </Button>
                    <div id={controlId} hidden={!node.open}>
                        {node.open && children(node.children)}
                    </div>
                </section>
            );
        case "divider":
            return <Separator className={styles.divider} />;
        case "heading":
            return (
                <Heading
                    as={node.level === 1 ? "h1" : node.level === 2 ? "h2" : "h3"}
                    size={node.level === 1 ? "lg" : "md"}
                >
                    {node.text}
                </Heading>
            );
        case "text":
            return (
                <Text
                    as="p"
                    className={styles.prose}
                    data-tone={node.tone}
                    size={node.size === "caption" ? "sm" : "md"}
                    weight={node.tone === "emphasis" ? "semibold" : "regular"}
                >
                    {node.text}
                </Text>
            );
        case "rich_text":
            return (
                <div className={styles.prose}>
                    {node.safeHtml !== undefined ? (
                        parse(node.safeHtml, richTextOptions)
                    ) : (
                        <Text as="p">{node.text}</Text>
                    )}
                </div>
            );
        case "badge":
            return (
                <span className={styles.badge} data-tone={node.tone}>
                    {node.text}
                </span>
            );
        case "key_value":
            return (
                <dl className={styles.keyValue}>
                    {node.items.map((item, index) => (
                        <div key={index}>
                            <Text as="dt" weight="semibold">
                                {item.label}
                            </Text>
                            <Text as="dd">{item.value}</Text>
                        </div>
                    ))}
                </dl>
            );
        case "list": {
            const List = node.ordered ? "ol" : "ul";
            return (
                <List>
                    {node.items.map((item, index) => (
                        <li key={index}>
                            <Text as="span">{item.text}</Text>
                            {item.secondary && (
                                <Text as="p" size="sm" className={styles.muted}>
                                    {item.secondary}
                                </Text>
                            )}
                        </li>
                    ))}
                </List>
            );
        }
        case "image":
            return node.src ? (
                <img className={styles.image} src={node.src} alt={node.alt} width={node.width} height={node.height} />
            ) : (
                <Text as="p" className={styles.muted}>
                    {node.alt}
                </Text>
            );
        case "table":
            return (
                <fieldset className={styles.fieldset} disabled={inactive} aria-disabled={inactive}>
                    <InteractiveUiTableView
                        {...node}
                        onSort={(key) => {
                            if (!inactive) vm.sortTable(node.id, key);
                        }}
                    />
                </fieldset>
            );
        case "chart":
            return (
                <fieldset className={styles.fieldset} disabled={inactive} aria-disabled={inactive}>
                    <InteractiveUiChartView
                        chart={node.chart}
                        showData={node.showData}
                        onToggleData={(show) => {
                            if (!inactive) vm.setChartDataMode(node.id, show);
                        }}
                    />
                </fieldset>
            );
        case "graph":
            return (
                <fieldset className={styles.fieldset} disabled={inactive}>
                    <InteractiveUiGraphView
                        layout={node.graph}
                        selectedId={node.selectedId}
                        showAsList={node.showAsList}
                        onSelect={(id) => !inactive && vm.selectGraphNode(node.id, id)}
                        onToggleList={(asList) => !inactive && vm.setGraphListMode(node.id, asList)}
                    />
                </fieldset>
            );
        case "button":
            return (
                <Button
                    type="button"
                    size="md"
                    kind={node.variant === "danger" ? "primary" : node.variant}
                    destructive={node.variant === "danger"}
                    disabled={inactive || node.disabled || node.pending}
                    aria-busy={node.pending}
                    onClick={() => !inactive && vm.activate(node.id)}
                >
                    {node.label}
                    {node.external && <span className={styles.muted}> ({_t("interactive_ui|external_link")})</span>}
                </Button>
            );
        case "select":
            return (
                <label className={styles.control}>
                    <Text as="span">{node.label}</Text>
                    <select
                        value={typeof node.value === "string" || Array.isArray(node.value) ? node.value : ""}
                        multiple={node.multiple}
                        disabled={inactive || node.disabled}
                        onChange={(event) =>
                            !inactive &&
                            vm.setValue(
                                node.id,
                                node.multiple
                                    ? Array.from(event.target.selectedOptions, (option) => option.value)
                                    : event.target.value,
                            )
                        }
                    >
                        {!node.multiple && (
                            <option value="" disabled>
                                {_t("interactive_ui|choose_option")}
                            </option>
                        )}
                        {node.options.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                </label>
            );
        case "choice":
            return (
                <fieldset className={styles.control} disabled={inactive || node.disabled}>
                    <legend>
                        <Text as="span">{node.label}</Text>
                    </legend>
                    {node.options.map((option) => (
                        <label key={option.value} className={styles.option}>
                            <input
                                type={node.multiple ? "checkbox" : "radio"}
                                name={controlId}
                                value={option.value}
                                checked={
                                    node.multiple
                                        ? Array.isArray(node.value) && node.value.includes(option.value)
                                        : node.value === option.value
                                }
                                onChange={(event) =>
                                    !inactive &&
                                    vm.setValue(
                                        node.id,
                                        node.multiple
                                            ? event.target.checked
                                                ? [...(Array.isArray(node.value) ? node.value : []), option.value]
                                                : (Array.isArray(node.value) ? node.value : []).filter(
                                                      (value) => value !== option.value,
                                                  )
                                            : option.value,
                                    )
                                }
                            />
                            <Text as="span">{option.label}</Text>
                        </label>
                    ))}
                </fieldset>
            );
        case "toggle":
            return (
                <label className={styles.option}>
                    <input
                        type="checkbox"
                        role="switch"
                        aria-checked={node.value}
                        checked={node.value}
                        disabled={inactive || node.disabled}
                        onChange={(event) => !inactive && vm.setValue(node.id, event.target.checked)}
                    />
                    <Text as="span">{node.label}</Text>
                </label>
            );
        case "text_input": {
            const Input = node.multiline ? "textarea" : "input";
            return (
                <div className={styles.control}>
                    <label htmlFor={controlId}>
                        <Text as="span">{node.label}</Text>
                    </label>
                    <Input
                        id={controlId}
                        value={node.value}
                        placeholder={node.placeholder}
                        maxLength={node.maxLength}
                        required={node.required}
                        aria-invalid={node.invalid}
                        aria-describedby={node.invalid ? `${controlId}-error` : undefined}
                        disabled={inactive || node.disabled}
                        onChange={(event) => !inactive && vm.setValue(node.id, event.target.value)}
                    />
                    {node.invalid && error}
                </div>
            );
        }
        case "number_input":
            return (
                <div className={styles.control}>
                    <label htmlFor={controlId}>
                        <Text as="span">{node.label}</Text>
                    </label>
                    <input
                        id={controlId}
                        type={node.display === "slider" ? "range" : "number"}
                        value={node.value ?? ""}
                        min={node.min}
                        max={node.max}
                        step={node.step}
                        aria-invalid={node.invalid}
                        aria-describedby={node.invalid ? `${controlId}-error` : undefined}
                        disabled={inactive || node.disabled}
                        onChange={(event) =>
                            !inactive &&
                            vm.setValue(node.id, event.target.value === "" ? null : event.target.valueAsNumber)
                        }
                    />
                    {node.invalid && error}
                </div>
            );
        case "form": {
            const submit = (): void => {
                if (!inactive) vm.submitForm(node.id);
            };
            return (
                <div
                    role="form"
                    aria-label={node.submitLabel}
                    onSubmit={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        submit();
                    }}
                    onKeyDown={(event) => {
                        // IME candidate confirmation must retain its default behavior and never submit.
                        if (event.nativeEvent.isComposing) return;
                        // The nearest catalog form owns Enter in a single-line field. Textareas retain newlines.
                        if (
                            event.key === "Enter" &&
                            event.target instanceof HTMLInputElement &&
                            ["text", "number"].includes(event.target.type)
                        ) {
                            event.preventDefault();
                            event.stopPropagation();
                            submit();
                        }
                    }}
                >
                    <fieldset className={styles.fieldset} disabled={inactive} aria-busy={node.pending}>
                        {children(node.children)}
                        <Button type="button" size="md" disabled={inactive} aria-busy={node.pending} onClick={submit}>
                            {node.submitLabel}
                        </Button>
                    </fieldset>
                </div>
            );
        }
        case "carousel":
            return <Carousel node={node} vm={vm} inactive={inactive} />;
        case "link":
            return (
                <Button
                    type="button"
                    kind="secondary"
                    size="md"
                    disabled={inactive}
                    onClick={() => !inactive && vm.openLink(node.id)}
                >
                    <span>
                        {node.label} · {node.host}{" "}
                        <span className={styles.muted}>
                            (
                            {node.sourceKind === "source"
                                ? _t("interactive_ui|source")
                                : _t("interactive_ui|external_link")}
                            )
                        </span>
                    </span>
                </Button>
            );
        case "unknown":
            return (
                <Text as="p" className={styles.muted}>
                    {node.fallback ?? _t("interactive_ui|unknown_content")}
                </Text>
            );
    }
}

/** Draws a resolved interactive tree, routing every request back to its view model. */
export function InteractiveUiView({ vm, fallback }: Props): JSX.Element {
    const snapshot = useViewModel(vm);
    const _t = useI18n().translate;
    const statuses = {
        active: _t("interactive_ui|status_active"),
        sending: _t("interactive_ui|status_sending"),
        awaiting_confirmation: _t("interactive_ui|status_awaiting"),
        submitted: _t("interactive_ui|status_submitted"),
        expired: _t("interactive_ui|status_expired"),
        superseded: _t("interactive_ui|status_superseded"),
    };
    return (
        <section className={styles.root} aria-label={snapshot.title ?? _t("interactive_ui|interactive_content")}>
            {snapshot.title && (
                <Heading as="h2" size="md">
                    {snapshot.title}
                </Heading>
            )}
            <div role="status" className={styles.status}>
                <Text as="p">{snapshot.statusText ?? statuses[snapshot.status]}</Text>
                {snapshot.confirmationOverdue && (
                    <>
                        <Text as="p">{_t("interactive_ui|confirmation_overdue")}</Text>
                        <Button type="button" kind="secondary" size="md" onClick={vm.retryAfterOverdue}>
                            {_t("interactive_ui|try_again")}
                        </Button>
                    </>
                )}
            </div>
            <Button
                type="button"
                kind="secondary"
                size="md"
                aria-pressed={snapshot.showAsText}
                onClick={() => vm.setShowAsText(!snapshot.showAsText)}
            >
                {_t("interactive_ui|show_as_text")}
            </Button>
            {snapshot.showAsText ? (
                fallback
            ) : (
                <RenderNode node={snapshot.root} vm={vm} inactive={snapshot.status !== "active"} />
            )}
        </section>
    );
}

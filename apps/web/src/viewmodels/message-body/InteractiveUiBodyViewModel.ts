/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
    BaseViewModel,
    layoutLayeredGraph,
    type InteractiveUiRenderNode,
    type InteractiveUiViewActions,
    type InteractiveUiViewSnapshot,
    type InteractiveUiValue,
} from "@element-hq/web-shared-components";
import { sanitizeHtml } from "@element-hq/element-web-shared-utils";
import { type RoomMessageEventContent } from "matrix-js-sdk/src/types";
import { MatrixEvent, MatrixEventEvent, type MatrixClient, EventType, MsgType } from "matrix-js-sdk/src/matrix";

import {
    acceptsStateValue,
    parseInteractiveUi,
    type ImageNode,
    type InteractiveUiAction,
    type InteractiveUiNode,
    type ParseResult,
} from "../../interactive-ui/protocol";
import { evaluateCondition, mergeSavedState, validateSubmission } from "../../interactive-ui/state";
import { buildActionContent } from "../../interactive-ui/action";
import { sanitizeHtmlParams } from "../../Linkify";
import { MediaEventHelper } from "../../utils/MediaEventHelper";
import Modal from "../../Modal";
import QuestionDialog from "../../components/views/dialogs/QuestionDialog";
import { _t } from "../../languageHandler";

/** Dependencies for one original timeline event, including its subsequent edits. */
export interface InteractiveUiBodyViewModelProps {
    mxEvent: MatrixEvent;
    client: MatrixClient;
    /** Parsed payload; the caller already handled invalid content. */
    parsed: Extract<ParseResult, { ok: true }>;
    /** Returned blob URLs belong to this view model and are revoked on replacement/disposal. */
    mediaResolver?: (node: ImageNode) => Promise<string | undefined>;
    confirmOpenUrl?: (url: string) => Promise<boolean>;
    storage?: Pick<Storage, "getItem" | "setItem">;
    now?: () => number;
}

/** Resolves declarative event content into a view and sends explicit, validated action replies. */
export class InteractiveUiBodyViewModel
    extends BaseViewModel<InteractiveUiViewSnapshot, InteractiveUiBodyViewModelProps>
    implements InteractiveUiViewActions
{
    private parsed: InteractiveUiBodyViewModelProps["parsed"];
    private state: Record<string, InteractiveUiValue>;
    private readonly storageKey: string;
    private readonly storage: InteractiveUiBodyViewModelProps["storage"];
    private persistTimer?: ReturnType<typeof setTimeout>;
    private confirmationTimer?: ReturnType<typeof setTimeout>;
    private sendInFlight = false;
    private valid = true;
    private mediaGeneration = 0;
    private readonly media = new Map<string, string>();
    private readonly mediaHelpers = new Set<MediaEventHelper>();
    private readonly invalidKeys = new Set<string>();
    // Invalid field drafts stay outside validated state used by persistence and declarative actions.
    private readonly numberDrafts = new Map<string, number | null>();
    private readonly localValues = new Map<string, InteractiveUiValue>();
    private readonly graphLists = new Set<string>();
    private readonly chartData = new Set<string>();
    private readonly tableSort = new Map<string, { key: string; dir: "asc" | "desc" }>();
    private readonly carouselIndices = new Map<string, number>();
    private readonly visibleIds = new Set<string>();

    public constructor(props: InteractiveUiBodyViewModelProps) {
        super(props, {
            title: props.parsed.payload.title,
            status: props.parsed.payload.status,
            statusText: props.parsed.payload.status_text,
            confirmationOverdue: false,
            root: { kind: "unknown", id: props.parsed.payload.root },
            showAsText: false,
        });
        this.parsed = props.parsed;
        this.storageKey = `mx_interactive_ui:${props.mxEvent.getRoomId()}:${props.mxEvent.getId()}`;
        let saved: unknown;
        try {
            this.storage = props.storage ?? window.localStorage;
            const json = this.storage.getItem(this.storageKey);
            if (json) saved = JSON.parse(json);
        } catch {
            // Storage can be blocked by the browser or contain corrupt data.
        }
        this.state = mergeSavedState(this.parsed.payload, saved);
        this.disposables.trackListener(props.mxEvent, MatrixEventEvent.Replaced, this.onReplaced);
        this.disposables.trackListener(props.mxEvent, MatrixEventEvent.BeforeRedaction, this.onRedacted);
        this.disposables.track(() => {
            clearTimeout(this.persistTimer);
            clearTimeout(this.confirmationTimer);
            this.persist();
            this.clearMedia();
        });
        this.rebuild();
        this.resolveMedia();
    }

    private persist = (): void => {
        if (!this.valid) return;
        try {
            this.storage?.setItem(
                this.storageKey,
                JSON.stringify({
                    ui_id: this.parsed.payload.ui_id,
                    revision: this.parsed.payload.revision,
                    state: this.state,
                }),
            );
        } catch {
            // Local persistence is optional, including when storage quota is exhausted.
        }
    };

    private changed = (): void => {
        clearTimeout(this.persistTimer);
        this.persistTimer = setTimeout(this.persist, 200);
        this.rebuild();
    };

    private onRedacted = (): void => {
        this.valid = false;
        clearTimeout(this.confirmationTimer);
        clearTimeout(this.persistTimer);
        this.clearMedia();
        this.snapshot.merge({ showAsText: true, status: "expired", confirmationOverdue: false });
        this.rebuild();
    };

    private onReplaced = (): void => {
        const parsed = parseInteractiveUi(this.props.mxEvent.getContent());
        if (this.props.mxEvent.isRedacted() || !parsed?.ok) {
            this.onRedacted();
            return;
        }
        if (parsed.payload.revision <= this.parsed.payload.revision) return;
        const previous = this.parsed.payload;
        this.parsed = parsed;
        this.state = mergeSavedState(parsed.payload, {
            ui_id: previous.ui_id,
            revision: previous.revision,
            state: this.state,
        });
        this.valid = true;
        clearTimeout(this.confirmationTimer);
        this.invalidKeys.clear();
        this.numberDrafts.clear();
        this.localValues.clear();
        this.graphLists.clear();
        this.chartData.clear();
        this.tableSort.clear();
        this.carouselIndices.clear();
        this.snapshot.merge({
            title: parsed.payload.title,
            status: this.sendInFlight && parsed.payload.status === "active" ? "sending" : parsed.payload.status,
            statusText: parsed.payload.status_text,
            confirmationOverdue: false,
        });
        this.clearMedia();
        this.changed();
        this.resolveMedia();
    };

    private get active(): boolean {
        return !this.isDisposed && this.valid && !this.sendInFlight && this.snapshot.current.status === "active";
    }

    private node = (id: string): InteractiveUiNode | undefined =>
        this.visibleIds.has(id) ? this.parsed.nodesById.get(id) : undefined;

    private updateValue = (key: string, value: InteractiveUiValue): void => {
        if (!acceptsStateValue(this.parsed.payload, key, value)) return;
        this.state[key] = Array.isArray(value) ? [...value] : value;
        this.invalidKeys.delete(key);
        this.numberDrafts.delete(key);
        this.changed();
    };

    public setValue = (nodeId: string, value: InteractiveUiValue): void => {
        if (!this.active) return;
        const node = this.node(nodeId);
        if (!node) return;
        if (node.type === "number_input" && node.display !== "slider") {
            if (value !== null && (typeof value !== "number" || !Number.isFinite(value))) return;
            if (value === null || !acceptsStateValue(this.parsed.payload, node.bind, value)) {
                this.numberDrafts.set(node.bind, value);
                this.rebuild();
            } else this.updateValue(node.bind, value);
        } else if ("bind" in node && node.bind) this.updateValue(node.bind, value);
        else if (node.type === "collapsible" && typeof value === "boolean") {
            this.localValues.set(nodeId, value);
            this.rebuild();
        }
    };

    public selectGraphNode = (nodeId: string, graphNodeId: string | null): void => {
        if (!this.active) return;
        const node = this.node(nodeId);
        if (node?.type !== "graph" || (graphNodeId !== null && !node.nodes.some((n) => n.id === graphNodeId))) return;
        if (node.bind_selected) this.updateValue(node.bind_selected, graphNodeId);
        else {
            this.localValues.set(nodeId, graphNodeId);
            this.rebuild();
        }
    };

    public setGraphListMode = (id: string, asList: boolean): void => {
        if (!this.active || this.node(id)?.type !== "graph") return;
        if (asList) this.graphLists.add(id);
        else this.graphLists.delete(id);
        this.rebuild();
    };

    public setChartDataMode = (id: string, showData: boolean): void => {
        if (!this.active || this.node(id)?.type !== "chart") return;
        if (showData) this.chartData.add(id);
        else this.chartData.delete(id);
        this.rebuild();
    };

    public sortTable = (id: string, key: string): void => {
        const node = this.node(id);
        if (!this.active || node?.type !== "table" || !node.sortable || !node.columns.some((c) => c.key === key))
            return;
        const old = this.tableSort.get(id);
        this.tableSort.set(id, { key, dir: old?.key === key && old.dir === "asc" ? "desc" : "asc" });
        this.rebuild();
    };

    public setShowAsText = (showAsText: boolean): void => {
        if (!this.isDisposed) this.snapshot.merge({ showAsText: showAsText || !this.valid });
    };

    public setCarouselIndex = (id: string, index: number): void => {
        const node = this.node(id);
        if (
            !this.active ||
            node?.type !== "carousel" ||
            !Number.isInteger(index) ||
            index < 0 ||
            index >= node.items.length
        )
            return;
        this.carouselIndices.set(id, index);
        this.rebuild();
    };

    public activate = (id: string): void => {
        if (!this.active) return;
        const node = this.node(id);
        if (node?.type === "button") this.perform(node.action, id, node.label);
    };

    public activateCarouselItem = (id: string, itemId: string): void => {
        if (!this.active) return;
        const node = this.node(id);
        const item = node?.type === "carousel" ? node.items.find((i) => i.id === itemId) : undefined;
        if (item?.action) this.perform(item.action, id, item.title, itemId);
    };

    public submitForm = (id: string): void => {
        if (!this.active) return;
        const node = this.node(id);
        if (node?.type === "form") void this.send(id, node.submit_label, node.single_use ?? true);
    };

    public openLink = (id: string): void => {
        if (!this.active) return;
        const node = this.node(id);
        if (node?.type === "link") void this.openUrl(node.url);
    };

    private perform = (action: InteractiveUiAction, id: string, label: string, itemId?: string): void => {
        switch (action.type) {
            case "set_state":
                this.updateValue(action.key, action.value);
                break;
            case "toggle_state":
                this.updateValue(action.key, !this.state[action.key]);
                break;
            case "open_url":
                void this.openUrl(action.url);
                break;
            case "submit":
                void this.send(id, label, action.single_use ?? false, itemId);
                break;
        }
    };

    private openUrl = async (url: string): Promise<void> => {
        if (new URL(url).protocol !== "https:") return;
        const parsed = this.parsed;
        const confirmed = this.props.confirmOpenUrl
            ? await this.props.confirmOpenUrl(url)
            : (
                  await Modal.createDialog(QuestionDialog, {
                      title: _t("interactive_ui|open_link"),
                      description: url,
                      button: _t("action|continue"),
                  }).finished
              )[0];
        if (confirmed && this.active && this.parsed === parsed) window.open(url, "_blank", "noopener,noreferrer");
    };

    private send = async (id: string, label: string, singleUse: boolean, itemId?: string): Promise<void> => {
        const parsed = this.parsed;
        const submissionState = { ...this.state, ...Object.fromEntries(this.numberDrafts) };
        const result = validateSubmission(parsed.payload, id, submissionState, itemId);
        this.invalidKeys.clear();
        if (!result.ok) {
            result.invalidKeys.forEach((key) => this.invalidKeys.add(key));
            this.rebuild();
            return;
        }
        // Null is a valid protocol state value, but an empty number field is not a completed answer.
        const invalidDrafts = Object.keys(result.values).filter((key) => this.numberDrafts.has(key));
        if (invalidDrafts.length) {
            invalidDrafts.forEach((key) => this.invalidKeys.add(key));
            this.rebuild();
            return;
        }
        this.sendInFlight = true;
        this.snapshot.merge({ status: "sending", statusText: undefined, confirmationOverdue: false });
        this.rebuild();
        try {
            const bytes = crypto.getRandomValues(new Uint8Array(24));
            const nonce = btoa(String.fromCharCode(...bytes))
                .replaceAll("+", "-")
                .replaceAll("/", "_")
                .replaceAll("=", "");
            const content = buildActionContent({
                uiEvent: this.props.mxEvent,
                payload: parsed.payload,
                actionId: result.actionId,
                values: result.values,
                triggerLabel: label,
                nonce,
            });
            await this.props.client.sendMessage(
                this.props.mxEvent.getRoomId()!,
                this.props.mxEvent.threadRootId ?? null,
                // The action helper builds SDK reply/thread relations; its extension type uses IEventRelation.
                content as RoomMessageEventContent,
            );
            if (this.isDisposed || !this.valid) return;
            // An edit received during the request owns the result, even if it remains active.
            const awaiting = this.parsed === parsed && singleUse;
            this.snapshot.merge({
                status: awaiting ? "awaiting_confirmation" : this.parsed.payload.status,
                statusText: this.parsed.payload.status_text,
            });
            if (awaiting) {
                const started = (this.props.now ?? Date.now)();
                this.confirmationTimer = setTimeout(() => {
                    if (this.isDisposed || this.parsed !== parsed) return;
                    if ((this.props.now ?? Date.now)() - started >= 8000) {
                        this.snapshot.merge({
                            confirmationOverdue: true,
                            statusText: _t("interactive_ui|waiting_for_sender", {
                                sender: this.props.mxEvent.getSender() ?? "",
                            }),
                        });
                    }
                }, 8000);
            }
        } catch {
            if (!this.isDisposed && this.valid)
                this.snapshot.merge({
                    status: this.parsed.payload.status,
                    statusText:
                        this.parsed === parsed ? _t("interactive_ui|send_failed") : this.parsed.payload.status_text,
                });
        } finally {
            this.sendInFlight = false;
            if (!this.isDisposed) this.rebuild();
        }
    };

    public retryAfterOverdue = (): void => {
        if (
            this.isDisposed ||
            !this.valid ||
            !this.snapshot.current.confirmationOverdue ||
            this.parsed.payload.status !== "active"
        )
            return;
        clearTimeout(this.confirmationTimer);
        this.snapshot.merge({
            status: "active",
            statusText: this.parsed.payload.status_text,
            confirmationOverdue: false,
        });
        this.rebuild();
    };

    private clearMedia = (): void => {
        this.mediaGeneration++;
        if (this.props.mediaResolver)
            for (const src of this.media.values()) if (src.startsWith("blob:")) URL.revokeObjectURL(src);
        this.media.clear();
        for (const helper of this.mediaHelpers) helper.destroy();
        this.mediaHelpers.clear();
    };

    private resolveMedia = (): void => {
        const generation = this.mediaGeneration;
        const images: ImageNode[] = [];
        for (const node of this.parsed.payload.nodes) {
            if (node.type === "image") images.push(node);
            if (node.type === "carousel")
                for (const item of node.items)
                    images.push({
                        ...item.image,
                        id: `${node.id}/${item.id}`,
                        type: "image",
                    });
        }
        for (const image of images) void this.resolveImage(image, generation);
    };

    private resolveImage = async (image: ImageNode, generation: number): Promise<void> => {
        let helper: MediaEventHelper | undefined;
        try {
            let src: string | undefined;
            if (this.props.mediaResolver) src = await this.props.mediaResolver(image);
            else {
                helper = new MediaEventHelper(
                    new MatrixEvent({
                        type: EventType.RoomMessage,
                        content: {
                            msgtype: MsgType.Image,
                            body: image.alt,
                            url: image.url,
                            file: image.file,
                            info: { mimetype: image.mimetype, w: image.width, h: image.height },
                        },
                    }),
                );
                this.mediaHelpers.add(helper);
                src = (await helper.sourceUrl.value) ?? undefined;
            }
            if (this.isDisposed || generation !== this.mediaGeneration) {
                if (!helper && src?.startsWith("blob:")) URL.revokeObjectURL(src);
                helper?.destroy();
                return;
            }
            if (src) this.media.set(image.id, src);
            this.rebuild();
        } catch {
            // Images remain accessible through their alt text when media cannot be resolved.
            helper?.destroy();
        }
    };

    private rebuild = (): void => {
        this.visibleIds.clear();
        const disabled = !this.active;
        const pending = this.sendInFlight;
        const render = (id: string): InteractiveUiRenderNode | undefined => {
            const node = this.parsed.nodesById.get(id);
            if (!node || (node.visible_when && !evaluateCondition(node.visible_when, this.state))) return;
            this.visibleIds.add(id);
            const children = (ids: string[]): InteractiveUiRenderNode[] =>
                ids.flatMap((child) => {
                    const result = render(child);
                    return result ? [result] : [];
                });
            const base = { id };
            switch (node.type) {
                case "stack":
                    return {
                        ...base,
                        kind: "stack",
                        direction: node.direction,
                        gap: node.gap ?? "md",
                        children: children(node.children),
                    };
                case "card":
                    return { ...base, kind: "card", title: node.title, children: children(node.children) };
                case "tabs":
                    return {
                        ...base,
                        kind: "tabs",
                        selected: String(this.state[node.bind] ?? ""),
                        tabs: node.tabs.flatMap((tab) => {
                            const content = render(tab.child);
                            return content ? [{ value: tab.value, label: tab.label, content }] : [];
                        }),
                    };
                case "collapsible":
                    return {
                        ...base,
                        kind: "collapsible",
                        label: node.label,
                        open: Boolean(node.bind ? this.state[node.bind] : this.localValues.get(id)),
                        children: children(node.children),
                    };
                case "divider":
                    return { ...base, kind: "divider" };
                case "heading":
                    return { ...base, kind: "heading", text: node.text, level: node.level };
                case "text":
                    return {
                        ...base,
                        kind: "text",
                        text: node.text,
                        tone: node.tone ?? "default",
                        size: node.size ?? "body",
                    };
                case "rich_text":
                    return {
                        ...base,
                        kind: "rich_text",
                        text: node.text,
                        safeHtml: node.html === undefined ? undefined : sanitizeHtml(node.html, sanitizeHtmlParams),
                    };
                case "badge":
                    return { ...base, kind: "badge", text: node.text, tone: node.tone ?? "neutral" };
                case "key_value":
                    return { ...base, kind: "key_value", items: node.items };
                case "list":
                    return { ...base, kind: "list", items: node.items, ordered: node.ordered ?? false };
                case "image":
                    return {
                        ...base,
                        kind: "image",
                        alt: node.alt,
                        src: this.media.get(id),
                        width: node.width,
                        height: node.height,
                    };
                case "button":
                    return {
                        ...base,
                        kind: "button",
                        label: node.label,
                        variant: node.variant ?? "secondary",
                        disabled,
                        pending,
                        external: node.action.type === "open_url",
                    };
                case "select":
                case "choice":
                    return {
                        ...base,
                        kind: node.type,
                        label: node.label,
                        value: this.state[node.bind],
                        multiple: node.type === "choice" && !!node.multiple,
                        options: node.options,
                        disabled,
                    };
                case "toggle":
                    return {
                        ...base,
                        kind: "toggle",
                        label: node.label,
                        value: Boolean(this.state[node.bind]),
                        disabled,
                    };
                case "text_input":
                    return {
                        ...base,
                        kind: "text_input",
                        label: node.label,
                        value: String(this.state[node.bind] ?? ""),
                        multiline: !!node.multiline,
                        placeholder: node.placeholder,
                        maxLength: node.max_length,
                        required: !!node.required,
                        invalid: this.invalidKeys.has(node.bind),
                        disabled,
                    };
                case "number_input":
                    return {
                        ...base,
                        kind: "number_input",
                        label: node.label,
                        value:
                            node.display !== "slider" && this.numberDrafts.has(node.bind)
                                ? this.numberDrafts.get(node.bind)!
                                : (this.state[node.bind] as number | null),
                        min: node.min,
                        max: node.max,
                        step: node.step,
                        display: node.display ?? "field",
                        invalid: this.numberDrafts.has(node.bind) || this.invalidKeys.has(node.bind),
                        disabled,
                    };
                case "form":
                    return {
                        ...base,
                        kind: "form",
                        submitLabel: node.submit_label,
                        children: children(node.children),
                        disabled,
                        pending,
                    };
                case "graph":
                    return {
                        ...base,
                        kind: "graph",
                        graph: layoutLayeredGraph(node),
                        selectedId:
                            ((node.bind_selected ? this.state[node.bind_selected] : this.localValues.get(id)) as
                                | string
                                | null) ?? null,
                        showAsList: this.graphLists.has(id),
                    };
                case "chart": {
                    const common = { title: node.title, unit: node.unit };
                    const axes = { xLabel: node.x_label, yLabel: node.y_label };
                    const chart =
                        node.kind === "pie"
                            ? { ...common, kind: node.kind, categories: node.categories, values: node.series[0].values }
                            : node.kind === "scatter"
                              ? { ...common, ...axes, kind: node.kind, series: node.series }
                              : {
                                    ...common,
                                    ...axes,
                                    kind: node.kind,
                                    categories: node.categories,
                                    series: node.series,
                                };
                    return { ...base, kind: "chart", chart, showData: this.chartData.has(id) };
                }
                case "table":
                    return {
                        ...base,
                        kind: "table",
                        caption: node.caption,
                        columns: node.columns,
                        rows: node.rows.map((row) => node.columns.map((column) => row[column.key] ?? null)),
                        sortable: !!node.sortable,
                        sort: this.tableSort.get(id),
                    };
                case "carousel":
                    return {
                        ...base,
                        kind: "carousel",
                        label: node.label,
                        index: this.carouselIndices.get(id) ?? 0,
                        items: node.items.map((item) => ({
                            id: item.id,
                            src: this.media.get(`${id}/${item.id}`),
                            alt: item.image.alt,
                            title: item.title,
                            subtitle: item.subtitle,
                            meta: item.meta ?? [],
                            badge: item.badge
                                ? { text: item.badge.text, tone: item.badge.tone ?? "neutral" }
                                : undefined,
                            actionLabel: item.action ? item.title : undefined,
                            disabled,
                        })),
                    };
                case "link":
                    return {
                        ...base,
                        kind: "link",
                        label: node.label,
                        host: new URL(node.url).host,
                        sourceKind: node.kind ?? "external",
                    };
                case "unknown":
                    return { ...base, kind: "unknown", fallback: node.fallback };
            }
        };
        this.snapshot.merge({
            root: render(this.parsed.payload.root) ?? { kind: "unknown", id: this.parsed.payload.root },
        });
    };
}

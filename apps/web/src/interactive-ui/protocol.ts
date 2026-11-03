/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type EncryptedFile } from "matrix-js-sdk/src/types";
import { logger } from "matrix-js-sdk/src/logger";

import schema from "./schema/interactive-ui-v1.schema.json";

/** Unstable Matrix extension carrying a declarative UI. */
export const INTERACTIVE_UI_KEY = "net.15cm.matrix.interactive_ui";
/** Unstable Matrix extension carrying the user's response. */
export const INTERACTIVE_UI_ACTION_KEY = "net.15cm.matrix.interactive_ui.action";
/** The supported wire version. */
export const INTERACTIVE_UI_VERSION = 1;

/** Persistable values; arrays contain only strings. */
export type InteractiveUiStateValue = string | number | boolean | null | string[];
type Scalar = Exclude<InteractiveUiStateValue, string[]>;
/** A condition has exactly one comparison. */
export type InteractiveUiCondition = { state: string; not?: boolean } & (
    | { equals: Scalar; in?: never }
    | { in: Scalar[]; equals?: never }
);
/** Local actions and explicit backend submissions. */
export type InteractiveUiAction =
    | { type: "set_state"; key: string; value: InteractiveUiStateValue }
    | { type: "toggle_state"; key: string }
    | { type: "submit"; action_id: string; include?: string[]; single_use?: boolean }
    | { type: "open_url"; url: string };
/** A semantic tone shared by badges and graph nodes. */
export type BadgeTone = "neutral" | "info" | "success" | "warning" | "critical";
interface NodeBase {
    id: string;
    visible_when?: InteractiveUiCondition;
    fallback?: string;
}
interface Option {
    value: string;
    label: string;
}
/** Matrix media, never a remote HTTP image. */
export type ImageNode = NodeBase & { type: "image" } & InteractiveUiImage;
/** Image data also used inside carousel cards. */
export interface InteractiveUiImage {
    alt: string;
    url?: string;
    file?: EncryptedFile;
    mimetype: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
    width?: number;
    height?: number;
}
/** All supported nodes. Unknown wire types become the explicit unknown variant. */
export type InteractiveUiNode = NodeBase &
    (
        | { type: "stack"; children: string[]; direction: "vertical" | "horizontal"; gap?: "none" | "sm" | "md" | "lg" }
        | { type: "card"; children: string[]; title?: string }
        | { type: "tabs"; bind: string; tabs: (Option & { child: string })[] }
        | { type: "collapsible"; label: string; children: string[]; bind?: string }
        | { type: "divider" }
        | { type: "heading"; text: string; level: 1 | 2 | 3 }
        | { type: "text"; text: string; tone?: "default" | "muted" | "emphasis"; size?: "body" | "caption" }
        | { type: "rich_text"; text: string; html?: string }
        | { type: "badge"; text: string; tone?: BadgeTone }
        | { type: "key_value"; items: { label: string; value: string }[] }
        | { type: "list"; items: { text: string; secondary?: string }[]; ordered?: boolean }
        | ({ type: "image" } & InteractiveUiImage)
        | {
              type: "carousel";
              label: string;
              items: {
                  id: string;
                  image: InteractiveUiImage;
                  title: string;
                  subtitle?: string;
                  meta?: string[];
                  badge?: { text: string; tone?: BadgeTone };
                  action?: InteractiveUiAction;
              }[];
          }
        | { type: "link"; label: string; url: string; kind?: "source" | "external" }
        | {
              type: "table";
              caption?: string;
              columns: { key: string; label: string; kind?: "text" | "number"; align?: "start" | "end" }[];
              rows: Record<string, string | number | null>[];
              sortable?: boolean;
          }
        | ({ type: "chart"; title?: string; x_label?: string; y_label?: string; unit?: string } & (
              | { kind: "bar" | "line" | "pie"; categories: string[]; series: { name: string; values: number[] }[] }
              | { kind: "scatter"; series: { name: string; points: { x: number; y: number; label?: string }[] }[] }
          ))
        | {
              type: "graph";
              direction?: "left_to_right" | "top_to_bottom";
              layers: { label: string }[];
              nodes: { id: string; label: string; detail?: string; layer: number; tone?: BadgeTone }[];
              edges: { from: string; to: string; label?: string; style?: "solid" | "dashed" }[];
              bind_selected?: string;
          }
        | { type: "button"; label: string; variant?: "primary" | "secondary" | "danger"; action: InteractiveUiAction }
        | { type: "select"; label: string; bind: string; options: Option[] }
        | { type: "choice"; label: string; bind: string; options: Option[]; multiple?: boolean }
        | { type: "toggle"; label: string; bind: string }
        | {
              type: "text_input";
              label: string;
              bind: string;
              multiline?: boolean;
              placeholder?: string;
              max_length: number;
              required?: boolean;
          }
        | {
              type: "number_input";
              label: string;
              bind: string;
              min?: number;
              max?: number;
              step?: number;
              display?: "field" | "slider";
          }
        | { type: "form"; children: string[]; submit_label: string; action_id: string; single_use?: boolean }
        | { type: "unknown" }
    );
/** A complete revision of one interactive answer. */
export interface InteractiveUiPayload {
    version: 1;
    ui_id: string;
    revision: number;
    status: "active" | "submitted" | "expired" | "superseded";
    status_text?: string;
    title?: string;
    state: Record<string, InteractiveUiStateValue>;
    root: string;
    nodes: InteractiveUiNode[];
}
/** Stable cross-language validation failures. */
export type InteractiveUiErrorCode =
    | "not_object"
    | "bad_version"
    | "too_large"
    | "missing_field"
    | "bad_type"
    | "bad_id"
    | "duplicate_id"
    | "unknown_ref"
    | "cycle"
    | "too_deep"
    | "too_many"
    | "too_long"
    | "bad_value"
    | "bad_url"
    | "type_mismatch";
/** Paths are relative to the payload, using property names and array indices. */
export interface InteractiveUiError {
    path: string;
    code: InteractiveUiErrorCode;
}
/** An absent extension is separate from a malformed extension. */
export type ParseResult =
    | { ok: true; payload: InteractiveUiPayload; nodesById: ReadonlyMap<string, InteractiveUiNode> }
    | { ok: false; error: InteractiveUiError };

type JsonObject = Record<string, unknown>;
interface Schema {
    "$ref"?: string;
    "type"?: string | string[];
    "const"?: unknown;
    "enum"?: unknown[];
    "anyOf"?: Schema[];
    "oneOf"?: Schema[];
    "allOf"?: Schema[];
    "if"?: Schema;
    "then"?: Schema;
    "else"?: Schema;
    "not"?: Schema;
    "properties"?: Record<string, Schema>;
    "required"?: string[];
    "additionalProperties"?: boolean | Schema;
    "propertyNames"?: Schema;
    "items"?: Schema;
    "minItems"?: number;
    "maxItems"?: number;
    "maxProperties"?: number;
    "maxLength"?: number;
    "minLength"?: number;
    "pattern"?: string;
    "minimum"?: number;
    "maximum"?: number;
    "exclusiveMinimum"?: number;
    "uniqueItems"?: boolean;
    "x-error"?: InteractiveUiErrorCode;
}
const definitions = schema.$defs as Record<string, Schema>;
const object = (v: unknown): v is JsonObject => v !== null && typeof v === "object" && !Array.isArray(v);
function fail(path: string, code: InteractiveUiErrorCode): never {
    throw { path, code };
}
const field = (path: string, key: string): string => (path ? `${path}.${key}` : key);
// C0 controls other than tab/newline are forbidden by the wire contract.
// oxlint-disable-next-line no-control-regex
const forbiddenControls = /[\x00-\x08\x0b-\x1f]/u;
const hasForbiddenControls = (value: string): boolean => forbiddenControls.test(value);

// This bounded JSON copy never invokes toJSON and rejects accessors, cycles and non-JSON values.
// It measures the actual UTF-8 JSON representation before schema work, including ignored properties.
function copyJson(input: unknown): unknown {
    let bytes = 0;
    let visits = 0;
    const ancestors = new Set<object>();
    const encoder = new TextEncoder();
    const count = (n: number): void => {
        bytes += n;
        if (bytes > 60000) fail("", "too_large");
    };
    const copy = (value: unknown, path: string, depth: number): unknown => {
        if (++visits > 60000 || depth > 64) fail(path, "too_large");
        if (value === null) {
            count(4);
            return null;
        }
        if (typeof value === "string") {
            if (value.length > 60000) fail("", "too_large");
            count(encoder.encode(JSON.stringify(value)).length);
            return value;
        }
        if (typeof value === "number") {
            if (!Number.isFinite(value)) fail(path, "bad_value");
            count(String(value).length);
            return value;
        }
        if (typeof value === "boolean") {
            count(value ? 4 : 5);
            return value;
        }
        if (typeof value !== "object") fail(path, "bad_type");
        if (ancestors.has(value)) fail(path, "cycle");
        ancestors.add(value);
        const array = Array.isArray(value);
        if (!array && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
            fail(path, "not_object");
        const keys = Object.keys(value);
        if (keys.length > 30000 || (array && value.length > 30000)) fail(path, "too_large");
        const out: unknown[] | JsonObject = array ? [] : Object.create(null);
        count(2);
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !("value" in descriptor)) fail(field(path, key), "bad_type");
            if (array && key !== String(i)) fail(path, "bad_type");
            count(i ? 1 : 0);
            if (!array) {
                if (key.length > 60000) fail("", "too_large");
                count(encoder.encode(JSON.stringify(key)).length + 1);
            }
            const child = copy(descriptor.value, array ? `${path}[${i}]` : field(path, key), depth + 1);
            if (Array.isArray(out)) out.push(child);
            else out[key] = child;
        }
        if (array && keys.length !== value.length) fail(path, "bad_type");
        ancestors.delete(value);
        return out;
    };
    return copy(input, "", 0);
}

// The canonical schema owns field shapes and limits; relational constraints follow below.
function read(value: unknown, rule: Schema, path: string): unknown {
    if (rule.$ref) return read(value, definitions[rule.$ref.split("/").at(-1)!], path);
    if (typeof value === "string") {
        if (hasForbiddenControls(value)) fail(path, "bad_value");
        value = value.trim();
    }
    const input = value;
    if (rule.anyOf || rule.oneOf) {
        const alternatives = rule.anyOf ?? rule.oneOf!;
        // Discriminants keep errors specific to a known node/action rather than a failed union.
        const selected =
            object(input) &&
            alternatives.find((r) => {
                const resolved = r.$ref ? definitions[r.$ref.split("/").at(-1)!] : r;
                return Object.entries(resolved.properties ?? {}).some(
                    ([k, v]) =>
                        v.const !== undefined &&
                        (typeof input[k] === "string" ? input[k].trim() : input[k]) === v.const,
                );
            });
        if (selected) return read(value, selected, path);
        if (object(input) && typeof input.type === "string" && rule === definitions.node) {
            return read(input, definitions.unknown, path);
        }
        let firstError: unknown;
        for (const alternative of alternatives) {
            try {
                return read(value, alternative, path);
            } catch (error) {
                firstError ??= error;
            }
        }
        if (object(firstError) && firstError.code !== "bad_type" && firstError.code !== "not_object") throw firstError;
        fail(path, "bad_type");
    }
    for (const constraint of rule.allOf ?? []) read(value, constraint, path);
    if (rule.if) {
        let matches = true;
        try {
            read(value, rule.if, path);
        } catch {
            matches = false;
        }
        const branch = matches ? rule.then : rule.else;
        if (branch) read(value, branch, path);
    }
    if (rule.not) {
        let matches = true;
        try {
            read(value, rule.not, path);
        } catch {
            matches = false;
        }
        if (matches) fail(path, "bad_value");
    }
    if ("const" in rule && value !== rule.const) fail(path, rule["x-error"] ?? "bad_value");
    if (rule.enum && !rule.enum.includes(typeof value === "string" ? value.trim() : value))
        fail(path, rule["x-error"] ?? "bad_value");
    if (rule.type) {
        const types = Array.isArray(rule.type) ? rule.type : [rule.type];
        const matches = types.some((t) =>
            t === "null"
                ? value === null
                : t === "array"
                  ? Array.isArray(value)
                  : t === "object"
                    ? object(value)
                    : t === "integer"
                      ? Number.isSafeInteger(value)
                      : typeof value === t,
        );
        if (!matches) fail(path, rule.type === "object" ? "not_object" : "bad_type");
    }
    if (typeof value === "string") {
        if (rule === definitions.https) {
            try {
                const url = new URL(value);
                if (url.protocol !== "https:" || !url.hostname || url.username || url.password) fail(path, "bad_url");
            } catch {
                fail(path, "bad_url");
            }
        }
        const length = Array.from(value).length;
        if (rule.maxLength !== undefined && length > rule.maxLength) fail(path, "too_long");
        if (rule.minLength !== undefined && length < rule.minLength) fail(path, rule["x-error"] ?? "bad_value");
        if (rule.pattern && !new RegExp(rule.pattern, "u").test(value)) fail(path, rule["x-error"] ?? "bad_value");
    }
    if (typeof value === "number") {
        if (
            (rule.minimum !== undefined && value < rule.minimum) ||
            (rule.maximum !== undefined && value > rule.maximum) ||
            (rule.exclusiveMinimum !== undefined && value <= rule.exclusiveMinimum)
        )
            fail(path, "bad_value");
    }
    if (Array.isArray(value)) {
        if (rule.maxItems !== undefined && value.length > rule.maxItems) fail(path, "too_many");
        if (rule.minItems !== undefined && value.length < rule.minItems) fail(path, "bad_value");
        const out = value.map((v, i) => (rule.items ? read(v, rule.items, `${path}[${i}]`) : v));
        if (rule.uniqueItems && new Set(out.map((v) => JSON.stringify(v))).size !== out.length)
            fail(path, "duplicate_id");
        return out;
    }
    if (object(value)) {
        for (const key of rule.required ?? []) if (!Object.hasOwn(value, key)) fail(field(path, key), "missing_field");
        if (rule.maxProperties !== undefined && Object.keys(value).length > rule.maxProperties) fail(path, "too_many");
        const out: JsonObject = Object.create(null);
        for (const key of Object.keys(value)) {
            if (rule.propertyNames && read(key, rule.propertyNames, field(path, key)) !== key)
                fail(field(path, key), "bad_id");
            const childRule =
                rule.properties && Object.hasOwn(rule.properties, key)
                    ? rule.properties[key]
                    : object(rule.additionalProperties)
                      ? rule.additionalProperties
                      : undefined;
            if (childRule) out[key] = read(value[key], childRule, field(path, key));
            else if (rule.additionalProperties === false) fail(field(path, key), "bad_value");
        }
        return out;
    }
    return value;
}

/** Child references used by tree validation and form traversal. */
export function childIds(node: InteractiveUiNode): string[] {
    if ("children" in node) return node.children;
    if (node.type === "tabs") return node.tabs.map((tab) => tab.child);
    return [];
}

/** Expected state kind, inferred from bindings when the initial value is null. */
export function stateKind(payload: InteractiveUiPayload, key: string): string {
    const value = payload.state[key];
    if (value !== null) return Array.isArray(value) ? "array" : typeof value;
    for (const node of payload.nodes) {
        if ("bind_selected" in node && node.bind_selected === key) return "string";
        if ("bind" in node && node.bind === key) {
            if (node.type === "number_input") return "number";
            if (node.type === "toggle" || node.type === "collapsible") return "boolean";
            if (node.type === "choice" && node.multiple) return "array";
            return "string";
        }
    }
    return "null";
}

function stateStringLimit(payload: InteractiveUiPayload, key: string): number {
    const inputs = payload.nodes.filter((node) => node.type === "text_input" && node.bind === key);
    return inputs.length
        ? Math.min(...inputs.map((node) => (node.type === "text_input" ? node.max_length : 200)))
        : 200;
}

/** Checks a candidate state value against every control sharing the key. */
export function acceptsStateValue(
    payload: InteractiveUiPayload,
    key: string,
    value: unknown,
): value is InteractiveUiStateValue {
    if (!Object.hasOwn(payload.state, key)) return false;
    const kind = stateKind(payload, key);
    if (value === null) return kind === "string" || kind === "number" || kind === "null";
    if ((Array.isArray(value) ? "array" : typeof value) !== kind) return false;
    if (typeof value === "number" && !Number.isFinite(value)) return false;
    const cleanString = (v: unknown): v is string =>
        typeof v === "string" && Array.from(v).length <= 200 && !hasForbiddenControls(v);
    if (
        typeof value === "string" &&
        (Array.from(value).length > stateStringLimit(payload, key) || hasForbiddenControls(value))
    )
        return false;
    if (
        Array.isArray(value) &&
        (value.length > 50 || !value.every(cleanString) || new Set(value).size !== value.length)
    )
        return false;
    for (const node of payload.nodes) {
        if (!("bind" in node) || node.bind !== key) continue;
        if (node.type === "tabs" || node.type === "choice" || node.type === "select") {
            const options = node.type === "tabs" ? node.tabs : node.options;
            const values = Array.isArray(value) ? value : [value];
            if (!values.every((v) => options.some((o) => o.value === v))) return false;
        }
        if (node.type === "text_input" && (typeof value !== "string" || Array.from(value).length > node.max_length))
            return false;
        if (
            node.type === "number_input" &&
            (typeof value !== "number" ||
                (node.min !== undefined && value < node.min) ||
                (node.max !== undefined && value > node.max))
        )
            return false;
    }
    const graphNodes = payload.nodes.filter((node) => node.type === "graph" && node.bind_selected === key);
    if (
        graphNodes.length &&
        !graphNodes.some((node) => node.type === "graph" && node.nodes.some((n) => n.id === value))
    )
        return false;
    return true;
}

function validateRelations(payload: InteractiveUiPayload): ReadonlyMap<string, InteractiveUiNode> {
    const byId = new Map<string, InteractiveUiNode>();
    const indices = new Map<string, number>();
    let images = 0;
    payload.nodes.forEach((node, i) => {
        const path = `nodes[${i}]`;
        if (byId.has(node.id)) fail(`${path}.id`, "duplicate_id");
        byId.set(node.id, node);
        indices.set(node.id, i);
        if (node.type === "image") images++;
        if (node.type === "carousel") {
            images += node.items.length;
            const ids = new Set<string>();
            node.items.forEach((item, j) => {
                if (ids.has(item.id)) fail(`${path}.items[${j}].id`, "duplicate_id");
                ids.add(item.id);
            });
        }
        if (images > 24) fail(path, "too_many");
    });
    // Check all components for structural errors, but only expose the root's reachable tree.
    const visited = new Set<string>();
    const active = new Set<string>();
    const parents = new Set<string>();
    const walk = (id: string, depth: number, path: string): void => {
        const node = byId.get(id);
        if (!node) fail(path, "unknown_ref");
        if (active.has(id)) fail(path, "cycle");
        if (depth > 12) fail(path, "too_deep");
        if (visited.has(id)) return;
        visited.add(id);
        active.add(id);
        childIds(node).forEach((child, j) => {
            const childPath = `nodes[${indices.get(id)}].${node.type === "tabs" ? `tabs[${j}].child` : `children[${j}]`}`;
            if (active.has(child)) fail(childPath, "cycle");
            if (parents.has(child) || child === payload.root) fail(childPath, "duplicate_id");
            parents.add(child);
            walk(child, depth + 1, childPath);
        });
        active.delete(id);
    };
    walk(payload.root, 1, "root");
    const reachable = new Set(visited);
    const referenced = new Set(payload.nodes.flatMap(childIds));
    // Start disconnected trees at their roots so declaration order cannot hide excessive depth.
    for (const node of payload.nodes) {
        if (!visited.has(node.id) && !referenced.has(node.id)) walk(node.id, 1, `nodes[${indices.get(node.id)}]`);
    }
    for (const node of payload.nodes) {
        if (!visited.has(node.id)) walk(node.id, 1, `nodes[${indices.get(node.id)}]`);
    }
    const retainedPayload = { ...payload, nodes: payload.nodes.filter((node) => reachable.has(node.id)) };
    const reference = (key: string, path: string, kind?: string): void => {
        if (!Object.hasOwn(payload.state, key)) fail(path, "unknown_ref");
        if (kind && stateKind(retainedPayload, key) !== kind) fail(path, "type_mismatch");
    };
    const action = (value: InteractiveUiAction, path: string): void => {
        if (value.type === "submit") value.include?.forEach((key, i) => reference(key, `${path}.include[${i}]`));
        if (value.type === "set_state" || value.type === "toggle_state") {
            reference(value.key, `${path}.key`, value.type === "toggle_state" ? "boolean" : undefined);
            if (value.type === "set_state" && !acceptsStateValue(retainedPayload, value.key, value.value))
                fail(`${path}.value`, "type_mismatch");
        }
    };
    payload.nodes.forEach((node, i) => {
        const path = `nodes[${i}]`;
        const cond = node.visible_when;
        if (reachable.has(node.id) && cond) {
            reference(cond.state, `${path}.visible_when.state`);
            const values = "equals" in cond ? [cond.equals] : cond.in;
            if (values?.some((v) => v !== null && typeof v !== stateKind(retainedPayload, cond.state)))
                fail(`${path}.visible_when`, "type_mismatch");
        }
        if (reachable.has(node.id) && "bind" in node && node.bind !== undefined) {
            const kind =
                node.type === "toggle" || node.type === "collapsible"
                    ? "boolean"
                    : node.type === "number_input"
                      ? "number"
                      : node.type === "choice" && node.multiple
                        ? "array"
                        : "string";
            reference(node.bind, `${path}.bind`, kind);
            if (!acceptsStateValue(retainedPayload, node.bind, payload.state[node.bind]))
                fail(`${path}.bind`, "bad_value");
        }
        if (node.type === "number_input") {
            if (
                (node.min !== undefined && node.max !== undefined && node.min > node.max) ||
                (node.display === "slider" && (node.min === undefined || node.max === undefined))
            )
                fail(path, "bad_value");
        }
        if (node.type === "select" || node.type === "choice" || node.type === "tabs") {
            const options = node.type === "tabs" ? node.tabs : node.options;
            if (new Set(options.map((o) => o.value)).size !== options.length)
                fail(`${path}.${node.type === "tabs" ? "tabs" : "options"}`, "duplicate_id");
        }
        if (reachable.has(node.id) && node.type === "button") action(node.action, `${path}.action`);
        if (reachable.has(node.id) && node.type === "carousel")
            node.items.forEach((item, j) => {
                if (item.action) action(item.action, `${path}.items[${j}].action`);
            });
        if (node.type === "chart") {
            if (node.kind === "pie" && node.series.length !== 1) fail(`${path}.series`, "bad_value");
            let count = 0;
            node.series.forEach((series, j) => {
                if ("values" in series) {
                    if (!("categories" in node) || series.values.length !== node.categories.length)
                        fail(`${path}.series[${j}].values`, "bad_value");
                    count += series.values.length;
                } else count += series.points.length * 2;
            });
            if (count > 800) fail(`${path}.series`, "too_many");
        }
        if (node.type === "table") {
            if (new Set(node.columns.map((c) => c.key)).size !== node.columns.length)
                fail(`${path}.columns`, "duplicate_id");
            node.rows.forEach((row, j) =>
                node.columns.forEach((column) => {
                    const value = row[column.key];
                    if (value !== undefined && value !== null && column.kind === "number" && typeof value !== "number")
                        fail(`${path}.rows[${j}].${column.key}`, "type_mismatch");
                }),
            );
        }
        if (node.type === "graph") {
            const ids = new Set<string>();
            node.nodes.forEach((n, j) => {
                if (ids.has(n.id)) fail(`${path}.nodes[${j}].id`, "duplicate_id");
                ids.add(n.id);
                if (n.layer >= node.layers.length) fail(`${path}.nodes[${j}].layer`, "bad_value");
            });
            node.edges.forEach((edge, j) => {
                for (const key of ["from", "to"] as const)
                    if (!ids.has(edge[key])) fail(`${path}.edges[${j}].${key}`, "unknown_ref");
            });
            if (reachable.has(node.id) && node.bind_selected !== undefined) {
                reference(node.bind_selected, `${path}.bind_selected`, "string");
                if (!acceptsStateValue(retainedPayload, node.bind_selected, payload.state[node.bind_selected]))
                    fail(`${path}.bind_selected`, "bad_value");
            }
        }
    });
    for (const [key, value] of Object.entries(payload.state)) {
        if (!acceptsStateValue(retainedPayload, key, value)) {
            fail(
                `state.${key}`,
                typeof value === "string" && Array.from(value).length > stateStringLimit(retainedPayload, key)
                    ? "too_long"
                    : "bad_value",
            );
        }
    }
    return new Map([...byId].filter(([id]) => reachable.has(id)));
}

/** Returns undefined for absent payloads. Untrusted inputs, including accessors and cycles, never escape as exceptions. */
export function parseInteractiveUi(content: unknown): ParseResult | undefined {
    try {
        if (!object(content) || !Object.hasOwn(content, INTERACTIVE_UI_KEY)) return undefined;
        const descriptor = Object.getOwnPropertyDescriptor(content, INTERACTIVE_UI_KEY);
        if (!descriptor || !("value" in descriptor)) fail("", "bad_type");
        const raw = copyJson(descriptor.value);
        if (!object(raw)) fail("", "not_object");
        if (raw.version !== 1) fail("version", "bad_version");
        const payload = read(raw, schema as Schema, "") as InteractiveUiPayload;
        const known = new Set(schema.$defs.node.anyOf.slice(0, -1).map((r) => r.$ref.split("/").at(-1)));
        payload.nodes = payload.nodes.map((node) =>
            known.has(node.type)
                ? node
                : {
                      id: node.id,
                      type: "unknown",
                      ...(node.fallback !== undefined ? { fallback: node.fallback } : {}),
                      ...(node.visible_when ? { visible_when: node.visible_when } : {}),
                  },
        );
        const nodesById = validateRelations(payload);
        payload.nodes = payload.nodes.filter((node) => nodesById.has(node.id));
        return { ok: true, payload, nodesById };
    } catch (error) {
        let failure: InteractiveUiError = { path: "", code: "bad_type" };
        try {
            if (object(error) && typeof error.path === "string" && typeof error.code === "string") {
                failure = { path: error.path, code: error.code as InteractiveUiErrorCode };
            }
        } catch {
            /* Hostile thrown values are not trusted either. */
        }
        try {
            logger.warn("interactive_ui validation failed", failure.path, failure.code);
        } catch {
            /* Logging must not break fallback. */
        }
        return { ok: false, error: failure };
    }
}

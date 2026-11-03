/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi } from "vitest";

import { INTERACTIVE_UI_KEY, parseInteractiveUi } from "./protocol";
import schema from "./schema/interactive-ui-v1.schema.json";

vi.mock("matrix-js-sdk/src/logger", () => ({ logger: { warn: vi.fn() } }));

const fixtureDir = fileURLToPath(new URL("./fixtures/", import.meta.url));
const load = (path: string): unknown => JSON.parse(readFileSync(`${fixtureDir}${path}`, "utf8"));
const valid = readdirSync(`${fixtureDir}valid`).filter((name) => name.endsWith(".json"));
const invalid = readdirSync(`${fixtureDir}invalid`).filter(
    (name) => name.endsWith(".json") && !name.endsWith(".expected.json"),
);
const parse = (payload: unknown) => parseInteractiveUi({ [INTERACTIVE_UI_KEY]: payload });

describe("protocol", () => {
    it.each(valid)("should accept and round-trip %s", (name) => {
        const payload = load(`valid/${name}`);
        const result = parse(payload);
        expect(result?.ok).toBe(true);
        if (!result?.ok) return;
        expect(parse(JSON.parse(JSON.stringify(result.payload)))?.ok).toBe(true);
    });

    it.each(invalid)("should return the specified error for %s", (name) => {
        expect(parse(load(`invalid/${name}`))).toEqual({
            ok: false,
            error: load(`invalid/${name.replace(".json", ".expected.json")}`),
        });
    });

    it("should describe every catalog property and required field in the canonical schema", () => {
        const catalog: Record<string, [string[], string[]]> = {
            stack: [
                ["children", "direction", "gap"],
                ["children", "direction"],
            ],
            card: [["children", "title"], ["children"]],
            tabs: [
                ["bind", "tabs"],
                ["bind", "tabs"],
            ],
            collapsible: [
                ["label", "children", "bind"],
                ["label", "children"],
            ],
            divider: [[], []],
            heading: [
                ["text", "level"],
                ["text", "level"],
            ],
            text: [["text", "tone", "size"], ["text"]],
            rich_text: [["text", "html"], ["text"]],
            badge: [["text", "tone"], ["text"]],
            key_value: [["items"], ["items"]],
            list: [["items", "ordered"], ["items"]],
            image: [
                ["alt", "url", "file", "mimetype", "width", "height"],
                ["alt", "mimetype"],
            ],
            carousel: [
                ["label", "items"],
                ["label", "items"],
            ],
            link: [
                ["label", "url", "kind"],
                ["label", "url"],
            ],
            table: [
                ["caption", "columns", "rows", "sortable"],
                ["columns", "rows"],
            ],
            chart: [
                ["title", "x_label", "y_label", "unit", "kind", "categories", "series"],
                ["kind", "series"],
            ],
            graph: [
                ["direction", "layers", "nodes", "edges", "bind_selected"],
                ["layers", "nodes", "edges"],
            ],
            button: [
                ["label", "variant", "action"],
                ["label", "action"],
            ],
            select: [
                ["label", "bind", "options"],
                ["label", "bind", "options"],
            ],
            choice: [
                ["label", "bind", "options", "multiple"],
                ["label", "bind", "options"],
            ],
            toggle: [
                ["label", "bind"],
                ["label", "bind"],
            ],
            text_input: [
                ["label", "bind", "max_length", "multiline", "placeholder", "required"],
                ["label", "bind", "max_length"],
            ],
            number_input: [
                ["label", "bind", "min", "max", "step", "display"],
                ["label", "bind"],
            ],
            form: [
                ["children", "submit_label", "action_id", "single_use"],
                ["children", "submit_label", "action_id"],
            ],
        };
        const definitions = schema.$defs as unknown as Record<
            string,
            { properties: Record<string, unknown>; required: string[] }
        >;
        expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
        expect(schema.$defs.node.anyOf.map((r) => r.$ref)).toEqual(
            [...Object.keys(catalog), "unknown"].map((name) => `#/$defs/${name}`),
        );
        for (const [name, [properties, required]] of Object.entries(catalog)) {
            const definition = definitions[name];
            expect(Object.keys(definition.properties).sort()).toEqual(
                ["id", "type", "visible_when", "fallback", ...properties].sort(),
            );
            expect(definition.required).toEqual(["id", "type", ...required]);
            expect(definition.properties.type).toEqual({ const: name });
            expect(definition.properties.id).toEqual({ $ref: "#/$defs/id" });
            expect(definition.properties.visible_when).toEqual({ $ref: "#/$defs/condition" });
        }
        expect(schema.$defs.unknown.properties.type.not.enum).toEqual(Object.keys(catalog));
    });

    it("should document protocol bounds and shared definitions in the schema", () => {
        const d = schema.$defs;
        expect(schema.properties.nodes).toMatchObject({ maxItems: 300, minItems: 1, items: { $ref: "#/$defs/node" } });
        expect(schema.properties.state).toMatchObject({
            maxProperties: 50,
            propertyNames: { $ref: "#/$defs/key" },
            additionalProperties: { $ref: "#/$defs/value" },
        });
        expect(d.id.pattern).toBe("^[A-Za-z0-9_-]{1,64}$");
        expect(d.key.pattern).toBe("^[A-Za-z0-9_]{1,40}$");
        expect(d.actionId.pattern).toBe("^[A-Za-z0-9._-]{1,64}$");
        expect(d.text.properties.text.maxLength).toBe(4000);
        expect(d.rich_text.properties.text.maxLength).toBe(8000);
        expect(d.rich_text.properties.html.maxLength).toBe(16000);
        expect(d.carousel.properties.items).toMatchObject({ minItems: 1, maxItems: 10 });
        expect(d.carousel.properties.items.items.properties.action).toEqual({ $ref: "#/$defs/action" });
        expect(d.carousel.properties.items.items.properties.meta).toMatchObject({
            maxItems: 3,
            items: { maxLength: 80 },
        });
        expect(d.table.properties.columns).toMatchObject({ minItems: 1, maxItems: 12 });
        expect(d.table.properties.rows.maxItems).toBe(200);
        expect(d.chart.properties.series.maxItems).toBe(8);
        expect(d.chart.properties.categories.maxItems).toBe(100);
        expect(d.graph.properties.layers.maxItems).toBe(8);
        expect(d.graph.properties.nodes.maxItems).toBe(80);
        expect(d.graph.properties.edges.maxItems).toBe(200);
        expect(d.select.properties.options.maxItems).toBe(50);
        expect(d.choice.properties.options.maxItems).toBe(20);
        expect(d.tabs.properties.tabs.maxItems).toBe(8);
        expect(d.text_input.properties.max_length).toMatchObject({ minimum: 1, maximum: 2000 });
        expect(d.image.properties.url).toEqual({ $ref: "#/$defs/mxc" });
        expect(d.link.properties.url).toEqual({ $ref: "#/$defs/https" });
        expect(d.https.maxLength).toBe(2048);
        expect(d.encryptedFile.required).toEqual(["url", "v", "iv", "hashes", "key"]);
        expect(d.action.anyOf.map((r) => r.$ref)).toEqual(
            ["set_state", "toggle_state", "submit", "open_url"].map((name) => `#/$defs/action_${name}`),
        );
        expect(d.condition.allOf).toEqual([
            { not: { required: ["equals", "in"] } },
            { anyOf: [{ required: ["equals"] }, { required: ["in"] }] },
        ]);
        expect(d.image.allOf).toEqual([
            { not: { required: ["url", "file"] } },
            { anyOf: [{ required: ["url"] }, { required: ["file"] }] },
        ]);
        expect(d.chart.allOf[0]).toMatchObject({
            if: { properties: { kind: { const: "scatter" } } },
            // JSON Schema uses the literal then keyword for conditional validation.
            // oxlint-disable-next-line unicorn/no-thenable
            then: { properties: { series: { items: { required: ["points"] } } } },
            else: { required: ["categories"] },
        });
    });

    it("should distinguish absence and ignore unknown properties and unreachable nodes", () => {
        expect(parseInteractiveUi(null)).toBeUndefined();
        expect(parseInteractiveUi({ body: "plain" })).toBeUndefined();
        const result = parse({
            version: 1,
            ui_id: "x",
            revision: 0,
            status: "active",
            state: {},
            root: "root",
            nodes: [
                { id: "root", type: "future", fallback: " Future ", arbitrary: {} },
                { id: "unused", type: "divider" },
            ],
            future: 1,
        });
        expect(result?.ok).toBe(true);
        if (result?.ok) {
            expect(result.payload.nodes).toEqual([{ id: "root", type: "unknown", fallback: "Future" }]);
            expect(result.nodesById.size).toBe(1);
        }
    });

    it("should reject malformed JSON objects without invoking getters or toJSON", () => {
        const getter = vi.fn(() => {
            throw new Error("hostile");
        });
        expect(() => parseInteractiveUi(new Proxy({}, { getOwnPropertyDescriptor: getter }))).not.toThrow();
        const payload = {
            version: 1,
            get state() {
                return getter();
            },
            toJSON: getter,
        };
        expect(parse(payload)?.ok).toBe(false);
        expect(getter).toHaveBeenCalledTimes(1);
        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;
        expect(parse(cyclic)).toEqual({ ok: false, error: { path: "self", code: "cycle" } });
        expect(parse({ value: Infinity })?.ok).toBe(false);
        expect(parse({ value: BigInt(1) })?.ok).toBe(false);
        expect(parse({ value: new Array(3) })?.ok).toBe(false);
    });

    it("should enforce UTF-8 bytes and parse 60000 bytes and 300 nodes under 20ms", () => {
        const payload = {
            version: 1,
            ui_id: "bounded",
            revision: 0,
            status: "active",
            state: {},
            root: "root",
            nodes: [
                {
                    id: "root",
                    type: "stack",
                    direction: "vertical",
                    children: Array.from({ length: 299 }, (_, i) => `n${i}`),
                },
                ...Array.from({ length: 299 }, (_, i) => ({ id: `n${i}`, type: "divider" })),
            ],
            extra: "",
        };
        payload.extra = "x".repeat(60000 - new TextEncoder().encode(JSON.stringify(payload)).length);
        parse(payload);
        const start = performance.now();
        expect(parse(payload)?.ok).toBe(true);
        expect(performance.now() - start).toBeLessThan(20);
        expect(new TextEncoder().encode(JSON.stringify(payload)).length).toBe(60000);
        expect(parse({ ...payload, extra: payload.extra + "x" })).toEqual({
            ok: false,
            error: { path: "", code: "too_large" },
        });
        expect(parse({ ...payload, extra: "中".repeat(20000) })?.ok).toBe(false);
    });

    it("should accept the chart coordinate boundary and reject excess numeric values", () => {
        const chart = {
            version: 1,
            ui_id: "data",
            revision: 0,
            status: "active",
            root: "chart",
            state: {},
            nodes: [
                {
                    id: "chart",
                    type: "chart",
                    kind: "scatter",
                    series: [{ name: "A", points: Array.from({ length: 400 }, (_, i) => ({ x: i, y: -i })) }],
                },
            ],
        };
        expect(parse(chart)?.ok).toBe(true);
        chart.nodes[0].series.push({ name: "B", points: [{ x: 1, y: 1 }] });
        expect(parse(chart)).toEqual({ ok: false, error: { path: "nodes[0].series", code: "too_many" } });
        const categorical = {
            ...chart,
            nodes: [
                {
                    id: "chart",
                    type: "chart",
                    kind: "bar",
                    categories: Array.from({ length: 100 }, (_, i) => String(i)),
                    series: Array.from({ length: 8 }, (_, i) => ({
                        name: String(i),
                        values: Array.from({ length: 100 }, (_, j) => i + j),
                    })),
                },
            ],
        };
        expect(parse(categorical)?.ok).toBe(true);
        expect(
            parse({
                ...categorical,
                nodes: [{ ...categorical.nodes[0], series: [{ name: "Infinite", values: [NaN] }] }],
            })?.ok,
        ).toBe(false);
    });

    it("should ignore unknown properties, trim discriminants and resist prototype keys", () => {
        const payload = load("valid/product-carousel.json") as { nodes: { items?: { actions?: unknown }[] }[] };
        payload.nodes[1].items![0].actions = [{ type: "arbitrary" }];
        expect(parse(payload)?.ok).toBe(true);
        const result = parse(
            JSON.parse(
                '{"version":1,"ui_id":"x","revision":0,"status":"active","state":{"__proto__":"safe"},"root":"root","nodes":[{"id":"root","type":" text ","text":" Trimmed ","__proto__":{"polluted":true}}]}',
            ),
        );
        expect(result?.ok).toBe(true);
        if (result?.ok) {
            expect(result.payload.nodes[0]).toMatchObject({ type: "text", text: "Trimmed" });
            expect(result.payload.state["__proto__"]).toBe("safe");
        }
        const hostile = new Proxy(
            {},
            {
                getOwnPropertyDescriptor() {
                    throw new Proxy(
                        {},
                        {
                            get() {
                                throw new Error("nested trap");
                            },
                        },
                    );
                },
            },
        );
        expect(() => parseInteractiveUi(hostile)).not.toThrow();
    });

    it("should infer state only from retained nodes and preserve original wire error indices", () => {
        const base = {
            version: 1,
            ui_id: "disconnected",
            revision: 0,
            status: "active",
            state: { x: null },
            root: "button",
            nodes: [
                { id: "unused", type: "text_input", label: "Unused", bind: "x", max_length: 10 },
                { id: "button", type: "button", label: "Set", action: { type: "set_state", key: "x", value: "hello" } },
            ],
        };
        expect(parse(base)).toEqual({ ok: false, error: { path: "nodes[1].action.value", code: "type_mismatch" } });
        const retained = parse({ ...base, state: { x: "hello" } });
        expect(retained?.ok).toBe(true);
        if (retained?.ok) {
            expect(retained.payload.nodes.map((n) => n.id)).toEqual(["button"]);
            expect(parse(retained.payload)?.ok).toBe(true);
        }
        const withUnusedActions = parse({
            ...base,
            state: { x: "hello" },
            nodes: [
                base.nodes[1],
                {
                    id: "unusedAction",
                    type: "button",
                    label: "Unused",
                    action: { type: "set_state", key: "missing", value: 5 },
                },
                { ...base.nodes[0], bind: "missing" },
            ],
        });
        expect(withUnusedActions?.ok).toBe(true);
        if (withUnusedActions?.ok) expect(parse(withUnusedActions.payload)?.ok).toBe(true);
        const graph = {
            id: "graph",
            type: "graph",
            bind_selected: "x",
            layers: [{ label: "Layer" }],
            nodes: [{ id: "visible", label: "Visible", layer: 0 }],
            edges: [],
        };
        const unused = {
            ...graph,
            id: "unusedGraph",
            nodes: [{ id: "disconnected", label: "Disconnected", layer: 0 }],
        };
        expect(parse({ ...base, nodes: [unused, base.nodes[1]] })).toEqual({
            ok: false,
            error: { path: "nodes[1].action.value", code: "type_mismatch" },
        });
        const graphPayload = { ...base, root: "graph", state: { x: "visible" }, nodes: [unused, graph] };
        const graphResult = parse(graphPayload);
        expect(graphResult?.ok).toBe(true);
        if (graphResult?.ok) expect(parse(graphResult.payload)?.ok).toBe(true);
        expect(parse({ ...graphPayload, state: { x: "disconnected" } })).toEqual({
            ok: false,
            error: { path: "nodes[1].bind_selected", code: "bad_value" },
        });
        expect(
            parse({ ...graphPayload, nodes: [{ ...unused, edges: [{ from: "missing", to: "disconnected" }] }, graph] }),
        ).toEqual({ ok: false, error: { path: "nodes[0].edges[0].from", code: "unknown_ref" } });
        expect(
            parse({
                ...base,
                state: { x: "hello" },
                nodes: [base.nodes[1], { id: "bad", type: "stack", direction: "vertical", children: ["missing"] }],
            }),
        ).toEqual({ ok: false, error: { path: "nodes[1].children[0]", code: "unknown_ref" } });
    });

    it("should use the same string bounds for initial state and subsequent values", () => {
        const base = {
            version: 1,
            ui_id: "strings",
            revision: 0,
            status: "active",
            state: { text: "x".repeat(200) },
            root: "send",
            nodes: [
                {
                    id: "send",
                    type: "button",
                    label: "Send",
                    action: { type: "submit", action_id: "send", include: ["text"] },
                },
            ],
        };
        expect(parse(base)?.ok).toBe(true);
        expect(parse({ ...base, state: { text: "x".repeat(201) } })).toEqual({
            ok: false,
            error: { path: "state.text", code: "too_long" },
        });
        const text = { id: "text", type: "text_input", label: "Text", bind: "text", max_length: 2000 };
        const long = parse({
            ...base,
            root: "root",
            state: { text: "x".repeat(2000) },
            nodes: [
                { id: "root", type: "stack", direction: "vertical", children: ["text", "send"] },
                text,
                base.nodes[0],
            ],
        });
        expect(long?.ok).toBe(true);
        if (long?.ok) expect(parse(long.payload)?.ok).toBe(true);
        expect(parse({ ...base, state: { text: "x".repeat(201) }, nodes: [base.nodes[0], text] })).toEqual({
            ok: false,
            error: { path: "state.text", code: "too_long" },
        });
    });

    it("should never throw on seeded mutations", () => {
        let seed = 137;
        const random = (): number => {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            return seed / 4294967296;
        };
        const replacements = [null, [], {}, false, 1, "bad\u0000", Infinity, undefined, "x".repeat(61000)];
        for (let i = 0; i < 500; i++) {
            const payload = load(`valid/${valid[Math.floor(random() * valid.length)]}`) as Record<string, unknown>;
            let target = payload;
            for (let depth = 0; depth < 4; depth++) {
                const keys = Object.keys(target);
                const key = keys[Math.floor(random() * keys.length)];
                const child = target[key];
                if (child && typeof child === "object" && random() > 0.3) target = child as Record<string, unknown>;
                else {
                    target[key] = replacements[Math.floor(random() * replacements.length)];
                    break;
                }
            }
            expect(() => parse(payload)).not.toThrow();
        }
    });
});

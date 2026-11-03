/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { describe, expect, it } from "vitest";

import form from "./fixtures/valid/form.json";
import controls from "./fixtures/valid/controls.json";
import carousel from "./fixtures/valid/product-carousel.json";
import knowledgeMap from "./fixtures/valid/knowledge-map.en.json";
import revision0 from "./fixtures/valid/revision-0.json";
import revision1 from "./fixtures/valid/revision-1.json";
import { INTERACTIVE_UI_KEY, parseInteractiveUi, type InteractiveUiPayload } from "./protocol";
import { initialState, mergeSavedState, evaluateCondition, validateSubmission } from "./state";

function parsed(raw: unknown): InteractiveUiPayload {
    const result = parseInteractiveUi({ [INTERACTIVE_UI_KEY]: raw });
    if (!result?.ok) throw new Error(JSON.stringify(result));
    return result.payload;
}

describe("state", () => {
    it("should copy arrays and retain only compatible saved values", () => {
        const payload = parsed(controls);
        const state = initialState(payload);
        (state.features as string[]).push("a");
        expect(payload.state.features).toEqual([]);
        const merged = mergeSavedState(payload, {
            plan: "removed",
            quantity: 11,
            name: "Alice",
            features: ["a"],
            enabled: 1,
            extra: true,
        });
        expect(merged).toEqual({ ...payload.state, name: "Alice", features: ["a"] });
        expect(mergeSavedState(payload, { ui_id: "other", revision: 0, state: { name: "Alice" } })).toEqual(
            payload.state,
        );
        expect(
            mergeSavedState(
                { ...payload, revision: 1 },
                { ui_id: payload.ui_id, revision: 0, state: { name: "Alice" } },
            ).name,
        ).toBe("Alice");
        expect(mergeSavedState(payload, { ui_id: payload.ui_id, revision: 2, state: { name: "Alice" } })).toEqual(
            payload.state,
        );
        expect(
            mergeSavedState(
                payload,
                new Proxy(
                    {},
                    {
                        getOwnPropertyDescriptor() {
                            throw new Error("bad storage");
                        },
                    },
                ),
            ),
        ).toEqual(payload.state);
    });

    it("should distinguish legal raw state keys from complete persistence envelopes", () => {
        const payload = parsed({
            ...controls,
            revision: 2,
            state: { ...controls.state, ui_id: "initial", revision: 0, state: "initial" },
        });
        const base = initialState(payload);
        for (const saved of [
            { ui_id: "saved", name: "Alice" },
            { revision: 1, name: "Alice" },
            { ui_id: "saved", revision: 1, name: "Alice" },
            { ui_id: "saved", revision: 1, state: "saved", name: "Alice" },
            { state: "saved", name: "Alice" },
        ]) {
            expect(mergeSavedState(payload, saved)).toEqual({ ...base, ...saved });
        }
        expect(
            mergeSavedState(payload, {
                ui_id: payload.ui_id,
                revision: 1,
                state: { name: "Alice", ui_id: "saved", revision: 1, state: "saved" },
            }),
        ).toEqual({ ...base, name: "Alice", ui_id: "saved", revision: 1, state: "saved" });
        for (const envelope of [
            { ui_id: "foreign", revision: 1, state: { name: "Alice" } },
            { ui_id: payload.ui_id, revision: 3, state: { name: "Alice" } },
            { ui_id: payload.ui_id, revision: -1, state: { name: "Alice" } },
            { ui_id: payload.ui_id, revision: "bad", state: { name: "Alice" } },
            { ui_id: 1, revision: 1, state: { name: "Alice" } },
        ])
            expect(mergeSavedState(payload, envelope)).toEqual(base);
        // Incomplete envelopes are raw maps: only declared, compatible scalar values survive.
        expect(mergeSavedState(payload, { state: { name: "Alice" } })).toEqual(base);
        expect(mergeSavedState(payload, { ui_id: "saved", revision: 1, state: null })).toEqual({
            ...base,
            ui_id: "saved",
            revision: 1,
            state: null,
        });
        expect(mergeSavedState(payload, null)).toEqual(base);
    });

    it("should infer nullable string and number bindings and reject contradictory types", () => {
        const payload = parsed({ ...form, state: { name: null, quantity: null, plan: null } });
        expect(mergeSavedState(payload, { name: "Alice", quantity: 2, plan: "plus" })).toEqual({
            name: "Alice",
            quantity: 2,
            plan: "plus",
        });
        expect(validateSubmission(payload, "form", initialState(payload))).toEqual({
            ok: false,
            invalidKeys: ["name"],
        });
        expect(mergeSavedState(payload, { quantity: "2", plan: "removed" })).toEqual(payload.state);
    });

    it("should retain valid selections across branch graphs and reset removed graph ids on revision", () => {
        const raw = structuredClone(knowledgeMap);
        raw.nodes[5].nodes![1].id = "nutrition_mechanism";
        raw.nodes[5].edges![0].to = "nutrition_mechanism";
        raw.nodes[5].edges![1].from = "nutrition_mechanism";
        const payload = parsed(raw);
        expect(mergeSavedState(payload, { focus: "nutrition_mechanism" }).focus).toBe("nutrition_mechanism");
        expect(mergeSavedState(payload, { focus: "maillard" }).focus).toBe("maillard");
        expect(mergeSavedState(payload, { focus: "removed" }).focus).toBeNull();
        expect(
            mergeSavedState(
                { ...parsed(knowledgeMap), revision: 1 },
                { ui_id: payload.ui_id, revision: 0, state: { focus: "nutrition_mechanism" } },
            ).focus,
        ).toBeNull();
        const previous = parsed(revision0);
        const next = parsed(revision1);
        expect(
            mergeSavedState(next, {
                ui_id: previous.ui_id,
                revision: previous.revision,
                state: { plan: "basic", enabled: true },
            }),
        ).toEqual({ plan: "plus", enabled: true });
    });

    it("should evaluate equality, membership and negation without coercion", () => {
        expect(evaluateCondition({ state: "x", equals: 1 }, { x: "1" })).toBe(false);
        expect(evaluateCondition({ state: "x", in: [null, "yes"] }, { x: null })).toBe(true);
        expect(evaluateCondition({ state: "x", equals: true, not: true }, { x: false })).toBe(true);
        expect(evaluateCondition({ state: "missing", equals: null }, {})).toBe(false);
    });

    it("should validate required and bounded form fields and include all descendant binds", () => {
        const payload = parsed(form);
        expect(validateSubmission(payload, "form", payload.state)).toEqual({ ok: false, invalidKeys: ["name"] });
        expect(validateSubmission(payload, "form", { name: " ", quantity: 100, plan: "removed" })).toEqual({
            ok: false,
            invalidKeys: ["plan", "quantity", "name"],
        });
        expect(
            validateSubmission(payload, "form", { name: "A".repeat(101), quantity: Infinity, plan: "basic" }).ok,
        ).toBe(false);
        expect(
            validateSubmission(payload, "form", { name: "Alice", quantity: 2, plan: "plus", extra: "private" }),
        ).toEqual({ ok: true, actionId: "answer", values: { name: "Alice", quantity: 2, plan: "plus" } });
        expect(validateSubmission({ ...payload, status: "submitted" }, "form", payload.state).ok).toBe(false);
    });

    it("should submit initial strings at the same bounds used for saved values", () => {
        const payload = parsed({
            version: 1,
            ui_id: "string-limit",
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
        });
        expect(validateSubmission(payload, "send", initialState(payload))).toEqual({
            ok: true,
            actionId: "send",
            values: payload.state,
        });
        expect(validateSubmission(payload, "send", { text: "x".repeat(201) })).toEqual({
            ok: false,
            invalidKeys: ["text"],
        });
        expect(mergeSavedState(payload, { text: "x".repeat(201) })).toEqual(payload.state);
        const long = parsed({
            ...payload,
            root: "root",
            state: { text: "x".repeat(2000) },
            nodes: [
                { id: "root", type: "stack", direction: "vertical", children: ["text", "send"] },
                { id: "text", type: "text_input", label: "Text", bind: "text", max_length: 2000 },
                ...payload.nodes,
            ],
        });
        expect(validateSubmission(long, "send", initialState(long))).toEqual({
            ok: true,
            actionId: "send",
            values: long.state,
        });
        expect(mergeSavedState(long, { text: "y".repeat(2000) }).text).toBe("y".repeat(2000));
    });

    it("should validate explicit carousel submit items through the same included-value checks", () => {
        const raw = {
            ...carousel,
            state: { selected: "item1", private: "local" },
            nodes: structuredClone(carousel.nodes),
        };
        const items = raw.nodes[1].items!;
        // Each item chooses a distinct backend action and its own explicit include list.
        items[0].action = {
            type: "submit",
            action_id: "choose",
            include: ["selected"],
        } as unknown as (typeof items)[0]["action"];
        items[1].action = { type: "submit", action_id: "skip" } as unknown as (typeof items)[1]["action"];
        const payload = parsed(raw);
        const state = initialState(payload);
        expect(validateSubmission(payload, "carousel", state, "item1")).toEqual({
            ok: true,
            actionId: "choose",
            values: { selected: "item1" },
        });
        expect(validateSubmission(payload, "carousel", state, "item2")).toEqual({
            ok: true,
            actionId: "skip",
            values: {},
        });
        expect(validateSubmission(payload, "carousel", { ...state, selected: 42 }, "item1")).toEqual({
            ok: false,
            invalidKeys: ["selected"],
        });
        for (const [nodeId, itemId] of [
            ["carousel", undefined],
            ["carousel", "missing"],
            ["carousel", "item3"],
            ["missing", "item1"],
            ["root", "item1"],
            ["item1", undefined],
        ] as const) {
            expect(validateSubmission(payload, nodeId, state, itemId)).toEqual({ ok: false, invalidKeys: [] });
        }
        expect(validateSubmission({ ...payload, status: "expired" }, "carousel", state, "item1")).toEqual({
            ok: false,
            invalidKeys: [],
        });
        const buttons = parsed(controls);
        expect(validateSubmission(buttons, "submit", { ...buttons.state, name: "Alice" }, "item1")).toEqual({
            ok: false,
            invalidKeys: [],
        });
    });

    it("should restrict button submissions to include and reject invalid action targets", () => {
        const payload = parsed(controls);
        const result = validateSubmission(payload, "submit", { ...payload.state, name: "Alice", enabled: true });
        expect(result).toEqual({
            ok: true,
            actionId: "send",
            values: { plan: "basic", features: [], name: "Alice", quantity: 1 },
        });
        expect(validateSubmission(payload, "set", payload.state).ok).toBe(false);
        expect(validateSubmission(payload, "missing", payload.state).ok).toBe(false);
        expect(validateSubmission(payload, "submit", { ...payload.state, features: ["unknown"] }).ok).toBe(false);
    });
});

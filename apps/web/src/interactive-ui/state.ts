/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
    acceptsStateValue,
    childIds,
    type InteractiveUiCondition,
    type InteractiveUiPayload,
    type InteractiveUiStateValue,
} from "./protocol";

/** Returns a mutable state copy without sharing arrays with event content. */
export function initialState(payload: InteractiveUiPayload): Record<string, InteractiveUiStateValue> {
    return Object.fromEntries(
        Object.entries(payload.state).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value]),
    );
}

/** Retains compatible values from a saved { ui_id, revision, state } envelope or a previous state map. */
export function mergeSavedState(
    payload: InteractiveUiPayload,
    saved: unknown,
): Record<string, InteractiveUiStateValue> {
    const state = initialState(payload);
    try {
        if (!saved || typeof saved !== "object" || Array.isArray(saved)) return state;
        const record = saved as Record<string, unknown>;
        let values = record;
        if (
            Object.hasOwn(record, "ui_id") &&
            Object.hasOwn(record, "revision") &&
            Object.hasOwn(record, "state") &&
            record.state !== null &&
            typeof record.state === "object" &&
            !Array.isArray(record.state)
        ) {
            if (
                record.ui_id !== payload.ui_id ||
                !Number.isSafeInteger(record.revision) ||
                (record.revision as number) < 0 ||
                (record.revision as number) > payload.revision
            )
                return state;
            values = record.state as Record<string, unknown>;
        }
        for (const key of Object.keys(state)) {
            const descriptor = Object.getOwnPropertyDescriptor(values, key);
            if (!descriptor || !("value" in descriptor)) continue;
            const value: unknown = descriptor.value;
            if (acceptsStateValue(payload, key, value)) state[key] = Array.isArray(value) ? [...value] : value;
        }
    } catch {
        /* Corrupt or inaccessible local storage must not prevent rendering. */
    }
    return state;
}

/** Evaluates the wire comparison without coercion or expression execution. */
export function evaluateCondition(
    cond: InteractiveUiCondition,
    state: Record<string, InteractiveUiStateValue>,
): boolean {
    const value = Object.hasOwn(state, cond.state) ? state[cond.state] : undefined;
    const matched =
        "equals" in cond
            ? value === cond.equals
            : cond.in.includes(value as Exclude<InteractiveUiStateValue, string[]>);
    return cond.not ? !matched : matched;
}

/** Validates a form, submit button, or explicitly selected carousel item; returns only its included keys. */
export function validateSubmission(
    payload: InteractiveUiPayload,
    nodeId: string,
    state: Record<string, InteractiveUiStateValue>,
    carouselItemId?: string,
):
    | { ok: true; actionId: string; values: Record<string, InteractiveUiStateValue> }
    | { ok: false; invalidKeys: string[] } {
    const byId = new Map(payload.nodes.map((node) => [node.id, node]));
    const node = byId.get(nodeId);
    if (!node || payload.status !== "active" || (carouselItemId !== undefined && node.type !== "carousel"))
        return { ok: false, invalidKeys: [] };
    const keys = new Set<string>();
    let actionId: string;
    if (node.type === "form") {
        actionId = node.action_id;
        const pending = [...node.children];
        const visited = new Set<string>();
        while (pending.length) {
            const id = pending.pop()!;
            if (visited.has(id)) continue;
            visited.add(id);
            const descendant = byId.get(id);
            if (!descendant) continue;
            if ("bind" in descendant && descendant.bind !== undefined) keys.add(descendant.bind);
            pending.push(...childIds(descendant));
        }
    } else {
        const action =
            node.type === "button"
                ? node.action
                : node.type === "carousel" && carouselItemId !== undefined
                  ? node.items.find((item) => item.id === carouselItemId)?.action
                  : undefined;
        if (action?.type !== "submit") return { ok: false, invalidKeys: [] };
        actionId = action.action_id;
        action.include?.forEach((key) => keys.add(key));
    }
    const invalidKeys = new Set<string>();
    const values: Record<string, InteractiveUiStateValue> = Object.create(null);
    for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(state, key);
        const value: unknown = descriptor && "value" in descriptor ? descriptor.value : undefined;
        if (!acceptsStateValue(payload, key, value)) {
            invalidKeys.add(key);
            continue;
        }
        if (
            payload.nodes.some(
                (n) =>
                    n.type === "text_input" &&
                    n.bind === key &&
                    n.required &&
                    (typeof value !== "string" || value.trim() === ""),
            )
        )
            invalidKeys.add(key);
        values[key] = Array.isArray(value) ? [...value] : value;
    }
    return invalidKeys.size ? { ok: false, invalidKeys: [...invalidKeys] } : { ok: true, actionId, values };
}

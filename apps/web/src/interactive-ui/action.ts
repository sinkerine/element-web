/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type IEventRelation, type MatrixEvent, MsgType, THREAD_RELATION_TYPE } from "matrix-js-sdk/src/matrix";
import { type RoomMessageTextEventContent } from "matrix-js-sdk/src/types";

import { addReplyToMessageContent } from "../utils/Reply";
import {
    INTERACTIVE_UI_ACTION_KEY,
    INTERACTIVE_UI_VERSION,
    type InteractiveUiPayload,
    type InteractiveUiStateValue,
} from "./protocol";

/** Text content with the extension and reply fields absent from the SDK's base text type. */
export interface InteractiveUiActionContent extends RoomMessageTextEventContent {
    "m.relates_to"?: IEventRelation;
    [INTERACTIVE_UI_ACTION_KEY]: {
        version: 1;
        ui_event_id: string | undefined;
        ui_id: string;
        revision: number;
        action_id: string;
        values: Record<string, InteractiveUiStateValue>;
        nonce: string;
    };
}

/** Builds a visible reply using already validated submission values and a caller-generated random nonce. */
export function buildActionContent(args: {
    uiEvent: MatrixEvent;
    payload: InteractiveUiPayload;
    actionId: string;
    values: Record<string, InteractiveUiStateValue>;
    triggerLabel: string;
    nonce: string;
}): InteractiveUiActionContent {
    const { uiEvent, payload, actionId, values, triggerLabel, nonce } = args;
    const labels = new Map<string, string>();
    const valueLabels = new Map<string, Map<string, string>>();
    for (const node of payload.nodes) {
        const key = "bind" in node ? node.bind : node.type === "graph" ? node.bind_selected : undefined;
        if (!key) continue;
        if ("label" in node) labels.set(key, node.label);
        if (node.type === "select" || node.type === "choice" || node.type === "tabs") {
            valueLabels.set(
                key,
                new Map((node.type === "tabs" ? node.tabs : node.options).map((o) => [o.value, o.label])),
            );
        }
        if (node.type === "graph") {
            const entries = valueLabels.get(key) ?? new Map<string, string>();
            node.nodes.forEach((n) => entries.set(n.id, n.label));
            valueLabels.set(key, entries);
        }
    }
    const descriptions = Object.entries(values).map(([key, value]) => {
        const describe = (v: InteractiveUiStateValue): string =>
            typeof v === "string" ? (valueLabels.get(key)?.get(v) ?? v) : v === null ? "—" : String(v);
        return `${labels.get(key) ?? key}: ${Array.isArray(value) ? value.map(describe).join(", ") : describe(value)}`;
    });
    const body = Array.from(`“${triggerLabel}”${descriptions.length ? ` — ${descriptions.join("; ")}` : ""}`)
        .slice(0, 1000)
        .join("");
    const sender = uiEvent.getSender();
    const content: InteractiveUiActionContent = {
        "msgtype": MsgType.Text,
        body,
        "m.mentions": { user_ids: sender ? [sender] : [] },
        [INTERACTIVE_UI_ACTION_KEY]: {
            version: INTERACTIVE_UI_VERSION,
            ui_event_id: uiEvent.getId(),
            ui_id: payload.ui_id,
            revision: payload.revision,
            action_id: actionId,
            values: Object.fromEntries(
                Object.entries(values).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value]),
            ),
            nonce,
        },
    };
    if (uiEvent.threadRootId)
        content["m.relates_to"] = { rel_type: THREAD_RELATION_TYPE.name, event_id: uiEvent.threadRootId };
    addReplyToMessageContent(content, uiEvent);
    return content;
}

/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { MatrixEvent } from "matrix-js-sdk/src/matrix";
import { describe, expect, it } from "vitest";

import fixture from "./fixtures/valid/knowledge-map.en.json";
import { INTERACTIVE_UI_ACTION_KEY, INTERACTIVE_UI_KEY, parseInteractiveUi } from "./protocol";
import { buildActionContent } from "./action";

function event(thread = false): MatrixEvent {
    return new MatrixEvent({
        event_id: "$original",
        room_id: "!room:example.org",
        sender: "@bot:example.org",
        type: "m.room.message",
        content: {
            msgtype: "m.text",
            body: "Fallback",
            ...(thread ? { "m.relates_to": { rel_type: "m.thread", event_id: "$thread", is_falling_back: true } } : {}),
        },
    });
}
function build(uiEvent: MatrixEvent, triggerLabel = "Explain this mechanism") {
    const parsed = parseInteractiveUi({ [INTERACTIVE_UI_KEY]: fixture });
    if (!parsed?.ok) throw new Error("Invalid fixture");
    return buildActionContent({
        uiEvent,
        payload: parsed.payload,
        actionId: "explain_node",
        values: { focus: "maillard" },
        triggerLabel,
        nonce: "abcdefghijklmnopqrstuv",
    });
}

describe("action", () => {
    it("should build a visible room reply with option labels, sender mention and wire values", () => {
        const content = build(event());
        expect(content.body).toBe("“Explain this mechanism” — focus: Maillard reaction");
        expect(content["m.mentions"]).toEqual({ user_ids: ["@bot:example.org"] });
        expect(content["m.relates_to"]).toEqual({ "m.in_reply_to": { event_id: "$original" } });
        expect(content[INTERACTIVE_UI_ACTION_KEY]).toEqual({
            version: 1,
            ui_event_id: "$original",
            ui_id: "knowledge-map",
            revision: 0,
            action_id: "explain_node",
            values: { focus: "maillard" },
            nonce: "abcdefghijklmnopqrstuv",
        });
    });

    it("should preserve thread relations using the shared reply helper", () => {
        expect(build(event(true))["m.relates_to"]).toEqual({
            "rel_type": "m.thread",
            "event_id": "$thread",
            "is_falling_back": false,
            "m.in_reply_to": { event_id: "$original" },
        });
    });

    it("should reply to the original event after an edit", () => {
        const original = event(true);
        original.makeReplaced(
            new MatrixEvent({
                event_id: "$edit",
                sender: "@bot:example.org",
                type: "m.room.message",
                room_id: "!room:example.org",
                content: {
                    "m.relates_to": { rel_type: "m.replace", event_id: "$original" },
                    "m.new_content": { body: "Updated", msgtype: "m.text" },
                },
            }),
        );
        const content = build(original);
        expect(content[INTERACTIVE_UI_ACTION_KEY].ui_event_id).toBe("$original");
        expect(content["m.relates_to"]?.["m.in_reply_to"]?.event_id).toBe("$original");
        expect(content["m.relates_to"]?.event_id).toBe("$thread");
    });

    it("should bound the readable body by Unicode characters", () => {
        expect(Array.from(build(event(), "中😀".repeat(1000)).body).length).toBe(1000);
    });
});

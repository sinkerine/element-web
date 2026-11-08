/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { MatrixEvent } from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";
import { describe, expect, it, vi } from "vitest";

import { BOT_COMMAND_DESCRIPTION_EVENT_TYPE, parseBotCommandDescription } from "./BotCommandProtocol";

function event(content: unknown, overrides = {}): MatrixEvent {
    return new MatrixEvent({
        type: BOT_COMMAND_DESCRIPTION_EVENT_TYPE,
        sender: "@hermes:example.org",
        state_key: "unhashed",
        origin_server_ts: 42,
        // Deliberately include malformed wire content to exercise validation.
        content: content as MatrixEvent["event"]["content"],
        ...overrides,
    });
}
const primitive = { schema_type: "primitive", type: "string" };
const parameter = { key: "prompt", schema: primitive };
const content = { command: "model", parameters: [parameter] };

describe("BotCommandProtocol", () => {
    it("should parse the MSC4391 example using the unstable event type", () => {
        const parsed = parseBotCommandDescription(
            event(
                {
                    command: "ban",
                    parameters: [
                        {
                            key: "target_room",
                            schema: { schema_type: "primitive", type: "room_id" },
                            description: { "m.text": [{ body: "The room ID" }] },
                        },
                        {
                            key: "timeout_seconds",
                            schema: { schema_type: "primitive", type: "integer" },
                            description: { "m.text": [{ body: "The timeout in seconds" }] },
                        },
                        {
                            key: "apply_to_policy",
                            schema: { schema_type: "primitive", type: "boolean" },
                            description: { "m.text": [{ body: "Whether to apply this to the policy" }] },
                            optional: true,
                        },
                        {
                            key: "target_users",
                            schema: { schema_type: "array", items: { schema_type: "primitive", type: "user_id" } },
                            description: { "m.text": [{ body: "The user ID(s)" }] },
                        },
                    ],
                    description: { "m.text": [{ body: "An example command with arguments" }] },
                    extra: true,
                },
                { sender: "@draupnir:draupnir.space", state_key: "JBDLR6YMe+72yqsEMi/MVdTmjN3ynPThMz+M7QLATZQ=" },
            ),
        );
        expect(parsed).toMatchObject({
            botUserId: "@draupnir:draupnir.space",
            command: "ban",
            description: "An example command with arguments",
            aliases: [],
            ts: 42,
        });
        expect(parsed?.parameters.map((p) => [p.key, p.optional])).toEqual([
            ["target_room", false],
            ["timeout_seconds", false],
            ["apply_to_policy", true],
            ["target_users", false],
        ]);
        expect(parsed?.parameters[3]).toMatchObject({
            schema: { schema_type: "array", items: { schema_type: "primitive", type: "user_id" } },
            description: "The user ID(s)",
        });
    });

    it("should preserve canonical names and truncate display descriptions", () => {
        const parsed = parseBotCommandDescription(
            event({
                command: "Model set Provider",
                aliases: ["mod", "reload-mcp"],
                description: { "m.text": [{ body: "x".repeat(210) }] },
                parameters: [{ ...parameter, description: { "m.text": [{ body: "y".repeat(210) }] }, optional: true }],
            }),
        );
        expect(parsed?.command).toBe("Model set Provider");
        expect(parsed?.aliases).toEqual(["mod", "reload-mcp"]);
        expect(parsed?.description).toHaveLength(200);
        expect(parsed?.parameters[0].description).toHaveLength(200);
        expect(parsed?.parameters[0].optional).toBe(true);
    });

    it.each(["string", "integer", "boolean", "user_id", "server_name", "room_alias", "room_id", "event_id"])(
        "should accept primitive %s",
        (type) => {
            expect(
                parseBotCommandDescription(
                    event({ ...content, parameters: [{ ...parameter, schema: { schema_type: "primitive", type } }] }),
                ),
            ).not.toBeNull();
        },
    );

    it.each([
        { schema_type: "literal", literal_type: "string", value: "auto" },
        { schema_type: "literal", literal_type: "integer", value: -2 },
        { schema_type: "literal", literal_type: "boolean", value: false },
        { schema_type: "union", variants: [primitive, { schema_type: "literal", literal_type: "integer", value: 1 }] },
        { schema_type: "array", items: primitive },
        { schema_type: "array", items: { schema_type: "union", variants: [primitive] } },
    ])("should accept valid schema $schema_type", (schema) => {
        expect(
            parseBotCommandDescription(event({ ...content, parameters: [{ ...parameter, schema }] })),
        ).not.toBeNull();
    });

    it.each([
        null,
        [],
        {},
        { ...content, command: 1 },
        ...[
            "",
            "/model",
            "four token command name",
            "has  spaces",
            " leading",
            "trailing ",
            "a".repeat(65),
            "-bad",
            "é",
        ].map((command) => ({ ...content, command })),
        ...[null, "mod", [1], ["two tokens"], Array(11).fill("a")].map((aliases) => ({ ...content, aliases })),
        ...[
            undefined,
            {},
            Array.from({ length: 33 }, () => ({ ...parameter })),
            [parameter, parameter],
            [{ ...parameter, key: "1bad" }],
            [{ ...parameter, key: "a".repeat(65) }],
            [{ ...parameter, optional: "true" }],
        ].map((parameters) => ({ ...content, parameters })),
    ])("should reject malformed content %#", (invalid) => {
        expect(parseBotCommandDescription(event(invalid))).toBeNull();
    });

    it.each([
        null,
        {},
        { schema_type: "primitive", type: "unknown" },
        { schema_type: "literal", literal_type: "integer", value: 1.5 },
        { schema_type: "literal", literal_type: "boolean", value: "true" },
        { schema_type: "literal", literal_type: "string", value: 1 },
        { schema_type: "union", variants: [] },
        { schema_type: "union", variants: [null] },
        { schema_type: "union", variants: [{ schema_type: "union", variants: [primitive] }] },
        { schema_type: "union", variants: [{ schema_type: "array", items: primitive }] },
        { schema_type: "array", items: { schema_type: "array", items: primitive } },
    ])("should reject invalid or nested schema %#", (schema) => {
        expect(parseBotCommandDescription(event({ ...content, parameters: [{ ...parameter, schema }] }))).toBeNull();
    });

    it("should reject wrong event types and missing senders", () => {
        expect(parseBotCommandDescription(event(content, { type: "m.room.message" }))).toBeNull();
        expect(parseBotCommandDescription(event(content, { sender: undefined }))).toBeNull();
    });

    it("should memoise valid and invalid events and log no event content", () => {
        const debug = vi.spyOn(logger, "debug").mockImplementation(() => {});
        const invalid = event({ command: "secret" });
        expect(parseBotCommandDescription(invalid)).toBeNull();
        expect(parseBotCommandDescription(invalid)).toBeNull();
        expect(debug).toHaveBeenCalledExactlyOnceWith("Ignoring unusable bot command description");
        const valid = event(content);
        expect(parseBotCommandDescription(valid)).toBe(parseBotCommandDescription(valid));
        debug.mockRestore();
    });

    it("should never throw when reading malformed events", () => {
        const malformed = event(content);
        vi.spyOn(malformed, "getContent").mockImplementation(() => {
            throw new Error("bad state");
        });
        expect(parseBotCommandDescription(malformed)).toBeNull();
    });
});

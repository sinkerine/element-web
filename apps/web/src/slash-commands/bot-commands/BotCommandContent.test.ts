/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { describe, expect, it } from "vitest";

import { createBotCommandContent, mapBotCommandArguments } from "./BotCommandContent";
import { type BotCommandParameter, type BotCommandPrimitiveType, type BotCommandSchema } from "./BotCommandProtocol";
import { type ResolvedBotCommand } from "./RoomBotCommands";

function parameter(type: BotCommandPrimitiveType, key = "value", optional = false): BotCommandParameter {
    return { key, optional, description: "", schema: { schema_type: "primitive", type } };
}
function schemaParameter(schema: BotCommandSchema): BotCommandParameter {
    return { key: "value", optional: false, description: "", schema };
}
function resolved(parameters: BotCommandParameter[], argsText = ""): ResolvedBotCommand {
    return {
        command: {
            botUserId: "@hermes:example.org",
            botName: "Hermes",
            command: "Model set",
            aliases: [],
            description: "",
            ts: 1,
            qualifier: "hermes",
            requiresQualifier: true,
            parameters,
        },
        argsText,
    };
}

describe("BotCommandContent", () => {
    it("should keep the final string argument verbatim and fill required parameters first", () => {
        expect(
            mapBotCommandArguments(
                [parameter("string", "name", true), parameter("integer", "count")],
                "  -2  gpt-5.5 --provider  openrouter \n",
            ),
        ).toEqual({ count: -2, name: "gpt-5.5 --provider  openrouter \n" });
        expect(
            mapBotCommandArguments([parameter("string", "first"), parameter("string", "last")], "one two  three"),
        ).toEqual({ first: "one", last: "two  three" });
    });

    it.each([
        ["integer", "-12", -12],
        ["integer", "0", 0],
        ["boolean", "true", true],
        ["boolean", "YES", true],
        ["boolean", "on", true],
        ["boolean", "false", false],
        ["boolean", "no", false],
        ["boolean", "OFF", false],
        ["user_id", "@alice:example.org", "@alice:example.org"],
        ["user_id", "@alice:[::1]:8448", "@alice:[::1]:8448"],
        ["room_alias", "#room:[::1]", "#room:[::1]"],
        ["room_alias", "#room:example.org:8448", "#room:example.org:8448"],
        ["server_name", "example.org:8448", "example.org:8448"],
        ["server_name", "[::1]:8448", "[::1]:8448"],
    ] as const)("should map %s value %s", (type, text, expected) => {
        expect(mapBotCommandArguments([parameter(type)], text)).toEqual({ value: expected });
    });

    it.each([
        ["integer", "1.2"],
        ["integer", "+2"],
        ["integer", "9007199254740992"],
        ["boolean", "1"],
        ["user_id", "alice:example.org"],
        ["user_id", "@alice"],
        ["room_alias", "!room:example.org"],
        ["server_name", "https://example.org"],
        ["room_id", "!room:example.org"],
        ["event_id", "$event"],
    ] as const)("should reject unmappable %s value %s", (type, text) => {
        expect(mapBotCommandArguments([parameter(type)], text)).toBeNull();
    });

    it("should map literals and choose the first matching union variant", () => {
        for (const [literal_type, value, text] of [
            ["string", "auto", "auto"],
            ["integer", 2, "2"],
            ["boolean", false, "off"],
        ] as const) {
            expect(
                mapBotCommandArguments([schemaParameter({ schema_type: "literal", literal_type, value })], text),
            ).toEqual({ value });
            expect(
                mapBotCommandArguments([schemaParameter({ schema_type: "literal", literal_type, value })], "wrong"),
            ).toBeNull();
        }
        const union = schemaParameter({
            schema_type: "union",
            variants: [
                { schema_type: "literal", literal_type: "string", value: "auto" },
                { schema_type: "primitive", type: "integer" },
            ],
        });
        expect(mapBotCommandArguments([union], "auto")).toEqual({ value: "auto" });
        expect(mapBotCommandArguments([union], "12")).toEqual({ value: 12 });
        expect(mapBotCommandArguments([union], "wrong")).toBeNull();
        expect(
            mapBotCommandArguments(
                [
                    schemaParameter({
                        schema_type: "union",
                        variants: [
                            { schema_type: "primitive", type: "string" },
                            { schema_type: "primitive", type: "integer" },
                        ],
                    }),
                ],
                "12",
            ),
        ).toEqual({ value: "12" });
    });

    it("should reject unsupported schemas even when optional or in a union", () => {
        expect(
            mapBotCommandArguments(
                [schemaParameter({ schema_type: "array", items: { schema_type: "primitive", type: "string" } })],
                "one two",
            ),
        ).toBeNull();
        expect(mapBotCommandArguments([parameter("room_id", "room", true)], "")).toBeNull();
        expect(
            mapBotCommandArguments(
                [
                    schemaParameter({
                        schema_type: "union",
                        variants: [
                            { schema_type: "primitive", type: "string" },
                            { schema_type: "primitive", type: "event_id" },
                        ],
                    }),
                ],
                "text",
            ),
        ).toBeNull();
    });

    it("should reject missing required arguments and leftover text, but omit absent optional arguments", () => {
        expect(mapBotCommandArguments([parameter("string")], "  ")).toBeNull();
        expect(mapBotCommandArguments([parameter("integer")], "1 two")).toBeNull();
        expect(mapBotCommandArguments([], "extra")).toBeNull();
        expect(mapBotCommandArguments([], " \n ")).toEqual({});
        expect(mapBotCommandArguments([parameter("string", "optional", true)], "")).toEqual({});
    });

    it("should safely map parameter keys which also name Object properties", () => {
        const mapped = mapBotCommandArguments([parameter("string", "__proto__")], "value");
        expect(Object.hasOwn(mapped!, "__proto__")).toBe(true);
        expect(mapped?.__proto__).toBe("value");
    });

    it("should build canonical plain-text content with only the bot mention and structured arguments", () => {
        expect(
            createBotCommandContent(resolved([parameter("string", "name")], "**gpt** --provider openrouter")),
        ).toEqual({
            "msgtype": "m.text",
            "body": "/Model set **gpt** --provider openrouter",
            "m.mentions": { user_ids: ["@hermes:example.org"] },
            "org.matrix.msc4391.command": {
                command: "Model set",
                arguments: { name: "**gpt** --provider openrouter" },
            },
        });
    });

    it("should omit the structured block when mapping fails", () => {
        expect(createBotCommandContent(resolved([parameter("integer")], "invalid"))).toEqual({
            "msgtype": "m.text",
            "body": "/Model set invalid",
            "m.mentions": { user_ids: ["@hermes:example.org"] },
        });
        expect(createBotCommandContent(resolved([]))).toEqual({
            "msgtype": "m.text",
            "body": "/Model set",
            "m.mentions": { user_ids: ["@hermes:example.org"] },
            "org.matrix.msc4391.command": { command: "Model set", arguments: {} },
        });
    });
});

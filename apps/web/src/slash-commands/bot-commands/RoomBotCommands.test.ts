/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { EventTimeline, MatrixEvent, KnownMembership, type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BOT_COMMAND_DESCRIPTION_EVENT_TYPE } from "./BotCommandProtocol";
import { formatBotCommandUsage, getRoomBotCommands, resolveBotCommand } from "./RoomBotCommands";
import { CommandMap } from "../SlashCommands";

vi.mock("../SlashCommands", () => ({ CommandMap: new Map() }));

function event(command: string, sender = "@hermes:example.org", ts = 1, aliases: string[] = []): MatrixEvent {
    return new MatrixEvent({
        type: BOT_COMMAND_DESCRIPTION_EVENT_TYPE,
        sender,
        origin_server_ts: ts,
        content: { command, parameters: [], aliases },
    });
}

function setup(events: MatrixEvent[] = []) {
    const members = new Map(
        events.map((ev) => [ev.getSender()!, { membership: KnownMembership.Join, name: "Hermes" }]),
    );
    const state = { getStateEvents: vi.fn(() => events) };
    const timeline = { getState: vi.fn(() => state) };
    const room = {
        roomId: "!room:example.org",
        getLiveTimeline: () => timeline,
        getMember: (id: string) => members.get(id),
    } as unknown as Room;
    const client = { getUserId: () => "@me:example.org" } as MatrixClient;
    return { room, client, members, state, timeline };
}

describe("RoomBotCommands", () => {
    beforeEach(() => CommandMap.clear());

    it("should return no commands without descriptions or live state", () => {
        const { room, client, timeline } = setup();
        expect(getRoomBotCommands(room, client)).toEqual([]);
        timeline.getState.mockReturnValue(undefined as never);
        expect(getRoomBotCommands(room, client)).toEqual([]);
    });

    it("should read live forwards state and deduplicate by sender and case-insensitive command, newest first", () => {
        const { room, client, state, timeline } = setup([
            event("Model", undefined, 2),
            event("model", undefined, 1),
            event("a", "@another:example.org"),
            event("Model", "@another:example.org"),
        ]);
        expect(getRoomBotCommands(room, client).map((c) => [c.botUserId, c.command, c.ts])).toEqual([
            ["@another:example.org", "Model", 1],
            ["@another:example.org", "a", 1],
            ["@hermes:example.org", "Model", 2],
        ]);
        expect(timeline.getState).toHaveBeenCalledWith(EventTimeline.FORWARDS);
        expect(state.getStateEvents).toHaveBeenCalledWith(BOT_COMMAND_DESCRIPTION_EVENT_TYPE);
    });

    it("should exclude self, non-joined and invalid descriptions and reflect updates immediately", () => {
        const events = [
            event("model"),
            event("self", "@me:example.org"),
            event("left", "@left:example.org"),
            event(""),
        ];
        const { room, client, members } = setup(events);
        members.get("@left:example.org")!.membership = KnownMembership.Leave;
        expect(getRoomBotCommands(room, client)).toHaveLength(1);
        members.delete("@hermes:example.org");
        expect(getRoomBotCommands(room, client)).toEqual([]);
        members.set("@hermes:example.org", { membership: KnownMembership.Join, name: "" });
        events.splice(0, events.length, event("skill"));
        expect(getRoomBotCommands(room, client)[0]).toMatchObject({ command: "skill", botName: "@hermes:example.org" });
        events.splice(
            0,
            1,
            new MatrixEvent({ type: BOT_COMMAND_DESCRIPTION_EVENT_TYPE, sender: "@hermes:example.org", content: {} }),
        );
        expect(getRoomBotCommands(room, client)).toEqual([]);
    });

    it("should enforce per-bot and per-room limits after sorting", () => {
        const events = ["@a:example.org", "@b:example.org", "@c:example.org"].flatMap((bot) =>
            Array.from({ length: 505 }, (_, i) => event(`cmd${String(i).padStart(3, "0")}`, bot)),
        );
        const { room, client } = setup(events.reverse());
        const commands = getRoomBotCommands(room, client);
        expect(commands).toHaveLength(1000);
        expect(commands.filter((c) => c.botUserId === "@a:example.org")).toHaveLength(500);
        expect(commands[0].command).toBe("cmd000");
        expect(commands[999]).toMatchObject({ botUserId: "@b:example.org", command: "cmd499" });
    });

    it("should reserve enabled built-ins, including aliases, and allow explicit bot qualification", () => {
        const enabled = vi.fn(() => true);
        CommandMap.set("help", { isEnabled: enabled } as never);
        const { room, client } = setup([event("help"), event("assist", undefined, 1, ["help"])]);
        expect(getRoomBotCommands(room, client).every((c) => c.requiresQualifier)).toBe(true);
        expect(resolveBotCommand(room, client, "/HELP")).toBeNull();
        expect(resolveBotCommand(room, client, "/help@HeRmEs text")?.argsText).toBe("text");
        expect(enabled).toHaveBeenCalledWith(client, room.roomId);
        enabled.mockReturnValue(false);
        expect(getRoomBotCommands(room, client).some((c) => c.requiresQualifier)).toBe(false);
    });

    it("should resolve aliases, hyphens, case and longest multi-token names while preserving arguments", () => {
        const { room, client } = setup([
            event("Model", undefined, 1, ["mod"]),
            event("Model set"),
            event("Model set Provider"),
            event("reload-mcp"),
        ]);
        expect(resolveBotCommand(room, client, "/mOd  gpt  provider \n")?.argsText).toBe("gpt  provider \n");
        expect(resolveBotCommand(room, client, "/MODEL set Provider xyz")?.command.command).toBe("Model set Provider");
        expect(resolveBotCommand(room, client, "/Model set@hermes:example.org x")?.command.command).toBe("Model set");
        expect(resolveBotCommand(room, client, "/reload-mcp")?.argsText).toBe("");
    });

    it("should require qualification for ambiguous names and aliases", () => {
        const { room, client } = setup([event("model"), event("other", "@other:example.org", 1, ["model"])]);
        expect(getRoomBotCommands(room, client).every((c) => c.requiresQualifier)).toBe(true);
        expect(resolveBotCommand(room, client, "/model")).toBeNull();
        expect(resolveBotCommand(room, client, "/model@other")?.command.command).toBe("other");
    });

    it("should use full-ID qualifiers for localpart collisions", () => {
        const { room, client } = setup([event("model"), event("model", "@hermes:elsewhere.org")]);
        expect(getRoomBotCommands(room, client).map((c) => c.qualifier)).toEqual([
            "hermes:elsewhere.org",
            "hermes:example.org",
        ]);
        expect(resolveBotCommand(room, client, "/model@hermes")).toBeNull();
        expect(resolveBotCommand(room, client, "/model@HERMES:EXAMPLE.ORG")?.command.botUserId).toBe(
            "@hermes:example.org",
        );
    });

    it.each(["model", " /model", "//model", "/unknown", "/models", "/model@unknown", "/model@"])(
        "should reject %s",
        (text) => {
            const { room, client } = setup([event("model")]);
            expect(resolveBotCommand(room, client, text)).toBeNull();
        },
    );

    it("should format required and optional parameter usage", () => {
        expect(
            formatBotCommandUsage([
                {
                    key: "prompt",
                    schema: { schema_type: "primitive", type: "string" },
                    description: "",
                    optional: false,
                },
                { key: "name", schema: { schema_type: "primitive", type: "string" }, description: "", optional: true },
            ]),
        ).toBe("<prompt> [name]");
        expect(formatBotCommandUsage([])).toBe("");
    });
});

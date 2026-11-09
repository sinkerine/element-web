/*
Copyright 2025 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { MatrixEvent, KnownMembership, type Room } from "matrix-js-sdk/src/matrix";
import { render } from "test-utils-rtl";
import { stubClient } from "test-utils";

import CommandProvider from "./CommandProvider";
import { Command } from "../slash-commands/command";
import { CommandCategories } from "../slash-commands/interface";
import { _td } from "../languageHandler";
import * as SlashCommands from "../slash-commands/SlashCommands";
import { BOT_COMMAND_DESCRIPTION_EVENT_TYPE } from "../slash-commands/bot-commands/BotCommandProtocol";
import { type ICompletion } from "./Autocompleter";
import { MatrixClientPeg } from "../MatrixClientPeg";

const originalCommands = SlashCommands.Commands;
const originalCommandMap = SlashCommands.CommandMap;

function botEvent(
    command: string,
    { sender = "@hermes:server", parameters = false, description = "", aliases = [] as string[] } = {},
): MatrixEvent {
    return new MatrixEvent({
        type: BOT_COMMAND_DESCRIPTION_EVENT_TYPE,
        sender,
        state_key: command,
        origin_server_ts: 1,
        content: {
            command,
            aliases,
            description: { "m.text": [{ body: description }] },
            parameters: parameters
                ? [
                      { key: "name", schema: { schema_type: "primitive", type: "string" } },
                      { key: "provider", schema: { schema_type: "primitive", type: "string" }, optional: true },
                  ]
                : [],
        },
    });
}

function rowText(completion: ICompletion): string {
    const { container, unmount } = render(completion.component);
    const text = container.textContent!;
    unmount();
    return text;
}

describe("CommandProvider", () => {
    let room: Room;
    let events: MatrixEvent[];
    let joined: boolean;

    const complete = (provider: CommandProvider, query: string, limit = -1): Promise<ICompletion[]> =>
        provider.getCompletions(query, { beginning: true, start: query.length, end: query.length }, false, limit);

    afterEach(() => {
        Object.defineProperty(SlashCommands, "Commands", { value: originalCommands, configurable: true });
        Object.defineProperty(SlashCommands, "CommandMap", { value: originalCommandMap, configurable: true });
    });

    beforeEach(() => {
        stubClient();
        events = [];
        joined = true;
        room = {
            roomId: "!room:server",
            getLiveTimeline: () => ({ getState: () => ({ getStateEvents: () => events }) }),
            getMember: (id: string) => ({
                membership: joined ? KnownMembership.Join : KnownMembership.Leave,
                name: id === "@hermes:server" ? "Hermes" : "Other bot",
            }),
        } as unknown as Room;
    });

    it("should list every built-in before bot rows for a bare slash, ignoring the limit", async () => {
        const provider = new CommandProvider(room);
        const builtIns = await complete(provider, "/");
        expect(builtIns.length).toBeGreaterThan(0);
        events.push(botEvent("model", { parameters: true, description: "Choose a model" }), botEvent("arxiv"));
        const rows = await complete(provider, "/", 1);
        expect(rows.slice(0, builtIns.length)).toEqual(builtIns);
        expect(rows.slice(builtIns.length).map((row) => row.completion)).toEqual(["/arxiv ", "/model "]);
        expect(rowText(rows.at(-1)!)).toBe("/model<name> [provider]Choose a model (from Hermes)");
        expect(rowText(rows.at(-2)!)).toBe("/arxivCommand from Hermes");
    });

    it.each([
        ["/mod", "model"],
        ["/reload-m", "reload-mcp"],
        ["/paper", "arxiv"],
        ["/astronomy", "arxiv"],
        ["/Hermes", "arxiv"],
    ])("should fuzzy match %s to %s", async (query, command) => {
        events.push(botEvent(command, { description: "Search astronomy", aliases: ["paper"] }));
        const rows = await complete(new CommandProvider(room), query);
        expect(rows.some((row) => row.completion === `/${command} `)).toBe(true);
    });

    it("should show built-in help first and qualify the bot command", async () => {
        events.push(botEvent("help"));
        const provider = new CommandProvider(room);
        const rows = await complete(provider, "/help");
        expect(rows[0].completion).toBe("/help");
        expect(rows.at(-1)!.completion).toBe("/help@hermes ");
        expect(rowText(rows.at(-1)!)).toBe("/help@hermesCommand from Hermes");
        for (const query of ["/help@her", "/help@hermes", "/help@hermes:server"]) {
            expect((await complete(provider, query)).map((row) => row.completion)).toEqual([
                query === "/help@hermes" ? query : "/help@hermes ",
            ]);
        }
        expect(await complete(provider, "/help@unknown")).toEqual([]);
    });

    it("should limit fuzzy bot matches while keeping bare-slash results comprehensive", async () => {
        events.push(botEvent("model"), botEvent("model-list"));
        const rows = await complete(new CommandProvider(room), "/mod", 1);
        expect(rows.map((row) => row.completion)).toEqual(["/model "]);
    });

    it("should preserve an exact bot name and qualify colliding bot localparts", async () => {
        events.push(botEvent("arxiv"));
        const provider = new CommandProvider(room);
        expect((await complete(provider, "/arxiv")).map((row) => row.completion)).toEqual(["/arxiv"]);
        events.push(botEvent("arxiv", { sender: "@hermes:elsewhere" }));
        expect((await complete(provider, "/arxiv@hermes:ser")).map((row) => row.completion)).toEqual([
            "/arxiv@hermes:server ",
        ]);
    });

    it("should qualify both bots when names clash", async () => {
        events.push(botEvent("model"), botEvent("model", { sender: "@other:server" }));
        const provider = new CommandProvider(room);
        expect((await complete(provider, "/mod")).map((row) => row.completion)).toEqual([
            "/model@hermes ",
            "/model@other ",
        ]);
        expect(await complete(provider, "/model value")).toEqual([]);
    });

    it("should preserve arguments for exact commands and hide parameterless commands after a space", async () => {
        events.push(botEvent("model", { parameters: true }), botEvent("help", { parameters: true }), botEvent("arxiv"));
        const provider = new CommandProvider(room);
        for (const query of ["/model ", "/model gpt-5.5 --provider openrouter", "/help@hermes arguments"]) {
            const rows = await complete(provider, query);
            expect(rows).toHaveLength(1);
            expect(rows[0].completion).toBe(query);
            expect(rows[0].range).toEqual({ start: 0, end: query.length });
        }
        expect(await complete(provider, "/arxiv ")).toEqual([]);
        expect(await complete(provider, "/unknown args")).toEqual([]);
    });

    it("should refresh suggestions when descriptions change or the bot leaves", async () => {
        const provider = new CommandProvider(room);
        const builtIns = await complete(provider, "/");
        events.push(botEvent("model"));
        expect(await complete(provider, "/")).toHaveLength(builtIns.length + 1);
        events.splice(0, 1, botEvent("arxiv"));
        expect((await complete(provider, "/")).at(-1)!.completion).toBe("/arxiv ");
        joined = false;
        expect(await complete(provider, "/")).toEqual(builtIns);
        joined = true;
        events[0] = new MatrixEvent({
            type: BOT_COMMAND_DESCRIPTION_EVENT_TYPE,
            sender: "@hermes:server",
            content: {},
        });
        expect(await complete(provider, "/")).toEqual(builtIns);
    });

    it("should retain built-in and unknown-command behavior without bot descriptions", async () => {
        const provider = new CommandProvider(room);
        expect(await complete(provider, "/never-published")).toEqual([]);
        expect(await complete(provider, "/never-published arguments")).toEqual([]);
        expect(await complete(provider, "ordinary text")).toEqual([]);
        expect((await complete(provider, "/topic new topic"))[0].completion).toBe("/topic new topic");
        expect(await complete(provider, "/me waves")).toEqual([]);
    });

    it("should keep built-in completions and skip bot commands without a client", async () => {
        events.push(botEvent("model", { parameters: true }));
        const getClient = vi.spyOn(MatrixClientPeg, "get").mockReturnValue(null);
        try {
            const provider = new CommandProvider(room);
            const rows = await complete(provider, "/");
            expect(rows.some((row) => row.completion === "/help ")).toBe(true);
            expect(rows.some((row) => row.completion.startsWith("/model"))).toBe(false);
            expect((await complete(provider, "/help"))[0].completion).toBe("/help");
            expect((await complete(provider, "/topic new topic"))[0].completion).toBe("/topic new topic");
            expect(await complete(provider, "/mod")).toEqual([]);
            expect(await complete(provider, "/model argument")).toEqual([]);
        } finally {
            getClient.mockRestore();
        }
    });

    it("should filter out disabled commands when arguments are provided", async () => {
        // Create a disabled command
        const disabledCommand = new Command({
            command: "disabled",
            args: "<arg>",
            description: _td("slash_command|spoiler"),
            runFn: vi.fn(),
            category: CommandCategories.messages,
            isEnabled: () => false,
        });

        // Create an enabled command
        const enabledCommand = new Command({
            command: "enabled",
            args: "<arg>",
            description: _td("slash_command|shrug"),
            runFn: vi.fn(),
            category: CommandCategories.messages,
            isEnabled: () => true,
        });

        // Mock the Commands array and CommandMap
        Object.defineProperty(SlashCommands, "Commands", {
            value: [disabledCommand, enabledCommand],
            configurable: true,
        });

        const mockCommandMap = new Map<string, Command>();
        mockCommandMap.set("disabled", disabledCommand);
        mockCommandMap.set("enabled", enabledCommand);

        Object.defineProperty(SlashCommands, "CommandMap", {
            value: mockCommandMap,
            configurable: true,
        });

        const provider = new CommandProvider(room);

        // When we search for a disabled command with arguments
        const completions = await provider.getCompletions("/disabled test", {
            beginning: true,
            start: 0,
            end: 14,
        });

        // Then we should get no completions because the command is disabled
        expect(completions).toEqual([]);

        // When we search for an enabled command with arguments
        const enabledCompletions = await provider.getCompletions("/enabled test", {
            beginning: true,
            start: 0,
            end: 13,
        });

        // Then we should get the completion because the command is enabled
        // The completion preserves the arguments when the command matches
        expect(enabledCompletions).toHaveLength(1);
        expect(enabledCompletions[0].completion).toBe("/enabled test");
    });
});

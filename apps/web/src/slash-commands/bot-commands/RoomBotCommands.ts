/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { EventTimeline, KnownMembership, type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";

import { CommandMap } from "../SlashCommands";
import {
    BOT_COMMAND_DESCRIPTION_EVENT_TYPE,
    parseBotCommandDescription,
    type BotCommandDescription,
    type BotCommandParameter,
} from "./BotCommandProtocol";

/** A command available in a room, including its display and addressing information. */
export interface RoomBotCommand extends BotCommandDescription {
    /** Room display name, falling back to the bot user ID. */
    botName: string;
    /** Localpart, or full user ID without its initial @ when localparts collide. */
    qualifier: string;
    /** An enabled built-in or another bot also offers one of these names. */
    requiresQualifier: boolean;
}
/** Composer text resolved to a command and its remaining arguments. */
export interface ResolvedBotCommand {
    command: RoomBotCommand;
    /** Leading whitespace removed; all remaining text is kept as typed. */
    argsText: string;
}

function names(command: BotCommandDescription): string[] {
    return [command.command, ...command.aliases].map((name) => name.toLowerCase());
}

function localpart(userId: string): string {
    return userId.slice(1).split(":")[0];
}

function isBuiltIn(name: string, room: Room, client: MatrixClient): boolean {
    return CommandMap.get(name.toLowerCase())?.isEnabled(client, room.roomId) ?? false;
}

/** Reads current room state; returns [] when no usable bot commands are published. Always enabled. */
export function getRoomBotCommands(room: Room, client: MatrixClient): RoomBotCommand[] {
    const events =
        room.getLiveTimeline().getState(EventTimeline.FORWARDS)?.getStateEvents(BOT_COMMAND_DESCRIPTION_EVENT_TYPE) ??
        [];
    const deduped = new Map<string, BotCommandDescription>();
    for (const event of events) {
        const command = parseBotCommandDescription(event);
        if (
            !command ||
            command.botUserId === client.getUserId() ||
            room.getMember(command.botUserId)?.membership !== KnownMembership.Join
        )
            continue;
        const key = `${command.botUserId}\0${command.command.toLowerCase()}`;
        if (!deduped.has(key) || deduped.get(key)!.ts < command.ts) deduped.set(key, command);
    }
    const counts = new Map<string, number>();
    const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
    const commands = [...deduped.values()]
        .sort((a, b) => compare(a.botUserId, b.botUserId) || compare(a.command, b.command))
        .filter((command) => {
            const count = counts.get(command.botUserId) ?? 0;
            counts.set(command.botUserId, count + 1);
            return count < 500;
        })
        .slice(0, 1000);
    return commands.map((command) => ({
        ...command,
        botName: room.getMember(command.botUserId)?.name || command.botUserId,
        qualifier: commands.some(
            (other) =>
                other.botUserId !== command.botUserId &&
                localpart(other.botUserId).toLowerCase() === localpart(command.botUserId).toLowerCase(),
        )
            ? command.botUserId.slice(1)
            : localpart(command.botUserId),
        requiresQualifier: names(command).some(
            (name) =>
                isBuiltIn(name, room, client) ||
                commands.some((other) => other.botUserId !== command.botUserId && names(other).includes(name)),
        ),
    }));
}

/** Resolves a leading slash command, using the longest name and respecting built-in precedence and ambiguity. */
export function resolveBotCommand(room: Room, client: MatrixClient, text: string): ResolvedBotCommand | null {
    if (!text.startsWith("/") || text.startsWith("//")) return null;
    const input = text.slice(1);
    const matches: { command: RoomBotCommand; end: number; name: string; qualified: boolean }[] = [];
    for (const command of getRoomBotCommands(room, client)) {
        for (const name of names(command)) {
            if (input.slice(0, name.length).toLowerCase() !== name) continue;
            let end = name.length;
            const qualified = input[end] === "@";
            if (qualified) {
                const qualifier = input.slice(end + 1).match(/^\S+/)?.[0];
                if (!qualifier) continue;
                const target = qualifier.toLowerCase();
                if (target !== command.qualifier.toLowerCase() && target !== command.botUserId.slice(1).toLowerCase())
                    continue;
                end += qualifier.length + 1;
            }
            if (end < input.length && !/\s/.test(input[end])) continue;
            matches.push({ command, end, name, qualified });
        }
    }
    matches.sort((a, b) => b.name.length - a.name.length);
    const match = matches[0];
    if (
        !match ||
        (!match.qualified &&
            (isBuiltIn(input.split(/\s/)[0], room, client) ||
                matches.some((other) => other.name === match.name && other.command !== match.command)))
    )
        return null;
    return { command: match.command, argsText: input.slice(match.end).trimStart() };
}

/** Formats required and optional parameter usage for display. */
export function formatBotCommandUsage(parameters: BotCommandParameter[]): string {
    return parameters.map((parameter) => (parameter.optional ? `[${parameter.key}]` : `<${parameter.key}>`)).join(" ");
}

/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { MsgType } from "matrix-js-sdk/src/matrix";
import { type RoomMessageEventContent } from "matrix-js-sdk/src/types";

import {
    BOT_COMMAND_CONTENT_KEY,
    type BotCommandArgumentValue,
    type BotCommandInvocation,
    type BotCommandLiteralValue,
    type BotCommandParameter,
    type BotCommandSchema,
} from "./BotCommandProtocol";
import { type ResolvedBotCommand } from "./RoomBotCommands";

const serverNamePattern = "(?:[A-Za-z0-9.-]+|\\[[0-9A-Fa-f:]+\\])(?::[0-9]+)?";
const serverName = new RegExp(`^${serverNamePattern}$`);
const userId = new RegExp(`^@[^\\s:]+:${serverNamePattern}$`);
const roomAlias = new RegExp(`^#[^\\s:]+:${serverNamePattern}$`);

function mapValue(schema: BotCommandSchema, text: string): BotCommandLiteralValue | null {
    if (schema.schema_type === "array") return null;
    if (schema.schema_type === "union") {
        for (const variant of schema.variants) {
            const value = mapValue(variant, text);
            if (value !== null) return value;
        }
        return null;
    }
    if (schema.schema_type === "literal") {
        const value = mapValue({ schema_type: "primitive", type: schema.literal_type }, text);
        return value === schema.value ? value : null;
    }
    switch (schema.type) {
        case "string":
            return text;
        case "integer":
            return /^-?\d+$/.test(text) && Number.isSafeInteger(Number(text)) ? Number(text) : null;
        case "boolean":
            if (/^(true|yes|on)$/i.test(text)) return true;
            if (/^(false|no|off)$/i.test(text)) return false;
            return null;
        case "user_id":
            return userId.test(text) ? text : null;
        case "room_alias":
            return roomAlias.test(text) ? text : null;
        case "server_name":
            return serverName.test(text) ? text : null;
        case "room_id":
        case "event_id":
            return null;
    }
}

function unsupported(schema: BotCommandSchema): boolean {
    if (schema.schema_type === "array") return true;
    if (schema.schema_type === "union") return schema.variants.some(unsupported);
    return schema.schema_type === "primitive" && (schema.type === "room_id" || schema.type === "event_id");
}

/** Maps free text in required-then-optional parameter order; returns null when it cannot be mapped cleanly. */
export function mapBotCommandArguments(
    parameters: BotCommandParameter[],
    argsText: string,
): Record<string, BotCommandArgumentValue> | null {
    if (parameters.some((parameter) => unsupported(parameter.schema))) return null;
    const ordered = [
        ...parameters.filter((parameter) => !parameter.optional),
        ...parameters.filter((parameter) => parameter.optional),
    ];
    const entries: [string, BotCommandArgumentValue][] = [];
    let rest = argsText.trimStart();
    for (const [index, parameter] of ordered.entries()) {
        if (!rest) {
            if (!parameter.optional) return null;
            continue;
        }
        const takeRest =
            index === ordered.length - 1 &&
            parameter.schema.schema_type === "primitive" &&
            parameter.schema.type === "string";
        const token = takeRest ? rest : rest.match(/^\S+/)![0];
        const value = mapValue(parameter.schema, token);
        if (value === null) return null;
        entries.push([parameter.key, value]);
        rest = rest.slice(token.length).trimStart();
    }
    return rest ? null : Object.fromEntries(entries);
}

/** Builds a plain-text invocation mentioning only the bot. Callers add reply and thread relations. */
export function createBotCommandContent(resolved: ResolvedBotCommand): RoomMessageEventContent {
    const args = mapBotCommandArguments(resolved.command.parameters, resolved.argsText);
    return {
        "msgtype": MsgType.Text,
        "body": `/${resolved.command.command}${resolved.argsText ? ` ${resolved.argsText}` : ""}`,
        "m.mentions": { user_ids: [resolved.command.botUserId] },
        ...(args === null
            ? {}
            : {
                  [BOT_COMMAND_CONTENT_KEY]: {
                      command: resolved.command.command,
                      arguments: args,
                  } satisfies BotCommandInvocation,
              }),
    };
}

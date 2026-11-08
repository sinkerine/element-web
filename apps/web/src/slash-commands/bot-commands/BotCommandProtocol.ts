/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type MatrixEvent } from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

/** Unstable MSC4391 state event type advertising one bot command. */
export const BOT_COMMAND_DESCRIPTION_EVENT_TYPE = "org.matrix.msc4391.command_description";
/** Unstable MSC4391 content block carrying a structured invocation. */
export const BOT_COMMAND_CONTENT_KEY = "org.matrix.msc4391.command";

/** Primitive types understood by MSC4391. */
export type BotCommandPrimitiveType =
    | "string"
    | "integer"
    | "boolean"
    | "user_id"
    | "server_name"
    | "room_alias"
    | "room_id"
    | "event_id";
/** Values carried by literal schemas. */
export type BotCommandLiteralValue = string | number | boolean;
/** Validated MSC4391 parameter schema. */
export type BotCommandSchema =
    | { schema_type: "primitive"; type: BotCommandPrimitiveType }
    | { schema_type: "literal"; literal_type: "string" | "integer" | "boolean"; value: BotCommandLiteralValue }
    | { schema_type: "union"; variants: BotCommandSchema[] }
    | { schema_type: "array"; items: BotCommandSchema };
/** One published parameter. */
export interface BotCommandParameter {
    key: string;
    schema: BotCommandSchema;
    /** Plain text description, or an empty string when absent. */
    description: string;
    optional: boolean;
}
/** One validated command description. */
export interface BotCommandDescription {
    botUserId: string;
    command: string;
    aliases: string[];
    description: string;
    parameters: BotCommandParameter[];
    ts: number;
}
/** Values in a structured invocation. */
export type BotCommandArgumentValue = BotCommandLiteralValue | BotCommandLiteralValue[];
/** The MSC4391 structured invocation block. */
export interface BotCommandInvocation {
    command: string;
    arguments: Record<string, BotCommandArgumentValue>;
}

const tokenPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const primitiveTypes = new Set([
    "string",
    "integer",
    "boolean",
    "user_id",
    "server_name",
    "room_alias",
    "room_id",
    "event_id",
]);
const parsedEvents = new WeakMap<MatrixEvent, BotCommandDescription | null>();

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function description(value: unknown): string {
    if (!isObject(value)) return "";
    const text = value["m.text"];
    return Array.isArray(text) && isObject(text[0]) && typeof text[0].body === "string"
        ? text[0].body.slice(0, 200)
        : "";
}

function validSchema(value: unknown, level: "top" | "item" | "variant" = "top"): value is BotCommandSchema {
    if (!isObject(value)) return false;
    switch (value.schema_type) {
        case "primitive":
            return typeof value.type === "string" && primitiveTypes.has(value.type);
        case "literal":
            return (
                (value.literal_type === "string" && typeof value.value === "string") ||
                (value.literal_type === "boolean" && typeof value.value === "boolean") ||
                (value.literal_type === "integer" &&
                    typeof value.value === "number" &&
                    Number.isSafeInteger(value.value))
            );
        case "union":
            return (
                level !== "variant" &&
                Array.isArray(value.variants) &&
                value.variants.length > 0 &&
                value.variants.every((variant) => validSchema(variant, "variant"))
            );
        case "array":
            return level === "top" && validSchema(value.items, "item");
        default:
            return false;
    }
}

function parse(event: MatrixEvent): BotCommandDescription | null {
    const content: unknown = event.getContent();
    const sender = event.getSender();
    if (event.getType() !== BOT_COMMAND_DESCRIPTION_EVENT_TYPE || !sender || !isObject(content)) return null;
    if (typeof content.command !== "string") return null;
    const tokens = content.command.split(" ");
    if (tokens.length > 3 || !tokens.every((token) => tokenPattern.test(token))) return null;
    const aliases = content.aliases === undefined ? [] : content.aliases;
    if (
        !Array.isArray(aliases) ||
        aliases.length > 10 ||
        !aliases.every((alias) => typeof alias === "string" && tokenPattern.test(alias))
    )
        return null;
    if (!Array.isArray(content.parameters) || content.parameters.length > 32) return null;
    const keys = new Set<string>();
    const parameters: BotCommandParameter[] = [];
    for (const parameter of content.parameters) {
        if (
            !isObject(parameter) ||
            typeof parameter.key !== "string" ||
            !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(parameter.key) ||
            keys.has(parameter.key) ||
            !validSchema(parameter.schema) ||
            (parameter.optional !== undefined && typeof parameter.optional !== "boolean")
        )
            return null;
        keys.add(parameter.key);
        parameters.push({
            key: parameter.key,
            schema: parameter.schema,
            description: description(parameter.description),
            optional: parameter.optional === true,
        });
    }
    return {
        botUserId: sender,
        command: content.command,
        aliases,
        description: description(content.description),
        parameters,
        ts: event.getTs(),
    };
}

/** Validates and memoises a state event; unusable descriptions return null and never throw. */
export function parseBotCommandDescription(event: MatrixEvent): BotCommandDescription | null {
    if (parsedEvents.has(event)) return parsedEvents.get(event)!;
    let result: BotCommandDescription | null = null;
    try {
        result = parse(event);
    } catch {
        // Malformed state must not interrupt composing a message.
    }
    parsedEvents.set(event, result);
    if (!result) logger.debug("Ignoring unusable bot command description");
    return result;
}

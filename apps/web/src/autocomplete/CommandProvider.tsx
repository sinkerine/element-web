/*
Copyright 2024 New Vector Ltd.
Copyright 2018 Michael Telatynski <7t3chguy@gmail.com>
Copyright 2017 Vector Creations Ltd
Copyright 2017 New Vector Ltd
Copyright 2016 Aviral Dasgupta

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React from "react";
import { type Room } from "matrix-js-sdk/src/matrix";

import { _t } from "../languageHandler";
import AutocompleteProvider from "./AutocompleteProvider";
import QueryMatcher from "./QueryMatcher";
import { TextualCompletion } from "./Components";
import { type ICompletion, type ISelectionRange } from "./Autocompleter";
import { type Command, Commands, CommandMap } from "../slash-commands/SlashCommands";
import { type TimelineRenderingType } from "../contexts/RoomContext";
import { MatrixClientPeg } from "../MatrixClientPeg";
import {
    getRoomBotCommands,
    resolveBotCommand,
    formatBotCommandUsage,
    type RoomBotCommand,
} from "../slash-commands/bot-commands/RoomBotCommands";

const COMMAND_RE = /(^\/[\w-]*(?:@\S*)?)(?: .*)?/g;

export default class CommandProvider extends AutocompleteProvider {
    public matcher: QueryMatcher<Command>;
    private room: Room;
    public constructor(room: Room, renderingType?: TimelineRenderingType) {
        super({ commandRegex: COMMAND_RE, renderingType });
        this.matcher = new QueryMatcher(Commands, {
            keys: ["command", "args", "description"],
            funcs: [({ aliases }) => aliases.join(" ")], // aliases
            context: renderingType,
        });
        this.room = room;
    }

    public async getCompletions(
        query: string,
        selection: ISelectionRange,
        force?: boolean,
        limit = -1,
    ): Promise<ICompletion[]> {
        const { command, range } = this.getCurrentCommand(query, selection);
        if (!command) return [];

        const cli = MatrixClientPeg.get();

        const botCommands = cli ? getRoomBotCommands(this.room, cli) : [];
        const botMatcher = new QueryMatcher<RoomBotCommand>(botCommands, {
            keys: ["command", "description", "botName"],
            funcs: [({ aliases }) => aliases.join(" ")],
            context: this.renderingType,
        });
        let botMatches: RoomBotCommand[] = [];
        let matches: Command[] = [];
        // check if the full match differs from the first word (i.e. returns false if the command has args)
        if (command[0] !== command[1]) {
            // The input looks like a command with arguments, perform exact match
            const name = command[1].slice(1); // strip leading `/`
            if (CommandMap.has(name) && CommandMap.get(name)!.isEnabled(cli, this.room.roomId)) {
                // some commands, namely `me` don't suit having the usage shown whilst typing their arguments
                if (CommandMap.get(name)!.hideCompletionAfterSpace) return [];
                matches = [CommandMap.get(name)!];
            } else if (cli) {
                const resolved = resolveBotCommand(this.room, cli, command[0]);
                if (resolved?.command.parameters.length) botMatches = [resolved.command];
            }
        } else {
            if (query === "/") {
                // If they have just entered `/` show everything
                // We exclude the limit on purpose to have a comprehensive list
                matches = Commands;
                botMatches = botCommands;
            } else {
                // otherwise fuzzy match against all of the fields
                matches = this.matcher.match(command[1], limit);
                // Match the name separately so qualified commands can still use fuzzy name matching.
                const [name, qualifier] = command[1].slice(1).split("@");
                botMatches = botMatcher.match(name).filter((cmd) => {
                    return (
                        qualifier === undefined ||
                        cmd.qualifier.toLowerCase().startsWith(qualifier.toLowerCase()) ||
                        cmd.botUserId.slice(1).toLowerCase().startsWith(qualifier.toLowerCase())
                    );
                });
                if (limit !== -1) botMatches = botMatches.slice(0, limit);
            }
        }

        const builtInCompletions: ICompletion[] = matches
            .filter((cmd) => {
                const display = !cmd.renderingTypes || cmd.renderingTypes.includes(this.renderingType);
                return cmd.isEnabled(cli, this.room.roomId) && display;
            })
            .map((result) => {
                let completion = result.getCommand() + " ";
                const usedAlias = result.aliases.find((alias) => `/${alias}` === command[1]);
                // If the command (or an alias) is the same as the one they entered, we don't want to discard their arguments
                if (usedAlias || result.getCommand() === command[1]) {
                    completion = command[0];
                }

                return {
                    completion,
                    type: "command",
                    component: (
                        <TextualCompletion
                            title={`/${usedAlias || result.command}`}
                            subtitle={result.args}
                            description={_t(result.description)}
                        />
                    ),
                    range: range!,
                };
            });

        return builtInCompletions.concat(
            botMatches.map((result) => {
                const insertedCommand = `/${result.command}${result.requiresQualifier ? `@${result.qualifier}` : ""}`;
                return {
                    completion: insertedCommand === command[1] ? command[0] : insertedCommand + " ",
                    type: "command",
                    component: (
                        <TextualCompletion
                            title={insertedCommand}
                            subtitle={formatBotCommandUsage(result.parameters)}
                            description={
                                result.description
                                    ? _t("composer|autocomplete|bot_command_description", {
                                          description: result.description,
                                          botName: result.botName,
                                      })
                                    : _t("composer|autocomplete|bot_command_no_description", {
                                          botName: result.botName,
                                      })
                            }
                        />
                    ),
                    range: range!,
                };
            }),
        );
    }

    public getName(): string {
        return "*️⃣ " + _t("composer|autocomplete|command_description");
    }

    public renderCompletions(completions: React.ReactNode[]): React.ReactNode {
        return (
            <div
                className="mx_Autocomplete_Completion_container_pill"
                aria-label={_t("composer|autocomplete|command_a11y")}
            >
                {completions}
            </div>
        );
    }
}

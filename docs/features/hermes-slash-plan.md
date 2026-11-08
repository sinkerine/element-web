# Hermes slash commands (MSC4391 bot commands): plan

Status: **APPROVED by the user (2026-11-08).** Branch `add-hermes-matrix-bridge-slash-completion`, base
`origin/develop` @ `2558049a68`.

Pipeline: Hermes agent (Matrix gateway, `~/dev/hermes-agent`) publishes its commands as room state → Element Web
suggests them after `/` and sends them as normal messages addressed to the bot → Hermes runs them.

## Decisions

| #   | Question                                             | Decision                                                                                                                                                                                                                                     |
| --- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | How does Element learn a bot's commands?             | **MSC4391** state events, type `org.matrix.msc4391.command_description` (unstable prefix), one per command, with the bot as sender. The client is generic: it works for any MSC4391 bot, and Hermes is the main producer (user choice).      |
| D2  | Hermes side                                          | Specify the **publisher contract** here (§2.7) and build it in a follow-up Hermes workspace **H2**. Element is verified with a Playwright stand-in bot. A real-Hermes check is follow-up work and does not block this feature (user choice). |
| D3  | Clash with a built-in (`/help`, `/status`, `/topic`) | **Built-ins win** for bare `/name`. `/name@bot` (Telegram-style) reaches the bot. Autocomplete offers the qualified form for clashes and for commands that two bots share (user choice).                                                     |
| D4  | What "recognise" covers                              | **Composer only.** A recognised bot command is sent directly with no "Unknown command" dialog. The `/help` dialog and timeline rendering do not change (user choice).                                                                        |
| D5  | Skills                                               | Hermes **skill commands** (and plugin commands) are published and handled exactly like built-in gateway commands. They are refreshed when the skill set changes (user request).                                                              |
| D6  | Wire body                                            | `body` is `/<command> <args>` as plain text with no `formatted_body`, so Hermes runs it today with **no inbound change**. `m.mentions.user_ids` is `[bot]`. An `org.matrix.msc4391.command` block is added when the arguments map cleanly.   |
| D7  | Feature flag                                         | **None.** The feature is always on, with no Labs flag or setting (user choice).                                                                                                                                                              |
| D8  | Edit composer                                        | Unchanged. Editing a message into `/cmd` still shows the unknown-command dialog, because bots do not run commands from edits.                                                                                                                |

## 1. Goal and acceptance criteria

### Goal

In a room where Hermes (or any MSC4391 bot) has published command descriptions:

- typing `/` in the message composer suggests the bot's commands, including skills, next to Element's built-ins;
- sending a recognised bot command posts it to the bot without the "Unknown command" dialog.

### What exists today (evidence)

- `apps/web/src/autocomplete/CommandProvider.tsx` suggests only the static `Commands` list from
  `slash-commands/SlashCommands.tsx`. Its `COMMAND_RE` (`/(^\/\w*)(?: .*)?/g`) does not match `-`, so a command like
  `/reload-mcp` cannot be completed.
- Three send paths reach `shouldSendAnyway()` (`editor/commands.tsx`) for any `/word` that `getCommand()` doesn't know:
  `SendMessageComposer.sendMessage` (CIDER), `wysiwyg_composer/utils/message.ts sendMessage` (rich text) and
  `EditMessageComposer`.
- `attachMentions()` (`utils/messages.ts`) **overwrites** `m.mentions`, so a bot command cannot reuse the built-in
  "messages" command branch.
- Hermes Matrix adapter (`plugins/platforms/matrix/adapter.py`):
    - a body starting with `/` gets past the group `require_mention` gate;
    - `m.mentions` is authoritative;
    - `!cmd` is a documented alias, because "clients reserve `/`".
- Hermes `hermes_cli/commands.py` `COMMAND_REGISTRY` covers 72 gateway commands, each with `name`, `description`, `aliases`
  and `args_hint`. Skills come from `agent/skill_commands.get_skill_commands()`, plugins from `get_plugin_commands()`.
  The same data already feeds the Telegram, Discord and Slack menus. **Nothing is published to Matrix.**

### Acceptance criteria

Criteria marked **[web]** are proven in this worktree. **[hermes]** criteria need follow-up workspace H2.

1. **[web] Discovery.** Every valid `org.matrix.msc4391.command_description` state
   event in the room is a candidate command, under these conditions:
    - the sender is currently joined and is not the current user;
    - empty or invalid content means "no command";
    - candidates are deduplicated by (sender, lower-cased command), and the newest `origin_server_ts` wins;
    - at most 500 commands per bot and 1000 per room are used, sorted by bot then command.
2. **[web] Autocomplete.** Typing `/` lists built-ins first, then bot commands. Each bot row shows:
    - title `/name`, or `/name@qualifier` when qualification is required;
    - a subtitle with the parameter usage, `<key>` for required and `[key]` for optional;
    - the description `"<description> (from <bot display name>)"`.

    `/mod` fuzzy-matches `/model`. Names containing `-` (`/reload-mcp`) and the qualified form (`/help@hermes`) can be
    completed. Selecting a row inserts `"/name "` or `"/name@qualifier "`.

3. **[web] Built-in precedence.** Bare `/help` still runs Element's help. The Hermes help row is offered as
   `/help@hermes`, and sending it posts body `/help` to the bot. The same applies to `/status` and `/topic`.
4. **[web] Recognition.** In the CIDER and rich-text composers, sending `/model gpt-5.5 --provider openrouter` in a
   room where Hermes publishes `model` shows **no dialog** and sends exactly one `m.room.message` containing:
    - `msgtype: "m.text"`, `body: "/model gpt-5.5 --provider openrouter"`, and no `format` or `formatted_body`;
    - `m.mentions: { user_ids: ["@hermes:…"] }` and nothing else;
    - `org.matrix.msc4391.command: { command: "model", arguments: { name: "gpt-5.5 --provider openrouter" } }`;
    - the thread relation and reply relation, when the composer is in a thread or replying.
5. **[web] Skills.** A published skill command (for example `arxiv`) is suggested and sent in the same way.
6. **[web] Ambiguity and unknowns.** A command offered by two bots, typed bare, is not auto-routed. The
   unknown-command dialog appears as it does today, and autocomplete lists both qualified forms. A name that nobody
   publishes still shows the dialog.
7. **[web] Freshness.** Suggestions follow the room state at the moment the user types:
    - a republished description shows up;
    - a description blanked to `{}` disappears;
    - a bot that leaves the room takes its commands with it.
8. **[web] No bot commands.** In a room with no valid descriptions, behaviour is exactly as it was on `develop`.
9. **[web] Quality.** The change meets these checks:
    - unit tests cover every module, with diff coverage of at least 80%;
    - `pnpm lint`, typecheck and `pnpm test:unit` pass;
    - the Playwright journey in §5 passes on Chrome.
10. **[hermes] Publisher.** Hermes publishes gateway, plugin and skill commands to each allowed room where it may send
    state. It reconciles on start, on join and on skill or plugin changes, and blanks stale descriptions (§2.7).

## 2. Design

### 2.1 Module boundaries and data flow

```
Hermes (H2) ──m.room.state org.matrix.msc4391.command_description (one per command)──▶ room state
                                                                                       │
Element Web                                                                            ▼
  slash-commands/bot-commands/BotCommandProtocol.ts   parse + validate one state event (pure)
  slash-commands/bot-commands/RoomBotCommands.ts       room → RoomBotCommand[]; text → ResolvedBotCommand
  slash-commands/bot-commands/BotCommandContent.ts     ResolvedBotCommand → m.room.message content
        │                                   │
        ▼                                   ▼
  autocomplete/CommandProvider.tsx   SendMessageComposer.tsx / wysiwyg_composer/utils/message.ts
  (suggest after built-ins)          (built-in? → existing path; else bot? → send; else unknown dialog)
        │
        ▼
  m.room.message { body "/cmd args", m.mentions [bot], org.matrix.msc4391.command } ──▶ Hermes runs body
```

There is no store, listener or cache keyed by room. Each call reads the room's current state, so freshness (AC7)
comes for free. Parsing is memoised per `MatrixEvent` with a `WeakMap`, which makes repeated keystrokes cheap.

There is no feature flag (D7). When a room has no valid descriptions, `getRoomBotCommands` returns `[]` and every
consumer falls back to today's behaviour.

### 2.2 `apps/web/src/slash-commands/bot-commands/BotCommandProtocol.ts`

```ts
/** Unstable MSC4391 state event type advertising one bot command. */
export const BOT_COMMAND_DESCRIPTION_EVENT_TYPE = "org.matrix.msc4391.command_description";
/** Unstable MSC4391 content block carrying a structured invocation. */
export const BOT_COMMAND_CONTENT_KEY = "org.matrix.msc4391.command";

export type BotCommandPrimitiveType =
    | "string"
    | "integer"
    | "boolean"
    | "user_id"
    | "server_name"
    | "room_alias"
    | "room_id"
    | "event_id";
export type BotCommandLiteralValue = string | number | boolean;
export type BotCommandSchema =
    | { schema_type: "primitive"; type: BotCommandPrimitiveType }
    | { schema_type: "literal"; literal_type: "string" | "integer" | "boolean"; value: BotCommandLiteralValue }
    | { schema_type: "union"; variants: BotCommandSchema[] } // variants: primitive | literal only
    | { schema_type: "array"; items: BotCommandSchema }; // top level only; items: primitive | literal | union

export interface BotCommandParameter {
    key: string;
    schema: BotCommandSchema;
    /** Plain text from `description["m.text"][0].body`, "" when absent. */
    description: string;
    optional: boolean;
}

/** One validated command description. */
export interface BotCommandDescription {
    botUserId: string; // event sender
    command: string; // canonical case as published, single-space separated tokens
    aliases: string[]; // optional gomuks-style extension; [] when absent
    description: string;
    parameters: BotCommandParameter[];
    ts: number; // origin_server_ts, for dedupe
}

export type BotCommandArgumentValue = BotCommandLiteralValue | BotCommandLiteralValue[];

/** The `org.matrix.msc4391.command` block. */
export interface BotCommandInvocation {
    command: string;
    arguments: Record<string, BotCommandArgumentValue>;
}

/** Validates a state event; returns null for anything not a usable description (never throws). */
export function parseBotCommandDescription(event: MatrixEvent): BotCommandDescription | null;
```

Validation (any failure returns `null`, logged once per event with `logger.debug` and no content):

- the event type matches, the sender is present, and `content` is an object;
- `command` is 1–3 tokens, each matching `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`;
- `aliases`, when present, is an array of at most 10 strings, each a valid single token;
- `parameters` is an array of at most 32 entries;
- each parameter `key` matches `^[A-Za-z_][A-Za-z0-9_]{0,63}$`, and keys are unique (a duplicate key hides the
  whole command, per the MSC);
- each `schema` follows the MSC nesting rules above;
- descriptions are cut to 200 characters for display.

The `state_key` is **not** checked against `sha256(command + mxid)`: deduplication by (sender, command) gives the same
protection without async hashing. Unknown keys are ignored.

### 2.3 `apps/web/src/slash-commands/bot-commands/RoomBotCommands.ts`

```ts
/** A command available in a room, with what the composer needs to show and address it. */
export interface RoomBotCommand extends BotCommandDescription {
    /** Room display name of the bot, falling back to its user ID. */
    botName: string;
    /** Text after "@" that addresses this bot: its localpart, or its full user ID without the leading "@"
     *  when another bot in the room has the same localpart. */
    qualifier: string;
    /** True when the bare name is taken by an enabled built-in, or by another bot in this room. */
    requiresQualifier: boolean;
}

/** A composer text resolved to one bot command. */
export interface ResolvedBotCommand {
    command: RoomBotCommand;
    /** Text after the command tokens, with leading whitespace trimmed and the rest kept as typed. */
    argsText: string;
}

/** All usable bot commands in the room; [] when the feature is off or there are none. */
export function getRoomBotCommands(room: Room, client: MatrixClient): RoomBotCommand[];

/**
 * Resolves composer text ("/name args", "/name@qualifier args", multi-token names longest-first) to one bot command.
 * Returns null for: no leading "/", "//", an enabled built-in with that bare name, an ambiguous bare name,
 * an unknown qualifier, or no match.
 */
export function resolveBotCommand(room: Room, client: MatrixClient, text: string): ResolvedBotCommand | null;

/** Formats parameter usage for display, e.g. "<prompt> [name]". */
export function formatBotCommandUsage(parameters: BotCommandParameter[]): string;
```

Rules:

- **State source:** `room.getLiveTimeline().getState(EventTimeline.FORWARDS)?.getStateEvents(TYPE)`.
- **Joined bots only:** keep a command only if `room.getMember(sender)?.membership === KnownMembership.Join` and
  `sender !== client.getUserId()`.
- **Matching:** names and aliases match case-insensitively. For a bare name, an alias of a bot command counts. The
  built-in check uses `CommandMap.get(name)?.isEnabled(client, room.roomId)` and ignores `renderingTypes`, the same
  way `getCommand()` does.
- **Qualifier:** `@hermes` matches the localpart case-insensitively. `@hermes:example.org` matches the full user ID.

### 2.4 `apps/web/src/slash-commands/bot-commands/BotCommandContent.ts`

```ts
/**
 * Maps free text to MSC4391 arguments. Returns null when the text cannot be mapped cleanly.
 *
 * - Parameters are filled in published order from whitespace-separated tokens. Required parameters come first,
 *   then optional ones in published order.
 * - The last parameter receives the rest of the text verbatim when its schema is a string primitive.
 * - integer: /^-?\d+$/. boolean: true/false/yes/no/on/off. user_id, room_alias, server_name: checked for shape only.
 * - literal and union of literals/primitives: the first variant that matches.
 * - array, room_id and event_id schemas are not supported in v1, so the result is null.
 * - A missing required parameter, or text left over when there is no parameter to take it, gives null.
 */
export function mapBotCommandArguments(
    parameters: BotCommandParameter[],
    argsText: string,
): Record<string, BotCommandArgumentValue> | null;

/**
 * Builds the message for a resolved bot command. The body uses the published canonical name without the
 * qualifier: "/<command>" or "/<command> <argsText>". m.mentions holds only the bot. The
 * org.matrix.msc4391.command block is added only when mapBotCommandArguments succeeds; otherwise the bot
 * parses the body. Callers add thread and reply relations.
 */
export function createBotCommandContent(resolved: ResolvedBotCommand): RoomMessageEventContent;
```

Arguments are sent as plain text, never Markdown. In the CIDER composer, `argsText` comes from `getSlashCommand()`'s
`commandText`, which already turns user pills into MXIDs and room pills into IDs. In the rich-text composer it comes
from `isHTML ? await richToPlain(message, false) : message`.

### 2.5 Composer wiring

`SendMessageComposer.sendMessage`: in the existing `else` branch, where `getSlashCommand` found no built-in, resolve a
bot command before falling back to the dialog:

```ts
const botCommand = resolveBotCommand(this.props.room, this.props.mxClient, commandText);
if (botCommand) {
    content = createBotCommandContent(botCommand);
    attachRelation(content, this.props.relation);
    if (replyToEvent) addReplyToMessageContent(content, replyToEvent);
    // no attachMentions(): it would overwrite the bot-only m.mentions
} else {
    /* existing shouldSendAnyway flow, unchanged */
}
```

`wysiwyg_composer/utils/message.ts sendMessage` gets the same branch in its `else`, using the plain text described
in §2.4.

The rest of the send path stays as it is: local-room handling, history, the `scrollToBottomOnMessageSent` dispatch
and the effects check.

`CommandProvider.getCompletions`:

- **Regex:** `COMMAND_RE` becomes `/(^\/[\w-]*(?:@\S*)?)(?: .*)?/g`.
- **Bot rows:** built-in matches stay first and unchanged. Bot rows come from a second
  `QueryMatcher<RoomBotCommand>`, built for each call from `getRoomBotCommands`. It matches on the keys
  `command`, `description` and `botName`, plus a function for aliases.
- **Rows for a bare `/`:** every built-in row, then every bot row.
- **Rows when the text has arguments:** the exact `resolveBotCommand` match only. A bot command with no parameters
  shows no rows after a space.
- **Inserted text:** `"/" + command + (requiresQualifier ? "@" + qualifier : "") + " "`.
- **Typed text kept:** when the typed command already equals that inserted command, the completion is `command[0]`,
  so the arguments survive, as with built-ins.
- **Row rendering:** `TextualCompletion`, with `title` set to the inserted command without its trailing space,
  `subtitle` set to `formatBotCommandUsage(...)`, and `description` built from the strings below.

New i18n strings (owned by the tasks noted):

- **T2:** `composer|autocomplete|bot_command_description` = `"%(description)s (from %(botName)s)"`.
- **T2:** `composer|autocomplete|bot_command_no_description` = `"Command from %(botName)s"`.

`docs/features/composer.md` gets a short "Bot commands" section. It explains that the feature uses MSC4391 unstable
identifiers, that built-ins win over bot commands while `/name@bot` reaches the bot, and that bots need permission to
send state events to advertise commands.

### 2.6 Error handling and security

- **Malformed descriptions** are ignored one by one and never break autocomplete. Logs contain no content.
- **Nothing runs on the client.** A bot command only sends a visible message the user typed. Built-ins always win,
  so a bot cannot take over `/myroomnick` and the like.
- **Sender shown.** Bot rows always show the bot's name, as the MSC requires.
- **Unknown or ambiguous text** keeps today's confirmation dialog.
- **Send failures** follow the normal message path: a pending event with retry.
- **Edits** never become structured commands (D8).
- **Typing notifications:** `BasicMessageComposer` already treats command parts that aren't built-in "messages"
  commands as not typing. That stays as it is.

### 2.7 Hermes publisher contract (follow-up workspace H2, not implemented here)

The repository is `~/dev/hermes-agent`, adapter `plugins/platforms/matrix/`. The contract below was proposed from the
current code and should be checked against Hermes conventions in that workspace.

- **What:**
    - gateway-available `COMMAND_REGISTRY` entries (`_gateway_available_commands()`);
    - plugin commands (`get_plugin_commands()`);
    - **skill commands** (`_iter_gateway_skills("matrix")`, which already excludes `.hub` and skills disabled for
      `platform=matrix`).

    The registry has no first-class aliases, so aliases go into each description's `aliases` field. They are not
    published as separate descriptions.

- **Names:** sanitised to `[a-z0-9_-]{1,32}`. Collisions are clamped with `_clamp_command_names`, and core commands
  take precedence over plugins and plugins over skills, as in the Telegram menu. There is no count cap below
  Element's 500.
- **Parameters:**
    - empty `args_hint` → `[]`;
    - a single placeholder `<x>` or `[x]` → one string parameter with key `x`, required for `<x>`;
    - any other hint → one optional string parameter `args` whose description is the `args_hint`;
    - skills and plugins without a hint → one optional string parameter `args`, described as "Instructions for the
      skill".
- **Description:** `CommandDef.describe()` or the skill description, cut to 200 characters, as
  `{"m.text":[{"body": …}]}`.
- **Event:** type `org.matrix.msc4391.command_description`. The `state_key` is the padded standard base64 of
  `sha256(utf8(command + bot_mxid))`.
- **Where:** DMs, plus group rooms allowed by `MATRIX_ALLOWED_ROOMS`, but only where `m.room.power_levels` lets the
  bot send this state type. Elsewhere Hermes logs once per room at info level and does nothing else.
- **When:**
    - connect (after initial sync);
    - joining a room;
    - `/reload-skills`, `/reload-mcp`, and the skill-directory signature changing (the `get_skill_commands` rescan).

    Each time, Hermes diffs its own published descriptions in the room, puts changed ones, and blanks stale ones with
    `{}`. Sends are paced at 5 events/s or less per room, retry `M_LIMIT_EXCEEDED`, and never block message handling.

- **Config:** `platforms.matrix.extra.command_descriptions` (env `MATRIX_COMMAND_DESCRIPTIONS`), **default true**.
  Setting it false blanks Hermes's own descriptions on the next reconcile.
- **Inbound:** no change is needed, because the body is `/cmd args` (D6). An optional hardening step is to prefer
  `org.matrix.msc4391.command.command` over the body's first token when both are present and the block names a known
  command.
- **Access:** descriptions are room-wide. Per-user `allowed_commands` and admin checks are still enforced when the
  command runs.
- **Tests:** pytest under `tests/gateway/` covering:
    - building the manifest (core, plugin and skill, sanitising, parameters);
    - the state-key digest;
    - diff and blanking;
    - skipping rooms without permission;
    - the config toggle.

### 2.8 Conventions

- New files carry the header `Copyright 2026 sinkerine` with `SPDX-License-Identifier: AGPL-3.0-only OR
  LicenseRef-Element-Commercial`.
- Use named exports only. Add TSDoc on exported items. Use 4-space indentation, `oxfmt` and `oxlint`.
- Tests are co-located vitest `*.test.ts(x)` files with explicit `vitest` imports.
- Run `pnpm i18n` after string changes.
- Use `logger` from `matrix-js-sdk/src/logger`, and never log message content.

## 3. Tasks

### Wave 1

**T1 — Protocol, room command resolution and content**

- **Goal:** everything in §2.2–2.4, plus the composer docs section (§2.5).
- **Owned files:**
    - `apps/web/src/slash-commands/bot-commands/BotCommandProtocol.ts`, `BotCommandProtocol.test.ts`;
    - `RoomBotCommands.ts`, `RoomBotCommands.test.ts`;
    - `BotCommandContent.ts`, `BotCommandContent.test.ts`;
    - `docs/features/composer.md`.
- **Consumes:** the `SlashCommands` `CommandMap` and matrix-js-sdk `Room`/`MatrixEvent`.
- **Produces:** the §2.2–2.4 interfaces.
- **Tests:**
    - validation accepts and rejects each rule;
    - the MSC example parses;
    - dedupe and newest wins;
    - joined-only and self excluded;
    - per-bot and per-room caps;
    - built-in precedence, qualifier forms, localpart collision giving the full-ID qualifier, ambiguity, multi-token
      longest match, aliases;
    - a room with no descriptions returns `[]`;
    - argument mapping for each schema kind, including the null cases;
    - content shape with and without the structured block.
- **Depends on:** nothing.
- **Unit test command:** `pnpm vitest run apps/web/src/slash-commands/bot-commands`

### Wave 2 (T2 and T3 own disjoint files; each builds and tests against T1 alone)

**T2 — Autocomplete**

- **Goal:** the §2.5 `CommandProvider` changes and the regex.
- **Owned files:** `apps/web/src/autocomplete/CommandProvider.tsx`, `CommandProvider.test.ts` and
  `apps/web/src/i18n/strings/en_EN.json` (the `composer|autocomplete|bot_command_*` strings).
- **Consumes:** `getRoomBotCommands`, `resolveBotCommand`, `formatBotCommandUsage`.
- **Produces:** bot completion rows.
- **Tests:**
    - `/` lists built-ins then bot rows;
    - fuzzy `/mod`;
    - hyphenated names;
    - `/help` shows the built-in plus `/help@hermes`;
    - a two-bot clash gives qualified rows;
    - text with arguments keeps them, and no-parameter commands hide after a space;
    - a room without bot descriptions shows only built-ins;
    - existing built-in tests still pass.
- **Depends on:** T1.
- **Unit test command:** `pnpm vitest run apps/web/src/autocomplete/CommandProvider.test.ts`

**T3 — Send-path recognition**

- **Goal:** the §2.5 branches in the CIDER and rich-text composers.
- **Owned files:**
    - `apps/web/src/components/views/rooms/SendMessageComposer.tsx`, `SendMessageComposer.test.tsx`;
    - `apps/web/src/components/views/rooms/wysiwyg_composer/utils/message.ts`, `message.test.ts`.
- **Consumes:** `resolveBotCommand`, `createBotCommandContent`.
- **Produces:** dialog-free bot command sends.
- **Tests, for each composer:**
    - no `QuestionDialog`, and one `sendMessage` call with the exact content from AC4;
    - the thread relation and reply are attached, and `m.mentions` holds only the bot;
    - a qualified built-in clash sends body `/help`;
    - bare `/help` still runs the built-in;
    - ambiguous or unknown text still opens the dialog;
    - rich-text HTML input is turned into a plain body.
- **Depends on:** T1.
- **Unit test command:** `pnpm vitest run apps/web/src/components/views/rooms/SendMessageComposer.test.tsx apps/web/src/components/views/rooms/wysiwyg_composer/utils/message.test.ts`

### Wave 3

**T4 — End-to-end journey**

- **Goal:** the §5 Playwright spec.
- **Owned files:** `apps/web/playwright/e2e/composer/bot-commands.spec.ts`.
- **Consumes:** the T2 and T3 behaviour, plus the `Bot` page object, `app.client` and `bot.evaluate`.
- **Produces:** E2E coverage.
- **Depends on:** T2 and T3.
- **Unit test command (host gate):** `pnpm vitest run apps/web/src/slash-commands/bot-commands apps/web/src/autocomplete/CommandProvider.test.ts apps/web/src/components/views/rooms/SendMessageComposer.test.tsx apps/web/src/components/views/rooms/wysiwyg_composer/utils/message.test.ts`.
  T4 adds only E2E coverage and no unit tests, so this focused whole-feature regression command (§4 step 1) is its
  gate.
- **E2E command:** `cd apps/web && pnpm test:playwright -- playwright/e2e/composer/bot-commands.spec.ts --project=Chrome`.
  The journey itself is still run in the E2E phase.
- **Screenshots:** none, so no baselines change.

## 4. Test and verification (whole feature)

Run from the repo root:

1. `pnpm vitest run apps/web/src/slash-commands/bot-commands apps/web/src/autocomplete/CommandProvider.test.ts apps/web/src/components/views/rooms/SendMessageComposer.test.tsx apps/web/src/components/views/rooms/wysiwyg_composer/utils/message.test.ts`
2. `pnpm test:unit` (the full vitest suite) and `cd apps/web && pnpm jest` (the legacy jest tree, which must stay
   green).
3. `pnpm -r --workspace-concurrency=1 lint:types`
4. `pnpm lint`, which includes format, oxlint, knip and unused settings.
5. `pnpm i18n`, then `git diff --exit-code apps/web/src/i18n/strings/en_EN.json`.
6. `cd apps/web && pnpm build`
7. Coverage: `pnpm test:unit --coverage`, then `pnpm coverage:diff`, which must report at least 80% on changed lines.
8. E2E: §5. It runs when the feature is first added and is **not** a push or deploy requirement. Existing unit tests
   keep running on every push.

## 5. E2E journey (Playwright, container-isolated homeserver)

Setup:

- The spec is `apps/web/playwright/e2e/composer/bot-commands.spec.ts`. It uses the repository fixtures and runs
  against a fresh Synapse testcontainer for each worker.
- The user is `Janet`. The stand-in bot is the `bot` fixture with `displayName: "Hermes"`, whose MXID localpart is
  set by the fixture. The spec reads the localpart and uses it as `<q>` below.
- Before running, check `lsof -ti:8080` so that no stale dev server is answering.

Steps:

1. **Room setup.** Janet creates the room "Hermes Room", inviting the bot with
   `power_level_content_override.users = { Janet: 100, bot: 50 }`. The bot joins.
   **Expect:** the room opens and the bot is a member.
2. **Bot publishes** with `bot.evaluate(cli => cli.sendStateEvent(...))`. Each event has type
   `org.matrix.msc4391.command_description` and its digest state key:
    - `model`: optional string `name`, "Show or change the model";
    - `help`: no parameters, "Show available commands";
    - `arxiv`: optional string `args`, a skill described as "Search arXiv papers";
    - `reload-mcp`: no parameters;
    - `oldcmd`: blanked to `{}`.

    **Expect:** the state events are sent successfully.

3. **Full list.** Janet types `/` in the CIDER composer.
   **Expect:** the autocomplete shows built-ins such as `/me`, then:
    - `/model` with subtitle `[name]` and description "Show or change the model (from Hermes)";
    - `/arxiv`;
    - `/reload-mcp`;
    - `/help@<q>`.

    No `/oldcmd` row appears.

4. **Complete and send.** Janet types `mod`, so the composer reads `/mod`, and selects `/model`.
   **Expect:** the composer reads `/model `. She types `gpt-5.5 --provider openrouter` and presses Enter.
   **Expect:**
    - no "Unknown command" dialog;
    - the message appears in the timeline;
    - `bot.evaluate` reads the latest event, which matches AC4 exactly: the body, `m.mentions` holding only the bot,
      and `org.matrix.msc4391.command.arguments.name`.
5. **Skill.** Janet sends `/arxiv transformers attention`.
   **Expect:** no dialog, body `/arxiv transformers attention` and `arguments.args = "transformers attention"`.
6. **Built-in wins.** Janet sends `/help`.
   **Expect:** Element's "Command Help" dialog opens and no event is sent. She closes it, then sends `/help@<q>`.
   **Expect:** an event with body `/help`, `m.mentions` holding only the bot, and `command: "help"`.
7. **Unknown command.** Janet sends `/notacommand`.
   **Expect:** the "Unknown command" dialog appears. She cancels, and the composer keeps her text.
8. **Thread.** Janet opens a thread on the step 4 message and sends `/model` there.
   **Expect:** no dialog, and an event with `m.relates_to.rel_type = "m.thread"` and `m.mentions` holding only the
   bot.
9. **Rich-text composer.** Janet turns on `MessageComposerInput.useWysiwyg` with `app.settings.setValue`, types
   `/arx`, selects the completion and types `vision`, then presses Enter.
   **Expect:** no dialog, and an event with body `/arxiv vision` and no `formatted_body`.
10. **Freshness.** The bot blanks `model` to `{}`.
    **Expect:** typing `/mod` shows no Hermes row. The bot then leaves the room.
    **Expect:** typing `/` shows no bot rows, and sending `/arxiv x` opens the unknown dialog.

Isolation: every test uses its own homeserver container and fresh accounts. The bot runs in a separate page context, as
in `interactive-ui.spec.ts`. Nothing persists between runs.

Follow-up (H2, not blocking): run the same journey against a real Hermes gateway on a test homeserver, with skills
installed. Check that `/model`, a skill command and `/help@hermes` run in Hermes and that it replies.

## 6. Open notes

- MSC4391 is unstable and could change. Only the `org.matrix.msc4391.*` identifiers are used, and the parser
  tolerates unknown fields.
- In group rooms, Hermes needs power to send state before it can advertise. Element's DMs (`trusted_private_chat`)
  already give the invitee power level 100.
- The `/help` dialog does not list bot commands (D4).

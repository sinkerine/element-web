# LaTeX maths in messages: enable by default and harden (`feature_latex_maths`)

Status: **APPROVED by the user on 2026-11-04.**

Mocks: [`latex-mocks.html`](./latex-mocks.html) is a self-contained interactive page. It loads KaTeX from cdnjs, so
open it in a browser with network access. It has a composer playground where you can switch between the current and
proposed rules, a live edge-case table, error handling and limits, editing a sent message, the on/off switch, and room
topics.

Decisions made with the user (2026-11-04):

- **Scope: turn on and fix.** LaTeX maths already exists as a labs feature that is off by default. This work turns
  it on by default and fixes the gaps that matter once everyone has it. The rich text (WYSIWYG) composer is **out of
  scope**: it is a separate lab that is off by default and has its own Markdown pipeline.
- **The switch stays in Labs** (`feature_latex_maths`, Labs → Messaging) with `default: true`. This follows the
  precedent of `feature_interactive_ui` (commit `be8dd11b98`). Deployments can still turn it off with
  `features.feature_latex_maths: false` in `config.json`.
- **Inline `$…$` rule:** a closing `$` followed by a digit doesn't count, and `( [ { " '` are allowed before the opening
  `$`. Everything else stays as it is.
- **Editing:** inline maths comes back as `$…$` when that would be detected again, otherwise as `\(…\)`. Display maths
  comes back as `$$…$$` on its own line, otherwise as `\[…\]` on its own line.

## Background: what exists today

| Concern                      | Where                                                                               | Behaviour today                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Flag                         | `apps/web/src/settings/Settings.tsx` `feature_latex_maths`                          | Lab, `default: false`, display name `labs\|latex_maths`, no description.                                                                                                                                                                                                                                                                                 |
| Send (legacy CIDER composer) | `apps/web/src/editor/serialize.ts` `htmlSerializeFromMdIfNeeded`                    | Before Markdown runs, regexes turn `$$…$$` / `\[…\]` (own line) into `<div data-mx-maths="…">` and `$…$` / `\(…\)` into `<span data-mx-maths="…">`. `<code>` contents are restored from a parse without maths, and each maths element gets a `<code>tex</code>` fallback. `body` keeps the raw text. Patterns can be overridden in `latex_maths_delims`. |
| Markdown passthrough         | `apps/web/src/Markdown.ts` `isAllowedHtmlTag`                                       | Lets `<div\|span data-mx-maths="…">` through.                                                                                                                                                                                                                                                                                                            |
| Sanitizer                    | `packages/shared-utils/src/html/sanitizeHtmlParams.ts`                              | Allows `data-mx-maths` on `span` and `div`.                                                                                                                                                                                                                                                                                                              |
| Render                       | `apps/web/src/HtmlUtils.tsx` `analyseEvent`                                         | After sanitizing, when the flag is on, replaces each `div\|span[data-mx-maths]` with `katex.renderToString(…, { throwOnError: false, displayMode, output: "htmlAndMathml" })`. `katex.css` is loaded globally in `vector/index.ts`.                                                                                                                      |
| Edit                         | `apps/web/src/editor/deserialize.ts` `parseNode`                                    | Maths elements become `\(tex\)` / `\[tex\]` (or the `latex_maths_delims` left/right). The maths `DIV` is **not** a block node.                                                                                                                                                                                                                           |
| Topics                       | `createRoom.ts`, `RoomProfileSettings.tsx`, `SpaceSettingsGeneralTab.tsx`, `/topic` | Run through `htmlSerializeFromMdIfNeeded`, so maths is detected, but `topicToHtml` never renders KaTeX and strips `<code>`.                                                                                                                                                                                                                              |

Gaps that matter once maths is on by default:

1. **Currency false positives.** `$5/$10`, `$5-$10` and `$3,$4` become maths (`5/`, `5-`, `3,`).
2. **`($x$)`, `"$x$"` and `[$x$]` don't render**, because the opening `$` must follow the start of a line, whitespace or
   `.,!?:;`.
3. **Topics lose dollar signs.** `/topic budget $5/$10` stores `<span data-mx-maths="5/"><code>5/</code></span>10`,
   which shows as "budget 5/10".
4. **Editing glues adjacent display blocks together.** Two `<div data-mx-maths>` in a row come back as `\[a\]\[b\]`,
   which re-sends as one broken formula. Editing always shows `\(…\)` even though the user typed `$…$`.
5. **Editing turns literal dollars into maths.** A message whose visible text is `$x$` (sent escaped as `\$x\$`)
   comes back into the composer as `$x$` and re-sends as maths.
6. **KaTeX limits are left at their defaults.** `maxSize` is unlimited, and nothing catches an exception that isn't a
   KaTeX ParseError.

## Goal and acceptance criteria

Every Element Web user can type LaTeX maths in the regular composer and see maths from anyone rendered with KaTeX,
with no setup. Ordinary text with dollar signs, room topics and message edits keep behaving as before.

1. **On by default.** With no device or config value, `SettingsStore.getValue("feature_latex_maths")` is `true`.
   Labs → Messaging shows "Render LaTeX maths in messages", switched on, with a description of the syntax.
   `features.feature_latex_maths: false` in config turns it off.
2. **Syntax** (CIDER composer, Markdown on):
    - `$…$` and `\(…\)` are inline maths. `$$…$$` and `\[…\]` on a line of their own are display maths. Display maths
      can span several lines.
    - The opening `$` must be at the start of a line or follow whitespace or one of `. , ! ? : ; ( [ { " '`, and must
      not be followed by whitespace. The closing `$` must not follow whitespace or `\`, and **must not be followed by a
      digit**.
    - `\$` is a literal dollar sign. Text inside `` `code` `` and fenced code blocks is never maths.
3. **Exact cases** (each covered by a unit test):

    | Composer input                   | `formatted_body` contains               |
    | -------------------------------- | --------------------------------------- |
    | `Euler $e^{i\pi}+1=0$`           | `<span data-mx-maths="e^{i\pi}+1=0">`   |
    | `Identity ($a+b$) holds`         | `<span data-mx-maths="a+b">`            |
    | `Tickets are $5/$10`             | no `data-mx-maths` (sent as plain text) |
    | `Range $5-$10`, `$3,$4`          | no `data-mx-maths`                      |
    | `I paid $5 and $10`              | no `data-mx-maths`                      |
    | `` Use `$x$` ``                  | `<code>$x$</code>`, no `data-mx-maths`  |
    | `\$x\$`                          | no `data-mx-maths`                      |
    | `$$\int_0^1 x\,dx$$` on own line | `<div data-mx-maths="\int_0^1 x\,dx">`  |
    | `\(\alpha\)`                     | `<span data-mx-maths="\alpha">`         |

4. **Fallback for other clients.** `body` is exactly what was typed. `formatted_body` keeps a `<code>tex</code>`
   fallback inside each maths element, as today.
5. **Rendering.** With the flag on, every `span|div[data-mx-maths]` in a sanitized HTML message is replaced by KaTeX
   output, `htmlAndMathml`, so screen readers get MathML and the result has `role="math"`. Invalid TeX shows the source
   in the error colour with the parse error as its `title`. If KaTeX throws for any other reason, that element keeps
   its sanitized `<code>` fallback, the rest of the message still renders, and a warning is logged. `\href` and
   `\url` are not trusted. Sizes over 20em are clamped. Macro expansion is capped at 1000.
6. **Flag off.** The composer sends `$…$` as text, and received maths shows the `<code>` fallback, exactly as today.
7. **Topics.** Room and space topics set from create-room, room settings, space settings or `/topic` are never parsed
   for maths. `/topic budget $5/$10` shows "budget $5/$10".
8. **Editing** (↑ or Edit on your own message):
    - Inline maths comes back as `$tex$` when `$tex$` would be detected again in that position. Otherwise it comes back
      as `\(tex\)`.
    - Display maths comes back as `$$tex$$` on a line of its own, separated from neighbours by a blank line. It falls
      back to `\[tex\]` when `$$tex$$` would not be detected again.
    - Saving the edit without changes produces the same set of `data-mx-maths` values as the original.
    - When the flag is on, literal text that would be detected as maths gets a `\$` escape, so it stays text.
    - When `latex_maths_delims.{inline,display}.{left,right}` are configured, they are used as today.
9. **No regressions.** Existing `HtmlUtils`, `serialize`, `deserialize`, `roundtrip`, `MessageDiffUtils` and composer
   tests pass. Tests that rely on maths being off set it off explicitly.

## Design

### Module boundaries and data flow

```
 send:  CIDER model ─mdSerialize─▶ md ─replaceMathsDelimiters (maths.ts)─▶ md+tags ─Markdown─▶ HTML ─restore <code>, add fallback─▶ formatted_body
                                       ▲ skipped when allowMaths === false (topics) or flag off
 show:  formatted_body ─sanitizeHtml─▶ DOM ─renderMathsElements (HtmlUtils, KATEX_OPTIONS)─▶ safeBody
 edit:  formatted_body ─DOMParser─▶ parseNode ─maths element─▶ mathsToComposerText (maths.ts) ─▶ composer parts
                                              └ text node ─escape → escapeMathsDelimiters (flag on)─▶ composer parts
```

- **`apps/web/src/editor/maths.ts` (new)** owns the maths syntax: the default patterns, config overrides, turning
  delimiters into `data-mx-maths` tags, and the reverse checks used when editing. It is pure apart from reading
  `SdkConfig`, and has no React.
- **`serialize.ts`** calls into `maths.ts` and keeps the code-restore and fallback steps. Its options gain
  `allowMaths`.
- **`deserialize.ts`** calls into `maths.ts` for maths elements and text escaping, and treats display maths as a
  block when inserting line breaks.
- **`HtmlUtils.tsx`** owns rendering. It gets a KaTeX options constant and handles errors per element.
- **`Settings.tsx`** owns the default.

### `apps/web/src/editor/maths.ts` (new)

```ts
/** Kind of maths element: `<span data-mx-maths>` (inline) or `<div data-mx-maths>` (display). */
export type MathsKind = "inline" | "display";

/** Delimiter family: `tex` is `$…$` / `$$…$$`, `latex` is `\(…\)` / `\[…\]`. */
export type MathsSyntax = "tex" | "latex";

/** Default regex sources, applied with flags "gms". Group 1 is the text kept before the maths, group 2 is the TeX. */
export const DEFAULT_MATHS_PATTERNS: Readonly<Record<MathsSyntax, Readonly<Record<MathsKind, string>>>>;

/** Returns `latex_maths_delims[kind].pattern[syntax]` from SdkConfig if set, otherwise the default. */
export function getMathsPattern(syntax: MathsSyntax, kind: MathsKind): string;

/**
 * Replaces maths delimiters in Markdown source with `<div data-mx-maths="…">\n\n</div>\n\n` (display) or
 * `<span data-mx-maths="…"></span>` (inline), with the TeX encoded via `html-entities` `encode`. Runs tex then latex,
 * display before inline (today's order), then makes sure every `<div` starts on a new line.
 */
export function replaceMathsDelimiters(md: string): string;

/**
 * Text to put in the composer for a maths element when editing.
 * @param prevChar - The character just before the element on the same line, "" at the start of a line, or null if unknown.
 * @param nextChar - The character just after the element on the same line, "" at the end of a line, or null if unknown.
 */
export function mathsToComposerText(
    tex: string,
    kind: MathsKind,
    prevChar: string | null,
    nextChar: string | null,
): string;

/** Adds a backslash before the opening `$` of every span the tex patterns would detect, so it stays literal text. */
export function escapeMathsDelimiters(text: string): string;
```

**Default patterns.** Only `tex.inline` changes. The others move unchanged from `serialize.ts`.

```ts
tex: {
    display: "(^)\\$\\$(([^$]|\\\\\\$)+?)\\$\\$$",
    // CHANGED: ( [ { " ' are allowed before the opening $, and the closing $ must not be followed by a digit.
    inline: "(^|[\\s.,!?:;(\\[{\"'])(?!\\\\)\\$(?!\\s)(([^$\\n]|\\\\\\$)*([^\\\\\\s\\$]|\\\\\\$)(?:\\\\\\$)?)\\$(?!\\d)",
},
latex: {
    display: "(^)\\\\\\[(?!\\\\\\])(.*?)\\\\\\]$",
    inline: "(^|[^\\\\])\\\\\\((?!\\\\\\))(.*?)\\\\\\)",
},
```

These are the patterns the mock page runs. The table in section 2 of the mock is generated from them.

**`mathsToComposerText` rules.**

1. If `SdkConfig.get("latex_maths_delims")?.[kind]?.left` or `.right` is set, return `left + tex + right`, using the
   default for whichever side is missing. This keeps today's config behaviour.
2. `inline`: if `prevChar` and `nextChar` are both non-null, build `probe = prevChar + "$" + tex + "$" + nextChar` and
   run `getMathsPattern("tex", "inline")` on it. If the first match starts at 0, ends at
   `prevChar.length + tex.length + 2`, and has group 2 `=== tex`, return `"$" + tex + "$"`. Otherwise return
   `"\\(" + tex + "\\)"`.
3. `display`: run `getMathsPattern("tex", "display")` on `"$$" + tex + "$$"`. If the match covers the whole string and
   group 2 `=== tex`, return it. Otherwise return `"\\[" + tex + "\\]"`. Putting it on its own line is the caller's job
   (see `deserialize.ts`).

**`escapeMathsDelimiters`.** For `tex.display` then `tex.inline` (from `getMathsPattern`), find every match in `text`
and insert `\` before the `$` that opens it (index `match.index + match[1].length`). Insert from the end so earlier
indexes stay valid. Repeat until nothing matches, because escaping one match can expose another. Cap it at a few
passes. `latex` delimiters need no handling: `escape()` already doubles backslashes, which stops them from being
detected.

### `apps/web/src/editor/serialize.ts`

```ts
export function htmlSerializeFromMdIfNeeded(
    md: string,
    { forceHTML = false, allowMaths = true }: { forceHTML?: boolean; allowMaths?: boolean } = {},
): string | undefined;
```

- `const useMaths = allowMaths && SettingsStore.getValue("feature_latex_maths");` gates both steps that exist today:
  the replacement, now `md = replaceMathsDelimiters(md)`, and the code-restore and fallback pass after parsing.
- The inline pattern table and loop move to `maths.ts`. Nothing else changes, and `htmlSerializeIfNeeded` is
  unchanged.
- **Topic callers pass `allowMaths: false`:**
    - `createRoom.ts:464`
    - `components/views/room_settings/RoomProfileSettings.tsx:161`
    - `components/views/spaces/SpaceSettingsGeneralTab.tsx:76`
    - `slash-commands/SlashCommands.tsx:260` (`/topic`)

    `/spoiler` (line 81) keeps maths.

### `apps/web/src/editor/deserialize.ts`

- **Maths element** (the existing `DIV`/`SPAN` case):
  `pc.plainWithEmoji(mathsToComposerText(tex, n.nodeName === "DIV" ? "display" : "inline", adjacentChar(n, "previous"), adjacentChar(n, "next")))`.
- **New private helper** `function adjacentChar(n: Node, side: "previous" | "next"): string | null`:
    - Sibling is a text node: return its last character (previous side) or first character (next side). A sibling
      ending or starting with `\n` returns `""`.
    - Sibling is `BR`: return `""`.
    - No sibling and the parent is a block node (`checkBlockNode(parent)` or `BODY`): return `""`.
    - Anything else (another element, or an inline parent such as `STRONG`): return `null`. This is conservative and
      makes the result `\(…\)`, because the Markdown around it, like `**`, would block a `$` from being detected.
- **New private helper** `function isDisplayMathsNode(n: Node): boolean` returns `n.nodeName === "DIV"` with
  `data-mx-maths`. `parseChildren` uses `checkBlockNode(prev) || checkBlockNode(c) || isDisplayMathsNode(prev) ||
  isDisplayMathsNode(c)` to decide when to insert `\n\n`. `checkBlockNode` in `HtmlUtils.tsx` stays as it is, because
  `MessageDiffUtils` also uses it.
- **Escaping:**
    - `escape(text)` becomes `escapeMarkup(text)` followed by `escapeMathsDelimiters(...)` when
      `SettingsStore.getValue("feature_latex_maths")`. Markup is escaped first, so the `\` added before `$` is not
      doubled.
    - `needsEscaping(body)` also returns true when the flag is on and `escapeMathsDelimiters(body) !== body`.

### `apps/web/src/HtmlUtils.tsx`

```ts
/** KaTeX options for received maths. trust:false blocks \href/\url/\includegraphics; maxSize/maxExpand bound cost. */
const KATEX_OPTIONS: KatexOptions = {
    throwOnError: false,
    output: "htmlAndMathml",
    trust: false,
    maxSize: 20,
    maxExpand: 1000,
    strict: "ignore",
};

/** Replaces each sanitized `div|span[data-mx-maths]` under `root` with KaTeX output; keeps the fallback on failure. */
function renderMathsElements(root: ParentNode): void;
```

- Type import: `import katex, { type KatexOptions } from "katex";`. If that version's typings don't export
  `KatexOptions`, use `Parameters<typeof katex.renderToString>[1]`.
- `analyseEvent` calls `renderMathsElements(phtml)` in place of the inline loop, under the same
  `isHtmlMessage && SettingsStore.getValue("feature_latex_maths")` guard.
- For each element: `try { e.outerHTML = katex.renderToString(decode(tex), { ...KATEX_OPTIONS, displayMode: e.tagName === "DIV" }); } catch (err) { logger.warn("Failed to render maths", err); }`.
  `logger` comes from `matrix-js-sdk/src/logger`. On failure the sanitized element and its `<code>` fallback stay.
- KaTeX's output is inserted after sanitizing, as it is today. This is safe because the input is plain TeX and
  `trust` is false.

### `apps/web/src/settings/Settings.tsx` and strings

- `feature_latex_maths`: `default: true`, and add `description: _td("labs|latex_maths_description")`.
- `en_EN.json` `labs.latex_maths_description`: "Type $…$ or \\(…\\) for inline maths, and $$…$$ or \\[…\\] on a line of
  their own for display maths." Generate it with `pnpm i18n`.

### Conventions

- New files get the copyright header with year **2026**. The holder follows the project's rule: `Element Creations
  Ltd.` only for Element contributions, otherwise the contributor's own name.
- Named exports only, TSDoc on the exports, 4-space indent, double quotes.
- New tests are co-located vitest files. Import `describe`/`it`/`expect`/`vi` explicitly.
- Do not touch `packages/shared-utils` sanitizer params, `Markdown.ts` or `MessageDiffUtils.tsx`. No change is needed
  there.

## Tasks

### Wave 1 (T1 and T2 in parallel; their files don't overlap)

#### T1: Maths syntax for sending and editing ⚠️ subtle

- **Goal:**
    - Move the maths syntax into `maths.ts` and apply the new inline rule.
    - Add `allowMaths` and opt topics out.
    - Fix editing: `$…$` when it would be detected again, display maths on its own line, and escaping of literal
      `$…$`.
    - Acceptance criteria 2, 3, 4, 6, 7 and 8.
- **Subtle:**
    - Regex escaping inside string literals.
    - The `adjacentChar` edge cases.
    - Running `escape` before `escapeMathsDelimiters`.
    - Restoring `<code>` by index must still work.
    - The default round trip must stay exact. Add round-trip tests for every row in the criterion-3 table and for
      `$$a$$\n$$b$$`.
- **Owned files:**
    - `apps/web/src/editor/maths.ts` (new)
    - `apps/web/src/editor/maths.test.ts` (new)
    - `apps/web/src/editor/serialize.ts`
    - `apps/web/src/editor/serialize.test.ts`
    - `apps/web/src/editor/deserialize.ts`
    - `apps/web/src/editor/deserialize.test.ts`
    - `apps/web/src/editor/roundtrip.test.ts`
    - `apps/web/src/createRoom.ts`
    - `apps/web/src/createRoom.test.ts`
    - `apps/web/src/components/views/room_settings/RoomProfileSettings.tsx`
    - `apps/web/src/components/views/room_settings/RoomProfileSettings.test.tsx`
    - `apps/web/src/components/views/spaces/SpaceSettingsGeneralTab.tsx`
    - `apps/web/src/slash-commands/SlashCommands.tsx`
    - `apps/web/src/slash-commands/topic.test.ts`
- **Produces:**
    - `MathsKind`, `MathsSyntax`, `DEFAULT_MATHS_PATTERNS`, `getMathsPattern`, `replaceMathsDelimiters`,
      `mathsToComposerText` and `escapeMathsDelimiters` from `maths.ts`.
    - `htmlSerializeFromMdIfNeeded(md, { forceHTML?, allowMaths? })`.
- **Consumes:** `SettingsStore.getValue("feature_latex_maths")`, `SdkConfig.get("latex_maths_delims")`.
- **Depends on:** none.
- **Tests** (mock `SettingsStore.getValue` so the flag is on, as `serialize.test.ts` does today):
    - `maths.test.ts`: every row of the criterion-3 table through `replaceMathsDelimiters`; config pattern override;
      each `mathsToComposerText` branch (`$` safe, unsafe `prevChar`, null neighbours, digit `nextChar`, config
      left/right, display fallback when the TeX contains `$`); `escapeMathsDelimiters` (plain, nested, already escaped,
      currency left untouched).
    - `serialize.test.ts`: `$5/$10` stays plain, `($x$)` is detected, and `allowMaths: false` skips maths with the flag
      on.
    - `deserialize.test.ts`: inline gives `$x$`, `**$x$**` gives `\(x\)`, adjacent display divs are separated by a
      blank line, literal `$x$` text is escaped with the flag on and not with it off.
    - `roundtrip.test.ts`: `md2html(html2md(html))` is stable for the maths cases.
    - `topic.test.ts`, `createRoom.test.ts` and `RoomProfileSettings.test.tsx`: a topic with `$x$` produces no
      `data-mx-maths` with the flag on.
- **Command:**
  `pnpm vitest run apps/web/src/editor apps/web/src/slash-commands/topic.test.ts apps/web/src/createRoom.test.ts apps/web/src/components/views/room_settings/RoomProfileSettings.test.tsx`

#### T2: Safer KaTeX rendering

- **Goal:** Add `KATEX_OPTIONS` and a per-element try/catch in `renderMathsElements`. Acceptance criterion 5.
- **Owned files:**
    - `apps/web/src/HtmlUtils.tsx`
    - `apps/web/src/HtmlUtils.test.tsx`
    - `apps/web/src/__snapshots__/HtmlUtils.test.tsx.snap`
- **Produces:** the same rendered output for valid maths. `renderMathsElements` is private.
- **Consumes:** `katex`, `SettingsStore.getValue("feature_latex_maths")`.
- **Depends on:** none.
- **Tests:** extend the `feature_latex_maths` describe in `HtmlUtils.test.tsx`:
    - The existing inline and block snapshots stay unchanged.
    - `\href{javascript:alert(1)}{x}` renders without an `<a href`.
    - `\rule{1000em}{1em}` renders with a width of at most 20em.
    - Invalid TeX (`\frac{1}{2`) renders an element with class `katex-error` and a `title`.
    - When `katex.renderToString` is spied to throw once, the output keeps `<code>tex</code>` for that element, renders
      the next element, and calls `logger.warn`.
    - With the flag off, the `<code>` fallback is kept.
- **Command:** `pnpm vitest run apps/web/src/HtmlUtils.test.tsx apps/web/src/utils/MessageDiffUtils.test.ts`

### Wave 2

#### T3: Turn on by default, document, and add the e2e test

- **Goal:**
    - Set `feature_latex_maths` to `default: true` and add its description string.
    - Update the docs.
    - Fix any existing test that assumed maths was off.
    - Add the Playwright journey below.
    - Acceptance criteria 1 and 9, plus the end-to-end proof of 2, 5, 7 and 8.
- **Owned files:**
    - `apps/web/src/settings/Settings.tsx`
    - `apps/web/src/settings/SettingsStore.test.ts`
    - `apps/web/src/i18n/strings/en_EN.json`
    - `docs/labs.md`: say it is on by default, describe the syntax and the `\$` and backtick escapes, and note that
      topics are excluded.
    - `docs/config.md`: note the new default inline pattern under `latex_maths_delims`.
    - `apps/web/playwright/e2e/composer/latex-maths.spec.ts` (new)
    - Any other unit test that fails only because the default changed. Fix it by setting the flag off explicitly in
      that test, and list each such file in the commit.
- **Consumes:** everything from T1 and T2.
- **Depends on:** T1, T2. The flag shouldn't go on before the fixes land.
- **Tests:**
    - `SettingsStore.test.ts`: `getDefaultValue("feature_latex_maths") === true` and `getValue(...) === true` with no
      device value.
    - The e2e spec below.
- **Commands:**
    - `pnpm vitest run apps/web/src/settings/SettingsStore.test.ts`
    - `pnpm test:unit`
    - `cd apps/web && pnpm test:playwright -- playwright/e2e/composer/latex-maths.spec.ts --project=Chrome`

## Test and verification (whole feature)

From the repo root unless stated otherwise:

1. **Unit tests for each task:** the commands above.
2. **Full unit suite:** `pnpm test:unit` (vitest). Also run the jest tree with `cd apps/web && pnpm jest`, because the
   default flip can affect legacy tests in `apps/web/test/`.
3. **Types:** `pnpm -r --workspace-concurrency=1 lint:types`.
4. **Lint and format:** `pnpm lint:js`, `pnpm lint:fmt`, then the full `pnpm lint`. This includes knip, which checks
   that every export from `maths.ts` is used.
5. **i18n:** after running `pnpm i18n`, `git diff apps/web/src/i18n/strings/en_EN.json` shows only
   `labs.latex_maths_description`.
6. **Build:** `cd apps/web && pnpm build` succeeds. The bundle size is unchanged, because KaTeX is already bundled.
7. **Coverage of the diff:**
    - `pnpm test:unit --coverage`
    - `pnpm coverage:diff` (needs `diff_cover`)
    - Target ≥ 80%.
8. **Manual check:** `cd apps/web && pnpm start`. Paste the rows of [`latex-mocks.html`](./latex-mocks.html) §2 into
   the composer and confirm the timeline matches the mock's "Proposed" column.

## E2E journey

Spec: `apps/web/playwright/e2e/composer/latex-maths.spec.ts`.

**Setup:**

- Follow [`docs/playwright.md`](../playwright.md). A container runtime is needed for the testcontainers homeserver.
  Check that `lsof -ti:8080` is free first.
- Run `cd apps/web && pnpm test:playwright -- playwright/e2e/composer/latex-maths.spec.ts --project=Chrome`.
- Fixtures follow `composer/CIDER.spec.ts`: user "Janet", room "Maths Room" created and opened, Notifications toast
  rejected.
- No labs settings are touched, so the test proves the default is on.
- Use role and label locators; KaTeX MathML exposes `role="math"`. Take no screenshots, so no `@screenshot` tag.

| #   | Step                                                                                                                             | Expected result                                                                                                                                                                                           |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | In the composer ("Send an unencrypted message…") type `Euler $e^{i\pi}+1=0$` and press Enter.                                    | The last event tile's body contains one `getByRole("math")`. The visible text no longer contains `$e^`.                                                                                                   |
| 2   | Type `$$`, then the TeX `\int_0^1 x\,dx`, then `$$`, all on one line, and press Enter.                                           | The last tile contains a `math` element with `display="block"`, inside a `.katex-display` wrapper.                                                                                                        |
| 3   | Type `Tickets are $5/$10` and press Enter.                                                                                       | The last tile shows the exact text `Tickets are $5/$10` and contains no `math` role.                                                                                                                      |
| 4   | Type ``Use `$x$` literally`` and press Enter.                                                                                    | The last tile has a `code` element with text `$x$` and no `math` role.                                                                                                                                    |
| 5   | Type `Bad $\frac{1}{2$` and press Enter.                                                                                         | The last tile shows the TeX source as a KaTeX error element with a non-empty `title`. The rest of the message, `Bad`, is visible.                                                                         |
| 6   | Send, via `app.client.sendMessage`, an `m.text` with `formatted_body` `<p>x</p><div data-mx-maths="a^2"><code>a^2</code></div>`. | The timeline renders it as display maths (`math` role). This proves receive-side rendering.                                                                                                               |
| 7   | In an empty composer, press ↑ to edit the message from step 1.                                                                   | The edit composer textbox contains `Euler $e^{i\pi}+1=0$`.                                                                                                                                                |
| 8   | Change `+1=0` to `=-1` and press Enter to save.                                                                                  | The tile shows "(edited)" and still contains one `math` element. Its MathML annotation (`annotation[encoding="application/x-tex"]`) reads `e^{i\pi}=-1`.                                                  |
| 9   | Type `/topic Budget $5/$10` and press Enter. Open Room info in the right panel.                                                  | The topic reads `Budget $5/$10`, with no `code` element and no `math` role.                                                                                                                               |
| 10  | Run `app.settings.setValue("feature_latex_maths", null, SettingLevel.DEVICE, false)`, then type `Off $y$` and press Enter.       | The last tile shows the exact text `Off $y$` and contains no `math` role. The earlier tile from step 1 now shows the `<code>` fallback `e^{i\pi}=-1`, with no `math` role, after the timeline re-renders. |

If step 10's re-render of older tiles isn't immediate, the spec only asserts on the new message, and the
fallback-when-off check stays in the T2 unit test.

## Out of scope

- Maths in the rich text (WYSIWYG) composer, which is a separate lab that is off by default.
- Rendering maths in room topics, notifications, room list previews or reply previews. These use `body` or plain text
  and keep showing the raw `$…$`.
- Loading KaTeX lazily or code-splitting it.
- A live maths preview in the composer.
- Promoting the lab to a regular Preferences setting.

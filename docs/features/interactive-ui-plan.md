# Interactive UI in Matrix messages — design plan

Status: **approved by the user** (2026-11-02). Branch `gpt-hermes-matrix-interactive-ui`, merge-base `486d68af29`.

Pipeline: GPT model → Hermes agent (Matrix gateway) → Matrix room (possibly encrypted) → Element Web and Element X
Android render a first-class, generic interactive UI with a complete text fallback.

## Decisions already taken (user, 2026-11-02)

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **v1 is a declarative component catalog** drawn with native components. No generated code (HTML/JS) runs anywhere. A sandboxed-HTML tier is a possible later phase (see "Not in v1").                                                                                                                                                                                                                                                                                                        |
| D2  | **Backend actions travel as a visible reply message** (`m.room.message` replying to the UI event, readable `body`, plus a structured key). Local-only interactions send nothing.                                                                                                                                                                                                                                                                                                             |
| D3  | **Namespace** comes from `matrix.15cm.net`. Matrix uses reverse-DNS for unstable identifiers, so the keys are `net.15cm.matrix.interactive_ui` (UI payload) and `net.15cm.matrix.interactive_ui.action` (action payload). Confirmed by the user.                                                                                                                                                                                                                                             |
| D4  | **Render for any sender, hardened**, behind a labs flag. The hardening is a bordered card, a catalog with no password inputs, `mxc://`-only images, and a confirmation before opening external links.                                                                                                                                                                                                                                                                                        |
| D5  | **Single use** is decided by what the action means. A `form` defaults to `single_use: true`, because a filled-in form is one answer. A `submit` button defaults to `single_use: false`, because buttons like "Explain this mechanism" are naturally repeated for different selections. The model sets `single_use: true` on decisive buttons such as "Confirm" or "Choose this plan".                                                                                                        |
| D6  | **No long pending timer.** The two waits are tracked separately. **Sending** lasts until the homeserver accepts the action message; it has no timer and ends in success or a send error. **Awaiting confirmation** applies only to `single_use` actions and lasts until Hermes's status edit arrives, which Hermes sends as soon as it accepts the action, before the model runs. After **8 s** without that edit, the card says "No confirmation from <sender> yet" and offers "Try again". |
| D7  | **No computed values.** Payloads have no formulas or derived state. Calculator-style answers are out of v1. The model shows worked figures as content, and a `form` submit sends changed inputs back so the model recalculates.                                                                                                                                                                                                                                                              |

---

## 1. Goal and acceptance criteria

### Goal

When a GPT model running in Hermes answers in Matrix, it can return a structured interactive answer instead of only
Markdown. Examples are the "book knowledge map" in the reference screenshot, a comparison table, a chart, a form, or a
set of choice buttons. Element Web draws it as native UI. Users can interact locally: switch branches in a dropdown,
expand a node and see its relationships, sort a table, or switch tabs. Users can also send actions back to the agent:
submit a form, press a button, or ask about a node. Every other Matrix client, and Element itself with the flag off,
shows a complete text version of the same answer. The format is generic. The graph is one component among many.

### Acceptance criteria

Criteria marked **[web]** are proven in this worktree. **[hermes]** and **[android]** need the follow-up workspaces in §3.5.

1. **[web] Rendering.** With `feature_interactive_ui` on, an `m.room.message` that carries a valid
   `net.15cm.matrix.interactive_ui` payload renders as an interactive card. Each fixture in
   `apps/web/src/interactive-ui/fixtures/valid/` covers one component family (layout, content, table, chart, graph,
   controls, form) and renders without falling back.
2. **[web] Fallback.** With the flag off, in reply previews, in exports, for `version > 1`, and for every fixture in
   `fixtures/invalid/`, the event renders exactly as today (its `body`/`formatted_body`). The invalid case adds a single
   caption saying the interactive content could not be shown. No exception escapes the tile.
3. **[web] Bounded validation.** The client parser rejects payloads over the limits in §2.4. A 60 KB payload or a
   300-node tree parses in under 20 ms in the jsdom unit test. The parser never throws, and a structural error
   anywhere rejects the whole payload.
4. **[web] Local interactions.** Changing a `select`/`tabs`/`toggle` bound value updates `visible_when`-gated nodes
   without sending any Matrix event. Selecting a graph node highlights its incident edges and shows its `detail`. The
   local state survives a page reload on the same device and survives a revision if keys and types still match.
5. **[web] Backend actions.** Pressing a `submit` button or form submit sends one `m.room.message` that replies to the
   UI event. It carries the human-readable `body`, `m.mentions` for the UI sender, and the
   `net.15cm.matrix.interactive_ui.action` object of §2.3. Only the declared `include` keys go in `values`. In a thread,
   the message stays in that thread. The pressed control shows "sending" until the homeserver accepts the message
   (D6). A repeatable action then re-enables at once. A `single_use` action keeps its controls disabled until the
   sender's status edit arrives. If 8 s pass without that edit, the card shows a hint and a "Try again" action. A send
   failure re-enables the controls with an error.
6. **[web] Revisions.** An `m.replace` edit that carries a new payload re-renders in place, keeping the scroll
   position and any still-valid local state. `status: submitted|expired|superseded` disables every control and shows
   `status_text`.
7. **[web] Security.** No payload string is ever interpreted as HTML, except `rich_text.html`, which goes through the
   same sanitiser as `formatted_body`. `image` accepts only `mxc://` or an encrypted `file`. `open_url` accepts only
   `https:` and always shows a confirmation dialog with the full URL. Generated UI never receives the Matrix client,
   access tokens, or DOM outside its card.
8. **[web] Accessibility and mobile.** Every control has an accessible name. The graph is keyboard-navigable: nodes
   are buttons in reading order, with a "relationships as list" alternative. Charts offer a data-table view. The
   accessibility e2e checks (axe) pass. At 360 px width there is no horizontal page scroll; wide graphs and tables
   scroll inside the card.
9. **[hermes] Producer.** The `present_ui` tool validates against the same schema and fixtures, and returns
   path-specific errors to the model. It sends the payload plus a generated Markdown fallback under the 45 000-byte
   event cap, and revises it with `m.replace`. Inbound action replies are authorised, validated against the latest
   bot-authored revision, deduplicated by `nonce`, and turned into one agent turn.
10. **[android] Consumer.** Element X Android renders the same valid fixtures with Compose, falls back identically, and
    sends the same action content.
11. **[all] Encrypted rooms.** The whole journey works unchanged in an E2EE room. UI and action events are encrypted
    like any message, and images use the encrypted `file` form.

---

## 2. Design

### 2.1 Research findings (sources at the end of this section)

**What ChatGPT supports today, separating model output, host rendering and backend actions**

| Surface                                              | Status (as of 2026-11-02)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Who renders                                                                                                                             | Developer/API access                                                                                                                                                                                                 |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Intelligent UI** (launched with GPT-6, 2026-10-07) | **Current.** Answers mix text, graphics, tappable buttons, forms, charts, editable graphs, interactive diagrams, side-by-side comparisons, maps, calculators, bill splitters and games [S1][S2][S3]. Available in Chat, not in the Work tab or Voice. Users can choose Personalization → Layout and Visuals → Simple to reduce it. Some component state (for example checklists) survives a thread refresh but not other threads [S1]. GPT-6 Sol (paid tiers) and Luna (Free/Go) support it [S2]. The "Pro reasoning option uses a different model" and does not support it [S1]. The model name "Astra" is unverified. | The ChatGPT client. Secondary sources describe a native streamable component library and compiler [S4]; OpenAI has not documented this. | **None found.** No public API returns Intelligent UI output. Secondary sources say it is not a standalone API/SDK [S4]. Text-completion APIs do not forward it.                                                      |
| **Apps in ChatGPT / MCP Apps**                       | **Current, open standard** (spec `2026-01-26`) [S5][S6][S7]. A tool declares `_meta.ui.resourceUri` → a `ui://` resource with MIME `text/html;profile=mcp-app`, rendered in a sandboxed iframe. Hosts include ChatGPT, Claude, VS Code Copilot, M365 Copilot and Goose [S6].                                                                                                                                                                                                                                                                                                                                            | Host, inside a sandboxed iframe on a separate origin                                                                                    | Yes, for MCP server authors. ChatGPT adds the `window.openai` extensions (`widgetState`/`setWidgetState`, `requestModal`, file and checkout helpers) and display modes: inline card, carousel, fullscreen, PiP [S5]. |
| **Canvas**                                           | **Historical.** It offered sandboxed React/HTML preview and document/code editing. It was removed from GPT-5.5 Instant/Thinking on 2026-05-28 and replaced by writing and code blocks. The last Canvas-capable legacy models were retired by 2026-08-26 [S8]. The help article is reported as 404 [S8].                                                                                                                                                                                                                                                                                                                 | —                                                                                                                                       | —                                                                                                                                                                                                                    |
| **Data analysis**                                    | **Current.** Interactive tables (pandas DataFrames) and interactive charts only for **bar, line, pie and scatter**. Other chart types fall back to static images, with a "Switch to interactive/static chart" toggle [S9].                                                                                                                                                                                                                                                                                                                                                                                              | ChatGPT client, drawing tool output                                                                                                     | Not exposed as a UI format.                                                                                                                                                                                          |
| **ChatKit widgets**                                  | **Current** OpenAI developer product. Declarative JSON widgets: `Card`, `ListView`, `Box`, `Row`, `Col`, `Text`, `Title`, `Caption`, `Markdown`, `Badge`, `Button`, `Select`, `DatePicker`, `Form`, `Image`, `Icon`, `Divider`, `Spacer`, `Transition`. **There is no chart component.** Actions go to `onAction` and a server handler. `Text`/`Markdown` have `streaming` [S10].                                                                                                                                                                                                                                       | Your ChatKit.js frontend                                                                                                                | Yes, but only for ChatKit hosts. The model fills a template your backend chose; it does not compose freely.                                                                                                          |

**Other standards compared (none adopted wholesale; the v1 catalog borrows from them)**

| Option                                                                          | Strengths                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Weaknesses for Matrix → Element                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Google A2UI** v0.9.1 (v1.0 RC) [S11][S12]                                     | It is the closest existing match to this design. The client owns a trusted catalog. Surfaces are flat component lists with JSON-Pointer data binding and incremental updates. Native renderers exist (Lit, Flutter, Compose `androidx.a2ui`). The basic catalog has `Text`, `Image`, `Icon`, `Video`, `AudioPlayer`, `Row`, `Column`, `List`, `Card`, `Tabs`, `Modal`, `Divider`, `Button`, `TextField`, `CheckBox`, `ChoicePicker`, `Slider`, `DateTimeInput`, plus validation and format functions. | It has no charts, graphs or tables. It is transport-agnostic, so lifecycle, persistence and replay over Matrix must be defined anyway. The spec is still moving (message names changed between versions).                              |
| **MCP Apps** [S6][S7]                                                           | It handles any UI, has a mature sandbox model (separate-origin proxy, declared CSP `connectDomains`/`resourceDomains`/`frameDomains`, default `connect-src 'none'`), capability negotiation in `ui/initialize` (`hostCapabilities`, `hostContext.theme/displayMode/platform/safeAreaInsets`), display modes `inline                                                                                                                                                                                   | fullscreen                                                                                                                                                                                                                             | pip`, and teardown. It **requires a meaningful text `content`**, which matches our fallback rule. | It needs an MCP server that serves resources and live `tools/call` proxying. Hermes is not an MCP host for Matrix users, and Matrix is store-and-forward. Running HTML in Element Web needs a new usercontent origin, and Android needs a WebView sandbox. This is rejected for v1 (D1). |
| **Matrix MSC4139** bot buttons [S13]                                            | Matrix-native. It defines an `m.prompts` mixin (`preset` buttons and `input` fields) and an `m.conversation.reply` with `m.used_prompt`, and degrades to plain text.                                                                                                                                                                                                                                                                                                                                  | It only covers buttons and text input, and its security section is TODO. It is not merged and needs an implementation. We stay shape-compatible in spirit (opaque `action_id`, reply relation, text fallback) but do not depend on it. |
| **Matrix MSC3006** (state-event interactions), **MSC2192** inline widgets [S14] | MSC2192 lets widgets run inline in the timeline.                                                                                                                                                                                                                                                                                                                                                                                                                                                      | MSC2192 is stalled, and its review thread names phishing and non-web client burden as blockers. Widgets also get Matrix API capabilities, which is too much power for model-generated content.                                         |
| **Matrix widgets** (MSC1236 / widget API)                                       | Element Web and the Rust SDK already implement them (`fromWidget`/`toWidget` postMessage).                                                                                                                                                                                                                                                                                                                                                                                                            | They are room-level and not per-message, and they are built for trusted integrations with Matrix capabilities. They are not suited to per-answer generated UI.                                                                         |
| **Polls (MSC3381)**                                                             | Element Web and Element X already support them, with responses as `m.reference` relations.                                                                                                                                                                                                                                                                                                                                                                                                            | They only fit single questions.                                                                                                                                                                                                        |

**Conclusions that drive the design**

- The UI must come out of a **tool call**. Hermes reaches GPT via chat-completions/Responses tool calling (seen in
  `agent/transports/chat_completions`, `agent/auxiliary_codex_response.py`), and no OpenAI API emits Intelligent UI.
  This mirrors the existing Hermes `clarify` tool (`tools/clarify_tool.py`) and the model→structured→host-renders pattern
  of ChatKit and A2UI.
- Two ideas are adopted. From A2UI and ChatKit: a **client-owned catalog**, a **flat node list with id references**
  (easy for an LLM to emit, easy to validate without recursive schemas), and **state binding**. From MCP Apps: the
  **mandatory text fallback** rule. The catalog adds `table`, `chart` (the same four interactive kinds as ChatGPT
  data analysis) and `graph`, because the generic standards lack them and the reference screenshot needs a graph.
  It also adds `carousel` and citation `link` chips, which real ChatGPT answers use (see "Real ChatGPT response
  examples" below).

**Real ChatGPT response examples → test cases**

These are the concrete examples found in launch coverage, hands-on tests and OpenAI's Apps guidelines. No official
screenshot gallery exists: TechCrunch's single image has no caption [S15]. Each "covered" row becomes a T1 fixture,
named in the last column, so the catalog is tested against what ChatGPT actually produces rather than only against
the reference screenshot.

| Example (source)                                                                                                                                                                                                  | What ChatGPT showed                                                                                                                                  | v1 coverage                                                                                                                                                                                                         | Fixture                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Book knowledge map (user's screenshot)                                                                                                                                                                            | Headings and text, a branch dropdown, ingredient → mechanism → result nodes with arrows, clickable mechanisms                                        | Covered: `select`, `graph`, `visible_when`, submit                                                                                                                                                                  | `knowledge-map.zh.json`, `.en.json` |
| Heat-pump suitability for a UK semi [S16]                                                                                                                                                                         | A credited photo, four step cards, a cost card (£8,000–£12,000+, £7,500 grant) with a source chip, a savings table, a five-question suitability form | Covered: `image`, horizontal `stack` of `card`s, `badge`, `link` (source), `table`, `form` with `choice`                                                                                                            | `heat-pump.json`                    |
| Parcel to Germany, 2 kg [S16]                                                                                                                                                                                     | A comparison table of carriers and prices, with links to carriers and a "Sources" line                                                               | Covered: `table` (sortable price), `link` chips                                                                                                                                                                     | `parcel-compare.json`               |
| Shopping results [S17]                                                                                                                                                                                            | A scrollable product carousel: photo, price, rating, short description, link out to the merchant                                                     | Covered: `carousel` with `meta`, `badge`, `open_url` per item                                                                                                                                                       | `product-carousel.json`             |
| Apps "inline carousel" pattern: restaurants, playlists, events [S18]                                                                                                                                              | 3–8 similar items, each with an image, title, ≤ 3 metadata lines, one CTA                                                                            | Covered: `carousel`; the limits match the guideline                                                                                                                                                                 | `event-carousel.json`               |
| Venue comparison, unknowns labelled [S19]                                                                                                                                                                         | Side-by-side cards                                                                                                                                   | Covered: horizontal `stack` of `card`s with `key_value` and "Unknown" `badge`s; wraps on phones                                                                                                                     | `venue-compare.json`                |
| Practice quiz, one question at a time [S19]                                                                                                                                                                       | One question per step, with the answer explained                                                                                                     | Covered: `choice` + `visible_when` (reveal and explanation per answer), `button set_state` for next. A running score is not shown (no computed values, D7)                                                          | `quiz.json`                         |
| Website explanation as a selectable six-step diagram [S19]; airplane-wing lift and bicycle-mechanics diagrams [S15][S20]                                                                                          | Diagrams the user can step through or select parts of                                                                                                | Partly covered: a `graph` with one layer per step, or `tabs`, plus Hermes-uploaded `image`s. Clickable hotspots on an image are not in v1                                                                           | `six-steps.json`                    |
| Recipe visuals [S15]                                                                                                                                                                                              | Visual recipe steps                                                                                                                                  | Covered: `carousel` of step photos, `list`, a checklist of `toggle`s (local state kept on refresh, like ChatGPT checklists [S1])                                                                                    | `recipe-checklist.json`             |
| Data analysis tables and charts [S9]                                                                                                                                                                              | A sortable table; bar, line, pie and scatter charts                                                                                                  | Covered: `table`, `chart` ×4                                                                                                                                                                                        | `chart-*.json`, `table.json`        |
| Mortgage calculator: loan box, £150k–£300k presets, rate and term sliders, capital-vs-interest bar [S16]; savings calculator [S15]; bill splitter [S21]; workshop cost calculator with validation and reset [S19] | Inputs that recompute results live, with invalid input showing "—"                                                                                   | **Not in v1, by decision (D7).** No computed values. A reply can still carry the model's own worked figures as `table` or `key_value`, and changed inputs go back through a `form` submit so the model recalculates | —                                   |
| Multi-day hiking map; coastal trip with numbered pins [S15][S21]                                                                                                                                                  | An interactive map                                                                                                                                   | Not in v1 (no map node). Degrades to a `list` of stops plus `link`s                                                                                                                                                 | `itinerary-degraded.json`           |
| 3D pitch/roll/yaw; arcade game [S21][S22]                                                                                                                                                                         | 3D scenes and games                                                                                                                                  | Not in v1 (needs generated code)                                                                                                                                                                                    | —                                   |

One hands-on observation also becomes a requirement: a reload reset the free-tier calculator's inputs [S16], whereas
our local state survives a reload on the same device.

**Codebase facts that constrain the design**

- **Hermes** (`~/dev/hermes-agent`, fork of NousResearch/hermes-agent, branch `main`):
    - The Matrix adapter is `plugins/platforms/matrix/adapter.py` (mautrix, optional E2EE). It sends `m.text` with
      `formatted_body` (`_build_text_message_content`, line 2922) and streams by `m.replace` edits (`edit_message`,
      line 1483). The per-event cap is `_MAX_CONTENT_BYTES = 45_000` (line 378).
    - Pickers and approvals are emoji reactions (`_send_reaction_prompt`, line 1658). The base adapter has
      `send_clarify`/`send_slash_confirm` hooks with a text fallback (`gateway/platforms/base.py`, line 2816).
    - Tools register through `tools/registry.py` `registry.register(name, toolset, schema, handler, check_fn)`, and the
      gateway passes them a `callback`.
- **Element Web**:
    - Message bodies are chosen in `MessageEvent.render()`
      (`apps/web/src/components/views/messages/MessageEvent.tsx`, line 267). Both the legacy timeline and
      `feature_new_timeline` (via `LegacyEventTileAdapter`) go through it.
    - `mxEvent.getContent()` already returns the latest `m.replace` content.
    - Reply previews pass `overrideBodyTypes` (`ReplyTileViewModel`).
    - `addReplyToMessageContent` (`apps/web/src/utils/Reply.ts`, line 86) builds reply and thread relations.
    - There are no chart, graph or schema dependencies (only `katex`), so the renderers are in-house SVG and HTML.
    - The module API also exposes `customComponents.registerMessageRenderer`, but built-in support is needed for
      "first-class".
- **Element X Android** (`~/dev/element-x-android`, fork) uses `org.matrix.rustcomponents:sdk-android:26.09.9-custom.1`.
  The FFI already exposes the raw event JSON: `LazyTimelineItemProvider.debug_info()` returns `original_json` and
  `latest_edit_json` (`matrix-rust-sdk/bindings/matrix-sdk-ffi/src/timeline/mod.rs`, line 1616), and Android already
  maps it (`EventTimelineItemMapper.kt:61`, used in `InboxThreadHistory.kt:52`). `Room.send_raw(event_type, content)`
  exists in the FFI and encrypts, but it bypasses the timeline send queue, so there is no local echo. **No rust-sdk
  change is needed to start.** A typed accessor is an optional follow-up (R1).

**Sources** (retrieval notes: help.openai.com and openai.com returned HTTP 403 to direct fetch, so [S1][S3][S9] are
search-indexed passages of the official pages, and [S8] mixes official release notes with secondary reports)

- [S1] OpenAI Help, "Intelligent UI in ChatGPT" — https://help.openai.com/en/articles/20001598-intelligent-ui-in-chatgpt
  (indexed passages; the Spanish copy https://help.openai.com/es-419/articles/20001598-intelligent-ui-in-chatgpt holds the "Simple" setting text)
- [S2] 9to5Mac, "OpenAI brings GPT-6 to ChatGPT and debuts Intelligent UI", 2026-10-07 —
  https://9to5mac.com/2026/10/07/openai-brings-gpt-6-to-chatgpt-and-debuts-intelligent-ui/
- [S3] OpenAI, "GPT-6 for everyone" — https://openai.com/index/gpt-6-for-everyone/ (direct fetch 403; content via [S2] and search)
- [S4] Secondary analyses: https://wavect.io/blog/openai-intelligent-ui-vs-openui.md ,
  https://aiidelist.com/blog/openai-intelligent-ui-gpt-6 (secondary; used only for the "no public API" point)
- [S5] OpenAI Developers, "Build ChatGPT UI" — https://developers.openai.com/plugins/build/chatgpt-ui (fetched directly)
- [S6] MCP, "MCP Apps" — https://modelcontextprotocol.io/docs/extensions/apps (fetched directly)
- [S7] MCP Apps spec 2026-01-26 — https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx (fetched directly)
- [S8] OpenAI model release notes — https://help-lb.openai.com/en/articles/9624314-model-release-notes ; reports of the Canvas
  help-article removal: https://community.openai.com/t/please-restore-canvas-as-a-persistent-workspace-writing-blocks-are-not-an-equivalent-replacement/1398999
- [S9] OpenAI Help, "Data analysis with ChatGPT" — https://help.openai.com/en/articles/8437071-data-analysis-with-chatgpt (indexed passages)
- [S10] OpenAI, "ChatKit widgets" — https://developers.openai.com/api/docs/guides/chatkit-widgets.md (fetched directly)
- [S11] A2UI — https://a2ui.org/ (v0.9.1 current, v1.0 RC)
- [S12] A2UI v0.9 basic catalog — https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json (fetched directly)
- [S13] MSC4139 bot buttons — https://github.com/matrix-org/matrix-spec-proposals/pull/4139 (text read from the proposal branch)
- [S14] MSC2192 inline widgets — https://github.com/matrix-org/matrix-spec-proposals/pull/2192 ; MSC1236 — https://github.com/matrix-org/matrix-doc/issues/1236
- [S15] TechCrunch, "ChatGPT is getting a lot more visual…", 2026-10-07 — https://techcrunch.com/2026/10/07/chatgpt-is-getting-a-lot-more-visual-with-the-launch-of-a-new-interface/
- [S16] AIWIZ hands-on tests (UK free web vs Pro desktop, 2026-10-11) — https://aiwiz.uk/blog/gpt-6-intelligent-ui-chatgpt/ (secondary, single runs)
- [S17] ChatGPT shopping carousels — https://www.webfx.com/blog/ai/chatgpt-shopping/ ,
  https://www.thekeyword.co/news/openai-rolls-out-new-shopping-feature-inside-chatgpt (secondary)
- [S18] OpenAI Apps SDK UI guidelines (inline carousel, fullscreen, PiP) — https://developers.openai.com/apps-sdk/concepts/ui-guidelines (search-indexed)
- [S19] The Rundown, "How to use ChatGPT Intelligent UI" (workshop calculator walk-through) — https://app.therundown.ai/guides/chatgpt-intelligent-ui-guide (secondary)
- [S20] Shopifreaks launch summary — https://www.shopifreaks.com/openai-launches-intelligent-ui-which-fills-chatgpt-answers-with-interactive-charts-calculators-and-diagrams-alongside-gpt-6/ (secondary)
- [S21] CopilotKit OpenIntelligentUI (unaffiliated recreation of launch scenes: 3D, table→chart, bill splitter, map) — https://github.com/CopilotKit/OpenIntelligentUI
- [S22] thesys Open Intelligent UI (unaffiliated recreation; "16 examples" including a 7-speed bike and an arcade game) — https://github.com/thesysdev/open-intelligent-ui

### 2.2 Boundaries and data flow

```
GPT model ──tool call present_ui(ui)──▶ Hermes
   Hermes: validate (schema v1 + limits) ─err─▶ tool_error back to the model (self-correct)
           build fallback Markdown → HTML (existing _markdown_to_html + sanitiser)
           send m.room.message {body, formatted_body, net.15cm.matrix.interactive_ui: payload}
           (revisions: m.replace with the full payload in m.new_content)
Matrix (E2EE as configured) ──sync──▶ Element Web / Element X Android
   client: parse + validate (same limits) ─fail─▶ render body/formatted_body exactly as today
           render catalog natively; local state per device
   local interaction (set_state/toggle_state/graph select/sort/tabs): no network traffic
   backend action (submit): m.room.message reply {body, m.mentions, net.15cm.matrix.interactive_ui.action}
Hermes inbound: authorise sender → resolve UI event (must be own, same room) → validate against latest revision
           → dedupe nonce → optional edit status=submitted → inject one agent turn → model replies (text or present_ui)
```

**Trust boundaries**

- The **model** is untrusted. Hermes validates its output, and clients validate it again.
- The **room** is untrusted: any member can send a UI payload (D4). Clients therefore treat every payload as hostile
  data. The card never borrows Element chrome (dialogs, verification banners, login), has no password field, loads no
  remote media, and shows every link target in a confirmation dialog.
- **Generated UI never executes code** and never touches the Matrix client. The view model is the only code that can
  send, and it can only send the action content defined in §2.3, as the user, into the same room or thread, after an
  explicit user gesture.
- **Hermes** trusts an action only from authorised senders, and only against a UI event it sent itself. It ignores
  values the user could not have chosen.

**Lifecycle, persistence, sync, replay and devices**

- **The UI is a pure function of event content** (latest edit), so every device, re-sync and history replay gets the
  same UI.
- **Local view state is per device**, matching ChatGPT's "retained on refresh, not across threads". It is stored in
  `localStorage` under `mx_interactive_ui:<roomId>:<eventId>` as `{ ui_id, revision, state }`, wrapped in try/catch.
  On a new revision, a value is kept only if the key still exists with the same type and, for options, the value is
  still offered. Otherwise the payload's initial `state` value is used.
- **Durable outcomes live in the room.** These are the action messages and the sender's status edit
  (`submitted`/`expired`/`superseded`). They are therefore consistent across devices and replay.
- **Streaming.** v1 sends the whole payload after the tool call completes; Hermes' existing tool-progress line covers
  the wait. Revisions are full-payload edits, and `revision` increases strictly. Partial or streamed payloads are not
  in v1, because a fallback must be complete in every event.
- **Capability negotiation.** Matrix gives a sender no per-client capability exchange. So every event is **dual-encoded**:
  the fallback is always complete and generated deterministically by Hermes from the payload. Then:
    - `version` gates the whole payload: clients render `version === 1` and fall back for anything else.
    - Unknown **properties** are ignored, which allows forward-compatible additions.
    - Unknown **node types** render that node's optional `fallback` string, or nothing. The payload still renders.

### 2.3 Wire format (exact)

Constants (TypeScript, Python and Kotlin all use these exact strings):

```ts
export const INTERACTIVE_UI_KEY = "net.15cm.matrix.interactive_ui";
export const INTERACTIVE_UI_ACTION_KEY = "net.15cm.matrix.interactive_ui.action";
export const INTERACTIVE_UI_VERSION = 1;
```

**UI event** (`m.room.message`, sent by Hermes):

```json5
{
    msgtype: "m.text",
    body: "<complete Markdown fallback>",
    format: "org.matrix.custom.html",
    formatted_body: "<sanitised HTML of the fallback>",
    "m.mentions": {},
    "m.relates_to": {/* optional thread relation, unchanged Hermes behaviour */},
    "net.15cm.matrix.interactive_ui": InteractiveUiPayload,
}
```

A revision is an `m.replace` edit with top-level `body: "* <title or first line>"`. It carries **no** top-level payload,
to keep under the size cap. `m.new_content` holds the full UI event content above. Clients read the payload from the
latest replacement content: `getContent()` on web, `m.new_content` of `latest_edit_json` on Android.

**Payload (`InteractiveUiPayload`, version 1)**

```ts
type Id = string; // /^[A-Za-z0-9_-]{1,64}$/
type StateKey = string; // /^[A-Za-z0-9_]{1,40}$/
type Scalar = string | number | boolean | null;
type StateValue = Scalar | string[];

interface InteractiveUiPayload {
    version: 1;
    ui_id: string; // /^[A-Za-z0-9._-]{1,64}$/, stable across revisions
    revision: number; // integer ≥ 0, strictly increasing per ui_id
    status: "active" | "submitted" | "expired" | "superseded";
    status_text?: string; // ≤ 200
    title?: string; // ≤ 200
    state: Record<StateKey, StateValue>; // ≤ 50 keys; initial values
    root: Id;
    nodes: Node[]; // ≤ 300, flat; tree via children ids
}

interface NodeBase {
    id: Id;
    type: string;
    visible_when?: Condition;
    fallback?: string; // ≤ 500, shown if a client does not know `type`
}
interface Condition {
    state: StateKey;
    equals?: Scalar;
    in?: Scalar[];
    not?: boolean;
} // exactly one of equals | in

type Action =
    | { type: "set_state"; key: StateKey; value: StateValue }
    | { type: "toggle_state"; key: StateKey } // boolean keys only
    | {
          type: "submit";
          action_id: string /* /^[A-Za-z0-9._-]{1,64}$/ */;
          include?: StateKey[];
          single_use?: boolean /* default false (D5) */;
      }
    | { type: "open_url"; url: string /* https: only, ≤ 2048 */ };
```

Node types (strings ≤ 200 unless noted; every `bind` key must exist in `state` with a compatible type):

| Family   | `type`         | Properties                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Layout   | `stack`        | `children: Id[]`, `direction: "vertical"\|"horizontal"` (horizontal wraps when narrow), `gap?: "none"\|"sm"\|"md"\|"lg"`                                                                                                                                                                                                                                                                                                                                |
|          | `card`         | `title?`, `children: Id[]`                                                                                                                                                                                                                                                                                                                                                                                                                              |
|          | `tabs`         | `bind: StateKey` (string), `tabs: {value: string, label: string, child: Id}[]` (1–8)                                                                                                                                                                                                                                                                                                                                                                    |
|          | `collapsible`  | `label`, `children: Id[]`, `bind?: StateKey` (boolean)                                                                                                                                                                                                                                                                                                                                                                                                  |
|          | `divider`      | —                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Content  | `heading`      | `text`, `level: 1\|2\|3`                                                                                                                                                                                                                                                                                                                                                                                                                                |
|          | `text`         | `text` (≤ 4000, plain, newlines kept), `tone?: "default"\|"muted"\|"emphasis"`, `size?: "body"\|"caption"`                                                                                                                                                                                                                                                                                                                                              |
|          | `rich_text`    | `text` (≤ 8000 plain), `html?` (≤ 16000, Matrix `formatted_body` subset, sanitised by the client's existing pipeline)                                                                                                                                                                                                                                                                                                                                   |
|          | `badge`        | `text`, `tone?: "neutral"\|"info"\|"success"\|"warning"\|"critical"`                                                                                                                                                                                                                                                                                                                                                                                    |
|          | `key_value`    | `items: {label, value}[]` (≤ 50)                                                                                                                                                                                                                                                                                                                                                                                                                        |
|          | `list`         | `items: {text, secondary?}[]` (≤ 100), `ordered?: boolean`                                                                                                                                                                                                                                                                                                                                                                                              |
|          | `image`        | `alt` (required), `url?: "mxc://…"` **or** `file?: EncryptedFile` (Matrix spec), `mimetype: "image/png"\|"image/jpeg"\|"image/gif"\|"image/webp"`, `width?`, `height?`                                                                                                                                                                                                                                                                                  |
|          | `carousel`     | `label` (accessible name), `items: {id: Id, image: {url?: "mxc://…", file?: EncryptedFile, mimetype, alt}, title (≤ 80), subtitle? (≤ 120), meta?: string[] (≤ 3 lines, each ≤ 80), badge?: {text, tone?}, action?: Action}[]` (1–10; 3–8 recommended, as in the ChatGPT Apps guidelines). Each item has **one** optional action. A horizontal scroll-snap row with previous/next buttons and "Item n of m". With one item it renders as a single card. |
|          | `link`         | `label` (≤ 80), `url` (https only, ≤ 2048), `kind?: "source"\|"external"`. Renders as a citation chip that shows the host name, and opens only through the `open_url` confirmation dialog. Used for source attribution inside components.                                                                                                                                                                                                               |
| Data     | `table`        | `caption?`, `columns: {key: StateKey, label, kind?: "text"\|"number", align?: "start"\|"end"}[]` (1–12), `rows: Record<string, string\|number\|null>[]` (≤ 200), `sortable?: boolean`                                                                                                                                                                                                                                                                   |
|          | `chart`        | `kind: "bar"\|"line"\|"pie"\|"scatter"`, `title?`, `x_label?`, `y_label?`, `unit?` (≤ 16). For bar/line/pie: `categories: string[]` (≤ 100) and `series: {name, values: number[]}[]` (≤ 8; pie has exactly 1; `values.length === categories.length`). For scatter: `series: {name, points: {x: number, y: number, label?}[]}[]`. Total values ≤ 800. Finite numbers only.                                                                               |
|          | `graph`        | `direction?: "left_to_right"\|"top_to_bottom"`, `layers: {label}[]` (1–8, column/row headings), `nodes: {id: Id, label (≤ 80), detail? (≤ 1000), layer: number (index into layers), tone?: badge tone}[]` (≤ 80, ids unique within the graph), `edges: {from: Id, to: Id, label? (≤ 60), style?: "solid"\|"dashed"}[]` (≤ 200, endpoints must exist), `bind_selected?: StateKey` (string\|null)                                                         |
| Controls | `button`       | `label`, `variant?: "primary"\|"secondary"\|"danger"`, `action: Action`                                                                                                                                                                                                                                                                                                                                                                                 |
|          | `select`       | `label`, `bind` (string), `options: {value: string, label}[]` (1–50)                                                                                                                                                                                                                                                                                                                                                                                    |
|          | `choice`       | `label`, `bind` (string, or string[] when `multiple`), `options` (1–20), `multiple?: boolean`                                                                                                                                                                                                                                                                                                                                                           |
|          | `toggle`       | `label`, `bind` (boolean)                                                                                                                                                                                                                                                                                                                                                                                                                               |
|          | `text_input`   | `label`, `bind` (string), `multiline?`, `placeholder?`, `max_length` (1–2000), `required?`. **No password/secret variant.**                                                                                                                                                                                                                                                                                                                             |
|          | `number_input` | `label`, `bind` (number), `min?`, `max?`, `step?`, `display?: "field"\|"slider"` (slider requires min and max)                                                                                                                                                                                                                                                                                                                                          |
|          | `form`         | `children: Id[]`, `submit_label`, `action_id`, `single_use?` (default true). Submitting includes every `bind` key of descendant controls and enforces `required` / `max_length` / `min` / `max` before sending.                                                                                                                                                                                                                                         |

The reference screenshot is expressed as: a `heading` and `rich_text`, a `select` bound to `branch` ("knowledge
branch"), one `graph` per branch gated by `visible_when {state: "branch", equals: …}` with `layers`
["Ingredients", "Mechanisms", "Results"] and `bind_selected: "focus"`, a `text` gated on `focus` for extra notes, and
a `button` `{type: "submit", action_id: "explain_node", include: ["focus"]}` labelled "Explain this mechanism".

**Action message** (`m.room.message`, sent by the user's client):

```json5
{
    "msgtype": "m.text",
    "body": "“Explain this mechanism” — focus: Maillard reaction", // built from labels, ≤ 1000
    "m.mentions": { user_ids: ["<UI event sender>"] },
    "m.relates_to": {/* addReplyToMessageContent(content, uiEvent): reply, plus thread when the UI is in a thread */},
    "net.15cm.matrix.interactive_ui.action": {
        version: 1,
        ui_event_id: "$original_ui_event_id", // never the edit's id
        ui_id: "…",
        revision: 3, // revision the user acted on
        action_id: "explain_node",
        values: { focus: "maillard" }, // only included/form keys; option *values*, not labels
        nonce: "<22+ chars base64url random>",
    },
}
```

### 2.4 Validation limits and errors

The same limits apply on every side. The canonical description is
`apps/web/src/interactive-ui/schema/interactive-ui-v1.schema.json` (JSON Schema 2020-12, documentation and
cross-language reference). The executable truth is the **shared conformance fixtures** in
`apps/web/src/interactive-ui/fixtures/{valid,invalid}/*.json`. Each invalid fixture has a sibling
`*.expected.json` `{ "path": "nodes[3].options", "code": "too_many" }` that Hermes and Android vendor and test against.

- Serialised payload ≤ **40 000 UTF-8 bytes** (Hermes); clients accept ≤ **60 000**. Nodes ≤ 300; tree depth ≤ 12;
  every node is reachable from `root` exactly once (no cycles, no sharing). Hermes rejects unreachable nodes; the
  client ignores them.
- At most 24 images per payload (`image` nodes plus carousel items).
- Strings are trimmed. C0 controls other than `\n` and `\t` are rejected. Lengths are as in the table above. Numbers
  must be finite.
- `bind`, `include` and `Condition.state` must reference declared state keys of a compatible type. `set_state.value`
  must match the key's type. `select`/`choice`/`tabs` initial values must be among the options (or `null`).
- **Error codes** (`InteractiveUiErrorCode`): `not_object`, `bad_version`, `too_large`, `missing_field`, `bad_type`,
  `bad_id`, `duplicate_id`, `unknown_ref`, `cycle`, `too_deep`, `too_many`, `too_long`, `bad_value`, `bad_url`,
  `type_mismatch`. The client logs the first error with `logger.warn` (no content) and shows the fallback. Hermes
  returns `tool_error("interactive_ui: <path>: <code>: <hint>")` so the model can retry.
- **Action-side errors** (Hermes): `unauthorised_sender`, `unknown_ui`, `stale_revision`, `inactive`, `bad_action`,
  `bad_values`, `duplicate`. `duplicate` is dropped silently. The others get a short `m.notice` reply (i18n) and do
  not run a model turn.

### 2.5 Element Web interfaces (exact)

**Protocol module** `apps/web/src/interactive-ui/` (pure TypeScript, no React):

```ts
// protocol.ts
export const INTERACTIVE_UI_KEY, INTERACTIVE_UI_ACTION_KEY, INTERACTIVE_UI_VERSION; // see §2.3
export type InteractiveUiPayload, InteractiveUiNode, InteractiveUiAction, InteractiveUiCondition, InteractiveUiStateValue;
export type InteractiveUiErrorCode = "not_object" | "bad_version" | /* … §2.4 */ "type_mismatch";
export interface InteractiveUiError { path: string; code: InteractiveUiErrorCode }
export type ParseResult =
    | { ok: true; payload: InteractiveUiPayload; nodesById: ReadonlyMap<string, InteractiveUiNode> }
    | { ok: false; error: InteractiveUiError };
/** Returns `undefined` when the content carries no payload (not an error). Never throws. */
export function parseInteractiveUi(content: unknown): ParseResult | undefined;

// state.ts
export function initialState(payload: InteractiveUiPayload): Record<string, InteractiveUiStateValue>;
export function mergeSavedState(payload, saved: unknown): Record<string, InteractiveUiStateValue>;
export function evaluateCondition(cond: InteractiveUiCondition, state): boolean;
export function validateSubmission(payload, nodeId: string, state):
    { ok: true; actionId: string; values: Record<string, InteractiveUiStateValue> } | { ok: false; invalidKeys: string[] };

// action.ts
export function buildActionContent(args: {
    uiEvent: MatrixEvent; payload: InteractiveUiPayload; actionId: string;
    values: Record<string, InteractiveUiStateValue>; triggerLabel: string; nonce: string;
}): RoomMessageTextEventContent; // body + m.mentions + reply/thread relation + action key
```

**View** `packages/shared-components/src/room/timeline/event-tile/body/InteractiveUiView/`. The view model resolves
everything, so the view only draws:

```ts
export type InteractiveUiValue = string | number | boolean | null | string[];
export type InteractiveUiRenderNode =
    | {
          kind: "stack";
          id: string;
          direction: "vertical" | "horizontal";
          gap: "none" | "sm" | "md" | "lg";
          children: InteractiveUiRenderNode[];
      }
    | { kind: "card"; id: string; title?: string; children: InteractiveUiRenderNode[] }
    | {
          kind: "tabs";
          id: string;
          selected: string;
          tabs: { value: string; label: string; content: InteractiveUiRenderNode }[];
      }
    | { kind: "collapsible"; id: string; label: string; open: boolean; children: InteractiveUiRenderNode[] }
    | { kind: "divider"; id: string }
    | { kind: "heading"; id: string; text: string; level: 1 | 2 | 3 }
    | { kind: "text"; id: string; text: string; tone: "default" | "muted" | "emphasis"; size: "body" | "caption" }
    | { kind: "rich_text"; id: string; text: string; safeHtml?: string } // safeHtml already sanitised by the VM
    | { kind: "badge"; id: string; text: string; tone: BadgeTone }
    | { kind: "key_value"; id: string; items: { label: string; value: string }[] }
    | { kind: "list"; id: string; ordered: boolean; items: { text: string; secondary?: string }[] }
    | { kind: "image"; id: string; alt: string; src?: string; width?: number; height?: number } // src is a resolved (decrypted) blob/thumbnail URL
    | {
          kind: "table";
          id: string;
          caption?: string;
          columns: TableColumn[];
          rows: TableCell[][];
          sort?: { key: string; dir: "asc" | "desc" };
          sortable: boolean;
      }
    | { kind: "chart"; id: string; chart: ChartModel; showData: boolean }
    | { kind: "graph"; id: string; graph: GraphLayout; selectedId: string | null; showAsList: boolean }
    | {
          kind: "button";
          id: string;
          label: string;
          variant: "primary" | "secondary" | "danger";
          disabled: boolean;
          pending: boolean;
          external: boolean;
      }
    | {
          kind: "select" | "choice";
          id: string;
          label: string;
          value: InteractiveUiValue;
          multiple: boolean;
          options: { value: string; label: string }[];
          disabled: boolean;
      }
    | { kind: "toggle"; id: string; label: string; value: boolean; disabled: boolean }
    | {
          kind: "text_input";
          id: string;
          label: string;
          value: string;
          multiline: boolean;
          placeholder?: string;
          maxLength: number;
          required: boolean;
          invalid: boolean;
          disabled: boolean;
      }
    | {
          kind: "number_input";
          id: string;
          label: string;
          value: number | null;
          min?: number;
          max?: number;
          step?: number;
          display: "field" | "slider";
          invalid: boolean;
          disabled: boolean;
      }
    | {
          kind: "form";
          id: string;
          submitLabel: string;
          children: InteractiveUiRenderNode[];
          disabled: boolean;
          pending: boolean;
      }
    | {
          kind: "carousel";
          id: string;
          label: string;
          index: number;
          items: {
              id: string;
              src?: string;
              alt: string;
              title: string;
              subtitle?: string;
              meta: string[];
              badge?: { text: string; tone: BadgeTone };
              actionLabel?: string;
              disabled: boolean;
          }[];
      }
    | { kind: "link"; id: string; label: string; host: string; sourceKind: "source" | "external" }
    | { kind: "unknown"; id: string; fallback?: string };

export interface InteractiveUiViewSnapshot {
    title?: string;
    status: "active" | "sending" | "awaiting_confirmation" | "submitted" | "expired" | "superseded"; // see D6
    statusText?: string;
    /** A single_use action has waited 8 s for the sender's status edit; the view shows a hint and "Try again". */
    confirmationOverdue: boolean;
    root: InteractiveUiRenderNode;
    showAsText: boolean;
}
export interface InteractiveUiViewActions {
    setValue: (nodeId: string, value: InteractiveUiValue) => void; // controls, tabs, collapsible
    activate: (nodeId: string) => void; // buttons
    submitForm: (nodeId: string) => void;
    selectGraphNode: (nodeId: string, graphNodeId: string | null) => void;
    setGraphListMode: (nodeId: string, asList: boolean) => void;
    setChartDataMode: (nodeId: string, showData: boolean) => void;
    sortTable: (nodeId: string, columnKey: string) => void;
    setShowAsText: (showAsText: boolean) => void;
    setCarouselIndex: (nodeId: string, index: number) => void;
    activateCarouselItem: (nodeId: string, itemId: string) => void;
    openLink: (nodeId: string) => void; // always via the open_url confirmation
    retryAfterOverdue: () => void; // back to "active"; sends nothing
}
export type InteractiveUiViewModel = ViewModel<InteractiveUiViewSnapshot, InteractiveUiViewActions>;
export function InteractiveUiView(props: { vm: InteractiveUiViewModel; fallback: ReactNode }): JSX.Element;
```

Data-viz types and components, also in shared-components (used by `InteractiveUiView`):

```ts
// graph/GraphLayout.ts — pure, deterministic, identical algorithm specified for Android
export interface GraphLayout {
    direction: "left_to_right" | "top_to_bottom";
    layers: { label: string; index: number }[];
    nodes: { id: string; label: string; detail?: string; tone: BadgeTone; layer: number; order: number }[]; // order = position within its layer
    edges: { from: string; to: string; label?: string; style: "solid" | "dashed" }[];
}
export function layoutLayeredGraph(input: {
    direction;
    layers: { label: string }[];
    nodes: { id; label; detail?; layer; tone? }[];
    edges;
}): GraphLayout;
// 1. Start with input order inside each layer.
// 2. Run four barycentre sweeps (down, up, down, up), ordering each layer by the mean order of its
//    neighbours in the adjacent layer. Ties keep the previous order (stable).
// 3. Pixel geometry is fixed: node 168×56 px (label clamped to 2 lines, full label in an accessible
//    name/tooltip), 72 px between layers, 16 px between nodes. Edges are cubic Béziers between box sides.
//    Back-edges and same-layer edges route around the box.
export function InteractiveUiGraphView(props: {
    layout: GraphLayout;
    selectedId: string | null;
    showAsList: boolean;
    onSelect: (id: string | null) => void;
    onToggleList: (asList: boolean) => void;
}): JSX.Element;

// chart/ChartModel.ts
export type ChartModel =
    | {
          kind: "bar" | "line";
          title?: string;
          xLabel?: string;
          yLabel?: string;
          unit?: string;
          categories: string[];
          series: { name: string; values: number[] }[];
      }
    | { kind: "pie"; title?: string; unit?: string; categories: string[]; values: number[] }
    | {
          kind: "scatter";
          title?: string;
          xLabel?: string;
          yLabel?: string;
          unit?: string;
          series: { name: string; points: { x: number; y: number; label?: string }[] }[];
      };
export function niceTicks(min: number, max: number, maxTicks: number): number[];
export function InteractiveUiChartView(props: {
    chart: ChartModel;
    showData: boolean;
    onToggleData: (show: boolean) => void;
}): JSX.Element;
export function InteractiveUiTableView(props: {
    caption?: string;
    columns: TableColumn[];
    rows: TableCell[][];
    sort?: { key: string; dir: "asc" | "desc" };
    sortable: boolean;
    onSort?: (key: string) => void;
}): JSX.Element;
```

**View model** `apps/web/src/viewmodels/message-body/InteractiveUiBodyViewModel.ts`:

```ts
export interface InteractiveUiBodyViewModelProps {
    mxEvent: MatrixEvent;
    client: MatrixClient;
    /** Parsed payload; the caller already handled `ok: false`. */
    parsed: Extract<ParseResult, { ok: true }>;
    mediaResolver?: (node: ImageNode) => Promise<string | undefined>; // decrypt/thumbnail via existing media helpers
    confirmOpenUrl?: (url: string) => Promise<boolean>; // defaults to a QuestionDialog showing the full URL
    storage?: Pick<Storage, "getItem" | "setItem">; // defaults to window.localStorage, wrapped in try/catch
    now?: () => number;
}
export class InteractiveUiBodyViewModel
    extends BaseViewModel<InteractiveUiViewSnapshot, InteractiveUiBodyViewModelProps>
    implements InteractiveUiViewActions {
    /* arrow-function actions; listens to MatrixEventEvent.Replaced via this.disposables */
}
```

**Wiring.**

- `apps/web/src/components/views/messages/InteractiveUiBody.tsx` is a function component (`IBodyProps`). It calls
  `parseInteractiveUi(mxEvent.getContent())`. When the result is `ok`, it creates the VM with
  `useCreateAutoDisposedViewModel` and renders `<InteractiveUiView vm fallback={<TextualBody …/>} />`. Otherwise it
  renders `TextualBody` plus the "couldn't show interactive content" caption.
- `MessageEvent.render()` selects it before the msgtype lookup when all of these hold:
  `SettingsStore.getValue("feature_interactive_ui")`, `!forExport`, no `overrideBodyTypes` (reply previews), not
  redacted, not a decryption failure, and `INTERACTIVE_UI_KEY in content`.
- `feature_interactive_ui` goes in `apps/web/src/settings/Settings.tsx` (labs, `LabGroup.Messaging`), with a
  `docs/labs.md` entry.

### 2.6 Hermes interfaces (follow-up workspace H1 — contract only, not implemented here)

The Hermes interfaces below are a proposed contract. Check them against Hermes conventions in that workspace before
coding.

```python
# tools/interactive_ui_tool.py
INTERACTIVE_UI_KEY = "net.15cm.matrix.interactive_ui"
INTERACTIVE_UI_ACTION_KEY = "net.15cm.matrix.interactive_ui.action"
def validate_payload(payload: dict, *, strict: bool = True) -> list[InteractiveUiError]   # mirrors §2.4; strict rejects unreachable nodes
def render_fallback_markdown(payload: dict) -> str   # deterministic: headings, lists, tables, chart data tables, graph as "A → B (label)" per layer, controls as "Options: …"
def present_ui_tool(ui: dict, summary: str | None = None, replace_ui_id: str | None = None, *, callback) -> str
#   → json {"ok": true, "ui_id", "event_id", "revision"} | tool_error("interactive_ui: <path>: <code>: <hint>")
registry.register(name="present_ui", toolset="interactive_ui", schema=PRESENT_UI_SCHEMA, handler=..., check_fn=...)

# gateway/platforms/base.py
async def send_interactive_ui(self, chat_id: str, payload: dict, fallback_markdown: str,
                              metadata: dict | None = None, replace_event_id: str | None = None) -> SendResult
#   default: self.send(chat_id, fallback_markdown) — every platform degrades to text
def supports_interactive_ui(self) -> bool   # default False; Matrix True when enabled in config

# plugins/platforms/matrix/adapter.py
#   send_interactive_ui override: build the §2.3 content, enforce _MAX_CONTENT_BYTES (error back to the tool if over), m.replace for revisions
#   _on_room_message: if INTERACTIVE_UI_ACTION_KEY in content → _handle_interactive_ui_action(...)
#     (authorise → fetch UI event (own, same room) → latest own m.replace → validate values → nonce dedupe
#      → for single_use actions, the status edit (submitted) is sent IMMEDIATELY on acceptance, before the model runs (D6);
#        repeatable actions get no edit
#      → inject one agent turn: "[interactive_ui] <body>\n<json action>")
```

`PRESENT_UI_SCHEMA` is the input schema: the payload minus `version`/`revision`/`status`, which Hermes fills in. It is
a flat, non-recursive schema, so it works with strict tool schemas. Prompt guidance for the model goes in the tool
description: use UI only when it helps, keep the payload small, always write meaningful labels, and never put secrets
in UI.

The `ui_id → latest revision` map is stored in Hermes state. Restart safety comes from re-reading the UI event from
the room, so an in-memory cache alone is not enough.

### 2.7 Element X Android (follow-up workspace A1 — contract only)

- Parsing: Kotlin `InteractiveUiParser` with the same limits and codes, tested against the vendored fixtures. The
  source is `timelineItemDebugInfoProvider().latestEditJson?.m.new_content ?: originalJson.content`, extracted once
  per item in the timeline mapper into a new `TimelineItemInteractiveUiContent` (fallback: the existing text content).
- Rendering: Compose renderers for the catalog. The graph uses the identical layered algorithm and fixed geometry
  (§2.5), with horizontal scroll and a list alternative; TalkBack labels come from the same fields.
- Sending: `Room.sendRaw("m.room.message", json)` with the §2.3 content. There is no local echo (known limitation), so
  the pending UI is driven by the presenter. Optional R1 (matrix-rust-sdk) adds a typed accessor and a
  send-queue-backed send with custom keys.
- Feature flag in the app's feature-flag module, plus a Maestro flow and an emulator check per the repo's
  `element-x-android-e2e` skill.

### 2.8 Conventions

- New files carry the copyright header with year **2026**. The holder is `Element Creations Ltd.` only if this is an
  Element contribution; otherwise it is the contributor's name. Write the header by hand and check what
  `oxlint --fix` inserts.
- Named exports only. i18n strings go through `_t`/`_td` in apps/web and through the shared-components i18n, followed
  by `pnpm i18n`. Use Compound tokens and components (`Button`, `Form`, `Dropdown`/`Select`, `Badge`, `Text`,
  `Heading`, `Separator`), CSS modules in shared-components, and `Flex`/`Box`.
- Chart palette: `--cpd-color-bg-decorative-1…6` and the matching text tokens. Series are also distinguished by
  marker shape and dash, never by colour alone.

### 2.9 Not in v1 (explicit)

- Generated code of any kind (games, 3D) and computed values or formulas (D7). A sandboxed usercontent iframe tier
  modelled on `src/usercontent/pdf` remains a possible later phase and would need its own security review.
- Maps, video/audio nodes, date pickers, clickable hotspots on images.
- Streaming partial payloads.
- Cross-device sync of unsubmitted local state.
- Forwarding ChatGPT-native Intelligent UI (no API exists).
- iOS (Element X iOS is not in scope).

---

## 3. Tasks

All tasks in §3.1–§3.3 are in **this worktree**. §3.5 lists the follow-up workspaces this plan depends on but does
**not** implement.

### Wave 1

**T1 — Protocol, validation, fixtures** _(subtle: bounded parser, tree checks, state merge)_

- Goal: implement the §2.3/§2.4 contract as a pure TS module, plus the canonical JSON Schema and shared fixtures.
- Owns: `apps/web/src/interactive-ui/{protocol,state,action}.ts` and their `*.test.ts`, `apps/web/src/interactive-ui/schema/interactive-ui-v1.schema.json`,
  `apps/web/src/interactive-ui/fixtures/{valid,invalid}/*.json` (at least: layout, content, table, chart ×4, graph
  (the reference "knowledge map" in Chinese and English), controls, form, revision pair, and every "covered" row of
  the real-examples table in §2.1; invalid cases for every error code, including an 11-item carousel, an `http:`
  link and a carousel item with two actions), and `apps/web/src/interactive-ui/fixtures/README.md` (how other repos vendor them).
- Produces: `parseInteractiveUi`, `initialState`, `mergeSavedState`, `evaluateCondition`, `validateSubmission`,
  `buildActionContent`, the types, constants, and fixtures.
- Consumes: matrix-js-sdk types; `addReplyToMessageContent` (`apps/web/src/utils/Reply.ts`).
- Tests: every fixture round-trips (valid → ok; invalid → expected `{path, code}`). A schema/fixture agreement test
  checks each valid fixture against the JSON Schema with a tiny in-test checker, or asserts the schema lists every
  node type and property. Limits and timing are checked on generated 60 KB/300-node inputs. The parser never throws
  on fuzzed input (seeded random mutation of fixtures). Action content covers plain-room, thread and edited-UI cases
  (`ui_event_id` is the original id).
- Command: `pnpm vitest run apps/web/src/interactive-ui`

**T2 — Data-viz views: graph, chart, table** _(subtle: layout determinism, accessibility, narrow widths)_

- Goal: dumb, self-contained shared components for the three data-heavy node kinds, plus their pure layout helpers.
- Owns: `packages/shared-components/src/room/timeline/event-tile/body/InteractiveUiView/graph/*`, `…/chart/*`,
  `…/table/*`, with each component's `.tsx`, `.module.css`, `.test.tsx` and `.stories.tsx`, and their i18n strings
  in `packages/shared-components/src/i18n/strings/en_EN.json`.
- Produces: `layoutLayeredGraph`, `GraphLayout`, `InteractiveUiGraphView`, `ChartModel`, `niceTicks`,
  `InteractiveUiChartView`, `InteractiveUiTableView`, and the `TableColumn`/`TableCell`/`BadgeTone` types (§2.5).
- Consumes: Compound components and tokens only.
- Tests: layout is deterministic and stable across the four sweeps, with a crossing count on fixtures no worse than
  input order. `niceTicks` edge cases cover zero range, negatives and huge values. Graph keyboard tests cover Tab
  order, Enter/Space select, Escape clear, and list mode listing every edge. Chart tests cover `role="img"` with a
  summary label, the data-table toggle, and a single-value pie. Table tests cover sort by number and by text, stable
  ties, and `aria-sort`. Stories exist for light, dark and 360 px.
- Command: `cd packages/shared-components && pnpm test:unit -- src/room/timeline/event-tile/body/InteractiveUiView`

### Wave 2

**T3 — `InteractiveUiView` (tree renderer and controls)**

- Goal: the root view and every non-data-viz node kind, composing T2 components, as a dumb view over
  `InteractiveUiViewSnapshot`.
- Owns: `packages/shared-components/src/room/timeline/event-tile/body/InteractiveUiView/{InteractiveUiView.tsx,InteractiveUiView.module.css,InteractiveUiView.test.tsx,InteractiveUiView.stories.tsx,index.ts}`,
  the export from the shared-components index, and its i18n strings.
- Produces: `InteractiveUiView`, `InteractiveUiViewSnapshot`, `InteractiveUiViewActions`, `InteractiveUiViewModel`,
  `InteractiveUiRenderNode`, `InteractiveUiValue` (§2.5).
- Consumes: T2.
- Tests: each node kind renders and calls the right action. Disabled and pending states are covered. The `unknown`
  node shows its fallback. "Show as text" swaps in the `fallback` prop. The status banner is covered. Horizontal
  stacks wrap. Every control has an accessible name.
- Depends on: T2.
- Command: `cd packages/shared-components && pnpm test:unit -- src/room/timeline/event-tile/body/InteractiveUiView`

### Wave 3

**T4 — View model, timeline wiring, labs flag, e2e** _(subtle: edit/revision handling, pending lifecycle, per-device state)_

- Goal: make the feature real in Element Web end to end.
- Owns:
    - `apps/web/src/viewmodels/message-body/InteractiveUiBodyViewModel.ts` and `.test.ts`
    - `apps/web/src/components/views/messages/InteractiveUiBody.tsx` and `.test.tsx`
    - the edit to `apps/web/src/components/views/messages/MessageEvent.tsx` and its test
      `MessageEvent.test.tsx` (extended)
    - `apps/web/src/settings/Settings.tsx` (flag)
    - `apps/web/src/i18n/strings/en_EN.json`
    - `docs/labs.md`
    - `apps/web/playwright/e2e/interactive-ui/interactive-ui.spec.ts`, plus snapshots generated in Docker only
- Produces: the user-visible feature, the `feature_interactive_ui` flag, and the e2e journey (§5 part A).
- Consumes: T1 (parse, state, action), T3 (view), existing media helpers (`MediaEventHelper`/decryption for `file`
  images), `Modal`/`QuestionDialog`, `MatrixClient.sendMessage`.
- VM behaviour:
    - Rebuild the render tree on `MatrixEventEvent.Replaced`, ignoring payloads with a lower `revision`.
    - Use `merge` for single-field updates.
    - Persist local state (debounced).
    - On `activate`/`submitForm`, call `validateSubmission`, then `buildActionContent`, then `client.sendMessage(roomId, threadRootId, content)`.
    - The snapshot status follows D6. `sending` lasts from the press until `sendMessage` resolves. A repeatable action
      then returns to `active`. A `single_use` action moves to `awaiting_confirmation`, and when a newer revision or a
      non-active status arrives it adopts that status. After 8 s without one it sets `confirmationOverdue`. "Try again"
      returns the card to `active` and sends nothing. If the user presses again, a new nonce goes out. If Hermes had
      in fact accepted the first press, it answers with its `inactive` notice, which tells the user what happened. A
      retry never disappears silently.
    - A send failure re-enables controls and shows an error.
    - `open_url` goes through `confirmOpenUrl`, then `window.open(url, "_blank", "noopener,noreferrer")`.
- Tests:
    - VM (vitest, fake client and event): state, conditions, revision merge, the sending → active and sending → awaiting_confirmation → submitted/overdue transitions (fake timers), payload of the sent
      content, thread relation, failure path, disposal removes listeners.
    - `MessageEvent` (vitest): flag on/off, reply preview, export, invalid payload, version 2.
    - e2e as in §5 part A.
- Depends on: T1, T3.
- Commands: `pnpm vitest run apps/web/src/viewmodels/message-body/InteractiveUiBodyViewModel.test.ts apps/web/src/components/views/messages/InteractiveUiBody.test.tsx apps/web/src/components/views/messages/MessageEvent.test.tsx`
  and `cd apps/web && pnpm test:playwright -- playwright/e2e/interactive-ui/interactive-ui.spec.ts --project=Chrome`

### 3.4 Commit plan (inside this worktree)

There is one commit per task: T1 protocol, T2 data-viz views, T3 tree view, T4 wiring/flag/e2e. The plan document
gets its own commit. Commit subjects are short imperative lines with no prefix.

### 3.5 Required follow-up workspaces (outside this worktree — **not** implemented by this plan)

| ID     | Repository                                                   | Scope                                                                                                                                                                                                                                                                                                                                 | Blocks                           |
| ------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| **H1** | `~/dev/hermes-agent` (fork `sinkerine/hermes-agent`, `main`) | §2.6. Covers the `present_ui` tool, validation against the vendored T1 fixtures, the fallback generator, base adapter hooks, the Matrix send/edit/inbound action path, config `interactive_ui.enabled`, and pytest tests under `tests/plugins/platforms/matrix/` and `tests/tools/`. The real-model eval (§5 part B) also lives here. | Criteria 9, 11 (real), §5 part B |
| **A1** | `~/dev/element-x-android` (fork)                             | §2.7. Covers the Kotlin parser against the vendored fixtures, Compose renderers, the timeline mapper, the action send via `Room.sendRaw`, the feature flag, unit and screenshot tests, and a Maestro flow.                                                                                                                            | Criterion 10, §5 part C          |
| R1     | `~/dev/matrix-rust-sdk` (fork) — **optional**                | A typed FFI accessor for raw latest content, and a send-queue-backed raw message send with local echo. This is only needed if A1 finds `debugInfo`/`sendRaw` inadequate (performance, local echo).                                                                                                                                    | Nothing in v1                    |

All three consume the T1 fixtures and schema by vendoring them, and record which Element Web commit they copied from.
An MSC write-up (unstable prefix `net.15cm.matrix.*`) is optional and later.

---

## 4. Test and verification (whole feature, this worktree)

Run from the repo root.

```sh
pnpm vitest run apps/web/src/interactive-ui apps/web/src/viewmodels/message-body/InteractiveUiBodyViewModel.test.ts \
  apps/web/src/components/views/messages/InteractiveUiBody.test.tsx apps/web/src/components/views/messages/MessageEvent.test.tsx
(cd packages/shared-components && pnpm test:unit -- src/room/timeline/event-tile/body/InteractiveUiView)
pnpm test:unit                                   # full vitest suite, no regressions
pnpm i18n                                        # strings regenerated and committed
pnpm -r --workspace-concurrency=1 lint:types     # types
pnpm lint                                        # oxfmt, oxlint (copyright headers), styles, knip
(cd apps/web && pnpm build)                      # production build includes the new code
(cd packages/shared-components && pnpm build)
pnpm test:unit --coverage && (cd packages/shared-components && pnpm coverage) && pnpm coverage:diff   # ≥ 80 % on the diff
(cd packages/shared-components && pnpm test:storybook)   # visual baselines: new stories only, generated/updated in Docker per AGENTS.md
(cd apps/web && pnpm test:playwright -- playwright/e2e/interactive-ui/interactive-ui.spec.ts --project=Chrome)
```

Review every new or changed `.png` per AGENTS.md before committing. Only the new interactive-UI stories and e2e
screenshots may change.

---

## 5. E2E journey

### Part A — fixture-backed client journey (this worktree, runnable now)

This needs a container runtime for the Playwright homeserver. Check `lsof -ti:8080` first.
`apps/web/playwright/e2e/interactive-ui/interactive-ui.spec.ts` uses the existing `bot` fixture as a **stand-in for
Hermes**, sending T1 fixtures verbatim.

| #   | Step                                                                                                                                                                              | Expected                                                                                                                                                                                                                                                                                                                                   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Labs `feature_interactive_ui` on. A bot joins an **encrypted** DM and sends the knowledge-map fixture.                                                                            | The tile shows a bordered card with the heading, the rich text, a "Knowledge branch" select, and a graph with three column headings. No fallback text is visible.                                                                                                                                                                          |
| 2   | Choose another branch in the select.                                                                                                                                              | The graph switches to that branch's nodes. No new event appears in the timeline (assert the bot receives nothing).                                                                                                                                                                                                                         |
| 3   | Tab to a mechanism node and press Enter.                                                                                                                                          | The node is selected, its incident edges are highlighted, and its detail text is shown. "Show relationships as list" lists those edges.                                                                                                                                                                                                    |
| 4   | Reload the page.                                                                                                                                                                  | The same branch and node are still selected (per-device state).                                                                                                                                                                                                                                                                            |
| 5   | Press "Explain this mechanism".                                                                                                                                                   | The button shows "sending" briefly, then is enabled again (repeatable action, D5). The user's timeline shows a reply to the UI event with the readable body. The bot receives `m.room.message` whose action key has `action_id: "explain_node"`, `values.focus` set to the node id, a `revision`, the original `ui_event_id`, and a nonce. |
| 6   | The bot sends a "Confirm" button (`single_use: true`) and the user presses it. The bot replies with `m.replace` carrying `revision + 1`, `status: "submitted"` and `status_text`. | Between the send and the edit, the card says it is waiting for confirmation. After the edit, controls are disabled and the status text is shown in place without the timeline jumping.                                                                                                                                                     |
| 6b  | Repeat step 6 with a bot that never edits.                                                                                                                                        | After 8 s the card says "No confirmation from <bot> yet" and offers "Try again". "Try again" re-enables the controls and sends nothing.                                                                                                                                                                                                    |
| 7   | The bot sends a form fixture in a **thread**. Submit it with a required field empty, then fill it and submit again.                                                               | The first attempt blocks with an inline error and sends nothing. The second sends one action message inside the same thread.                                                                                                                                                                                                               |
| 8   | The bot sends table, chart (bar/line/pie/scatter) and content fixtures.                                                                                                           | All render. Table sorting works. The chart "Show data" shows a table. `@screenshot` light, dark and 360 px viewports have no page horizontal scroll.                                                                                                                                                                                       |
| 8b  | The bot sends the product-carousel fixture (5 items, encrypted images). Use the next button, arrow keys and a swipe on a 360 px viewport.                                         | The images decrypt and show. "Item 2 of 5" is announced. Only the carousel scrolls, not the page. Each item's one action is reachable by keyboard.                                                                                                                                                                                         |
| 9   | The bot sends an `open_url` button and the user presses it.                                                                                                                       | A confirmation dialog shows the full https URL. Cancel opens nothing.                                                                                                                                                                                                                                                                      |
| 10  | The bot sends an invalid fixture and a `version: 2` payload.                                                                                                                      | Both show the normal text fallback. The invalid one also shows the "couldn't show interactive content" caption.                                                                                                                                                                                                                            |
| 11  | Labs flag off, then reload.                                                                                                                                                       | Every UI event renders exactly as its `body`/`formatted_body`. Replies to UI events show the normal reply preview.                                                                                                                                                                                                                         |
| 12  | Run an axe scan (existing accessibility helpers) on steps 1, 7 and 8.                                                                                                             | No violations.                                                                                                                                                                                                                                                                                                                             |

### Part B — real Hermes + GPT (needs H1; **blocked here**)

1. Configure Hermes with the Matrix adapter, `interactive_ui.enabled: true`, and an OpenAI GPT model (needs an API
   key). Point it at the Part A homeserver or a dev Synapse, in an E2EE room with Element Web and the flag on.
2. Ask (Chinese and English): "用知识图谱解释这本书里的成分—机制—结果关系，并允许按知识分支切换" ("Use a knowledge map to
   explain this book's ingredient–mechanism–result relationships, and let me switch by knowledge branch").
   Expect: the model calls `present_ui`, Hermes logs one validation pass (or a self-corrected retry), and Element Web
   renders the card as in Part A.
3. Press "Explain this mechanism". Expect: Hermes logs an accepted action, edits the UI to `submitted`, and the model's
   next message (text or a revised UI) addresses the selected node.
4. Replay a stale or duplicated action (resend the same content). Expect: no second model turn; a stale revision gets
   a notice.
5. Check a non-supporting client (or flag off). Expect: the fallback Markdown alone is a complete answer.

**Blockers:** the H1 implementation, an OpenAI credential, and a running Hermes plus homeserver. Model quality, such as
choosing UI only when useful, is evaluated in H1 with a small prompt set. It is not a pass/fail criterion of this
worktree.

### Part C — Element X Android (needs A1; **blocked here**)

Use the Part A fixtures sent by a script bot, or Part B with real Hermes, on an emulator (API 33 as in CI) via Maestro
or Orca:

1. Render the knowledge-map fixture.
2. Switch the branch and select a node, and check TalkBack labels.
3. Submit and check that the bot receives identical action content.
4. Check that the status edit disables the controls.
5. Turn the flag off and check that the text fallback is shown.

**Blocker:** the A1 implementation. Follow that repo's install rules (`adb install -r --no-incremental`).

---

## 6. Review log

- 2026-11-02: the user confirmed the namespace (D3) and delegated the single-use default (decided in D5). They
  rejected the 30 s pending timeout, which was replaced by the split send/confirmation model with an 8 s
  confirmation hint (D6).
- 2026-11-02: the user asked for an image carousel and for more examples from real ChatGPT answers. `carousel` and
  citation `link` were added to the catalog, and §2.1 now maps the real examples to fixtures.
- 2026-11-02: the user decided against computed values (D7). Calculators stay out of v1, and no open decisions remain.
- 2026-11-02: the user approved the plan. Showcase mock: https://claude.ai/artifact/UEUSV2F9DZ3i74mFuaN445

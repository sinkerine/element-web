/*
Copyright 2024 New Vector Ltd.
Copyright 2023 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "test-utils-rtl";
import userEvent from "@testing-library/user-event";
import { Room } from "matrix-js-sdk/src/matrix";
import { type ReplacementEvent, type RoomMessageEventContent } from "matrix-js-sdk/src/types";
import {
    getMockClientWithEventEmitter,
    getRoomContext,
    mkEvent,
    mockClientMethodsUser,
    setupRoomWithEventsTimeline,
} from "test-utils";

import EditMessageComposerWithMatrixClient, { createEditContent } from "./EditMessageComposer";
import EditorModel from "../../../editor/model";
import { createPartCreator } from "../../../editor/__mocks__";
import DocumentOffset from "../../../editor/offset";
import SettingsStore from "../../../settings/SettingsStore";
import EditorStateTransfer from "../../../utils/EditorStateTransfer";
import MatrixClientContext from "../../../contexts/MatrixClientContext";
import Autocompleter, { type IProviderCompletions } from "../../../autocomplete/Autocompleter";
import NotifProvider from "../../../autocomplete/NotifProvider";
import DMRoomMap from "../../../utils/DMRoomMap";
import { ScopedRoomContextProvider } from "../../../contexts/ScopedRoomContext.tsx";
import type { RoomContextType } from "../../../contexts/RoomContext.ts";
import { SDKContext } from "../../../contexts/SDKContext.ts";
import { SDKContextClass } from "../../../contexts/SDKContextClass.ts";

import { createRedactEventDialog } from "../dialogs/ConfirmRedactDialog";
import dis from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";
import { editorRoomKey, editorStateKey } from "../../../Editing";

vi.mock("../dialogs/ConfirmRedactDialog", () => ({ createRedactEventDialog: vi.fn() }));

describe("<EditMessageComposer/>", () => {
    const userId = "@alice:server.org";
    const roomId = "!room:server.org";
    const mockClient = getMockClientWithEventEmitter({
        ...mockClientMethodsUser(userId),
        getRoom: vi.fn(),
        sendMessage: vi.fn(),
    });
    const room = new Room(roomId, mockClient, userId);
    const dispatchSpy = vi.spyOn(dis, "dispatch");

    const editedEvent = mkEvent({
        type: "m.room.message",
        user: "@alice:test",
        room: "!abc:test",
        content: { body: "original message", msgtype: "m.text" },
        event: true,
    });

    const eventWithMentions = mkEvent({
        type: "m.room.message",
        user: userId,
        room: roomId,
        content: {
            "msgtype": "m.text",
            "body": "hey Bob and Charlie",
            "format": "org.matrix.custom.html",
            "formatted_body":
                'hey <a href="https://matrix.to/#/@bob:server.org">Bob</a> and <a href="https://matrix.to/#/@charlie:server.org">Charlie</a>',
            "m.mentions": {
                user_ids: ["@bob:server.org", "@charlie:server.org"],
            },
        },
        event: true,
    });

    // message composer emojipicker uses this
    // which would require more irrelevant mocking
    vi.spyOn(SettingsStore, "setValue").mockResolvedValue(undefined);

    const defaultRoomContext = getRoomContext(room, {});

    const getComponent = (
        editState: EditorStateTransfer,
        roomContext: RoomContextType = defaultRoomContext,
        urlPreviewProps: {
            updateUrlPreviews?: (model: EditorModel) => void;
            attachBundles?: (content: RoomMessageEventContent) => Promise<boolean>;
            isUrlPreviewsModified?: boolean;
        } = {},
    ) =>
        render(<EditMessageComposerWithMatrixClient editState={editState} {...urlPreviewProps} />, {
            wrapper: ({ children }) => (
                <SDKContext.Provider value={SDKContextClass.instance}>
                    <MatrixClientContext.Provider value={mockClient}>
                        <ScopedRoomContextProvider {...roomContext}>{children}</ScopedRoomContextProvider>
                    </MatrixClientContext.Provider>
                </SDKContext.Provider>
            ),
        });

    beforeEach(() => {
        mockClient.getRoom.mockReturnValue(room);
        mockClient.sendMessage.mockClear();
        dispatchSpy.mockClear();
        vi.mocked(createRedactEventDialog).mockClear();

        userEvent.setup();

        DMRoomMap.makeShared(mockClient);

        vi.spyOn(Autocompleter.prototype, "getCompletions").mockResolvedValue([
            {
                completions: [
                    {
                        completion: "@dan:server.org",
                        completionId: "@dan:server.org",
                        type: "user",
                        suffix: " ",
                        component: <span>Dan</span>,
                    },
                ],
                command: {
                    command: ["@d"],
                },
                provider: new NotifProvider(room),
            } as unknown as IProviderCompletions,
        ]);
    });

    const editText = async (text: string, shouldClear?: boolean): Promise<void> => {
        const input = screen.getByRole("textbox");
        if (shouldClear) {
            await userEvent.clear(input);
        }
        await userEvent.type(input, text);
    };

    it("should edit a simple message", async () => {
        const editState = new EditorStateTransfer(editedEvent);
        getComponent(editState);
        await editText(" + edit");

        fireEvent.click(screen.getByText("Save"));

        const expectedBody = {
            ...editedEvent.getContent(),
            "body": "* original message + edit",
            "m.new_content": {
                "body": "original message + edit",
                "msgtype": "m.text",
                "m.mentions": {},
            },
            "m.relates_to": {
                event_id: editedEvent.getId(),
                rel_type: "m.replace",
            },
            "m.mentions": {},
        };
        await waitFor(() =>
            expect(mockClient.sendMessage).toHaveBeenCalledWith(editedEvent.getRoomId()!, null, expectedBody),
        );
    });

    describe("media captions", () => {
        const media = (caption?: string) =>
            mkEvent({
                type: "m.room.message",
                user: userId,
                room: roomId,
                event: true,
                content: {
                    msgtype: "m.image",
                    body: caption ?? "photo.png",
                    url: "mxc://server/image",
                    info: { mimetype: "image/png", w: 20, h: 30 },
                    ...(caption
                        ? {
                              filename: "photo.png",
                              format: "org.matrix.custom.html",
                              formatted_body: `<strong>${caption}</strong>`,
                          }
                        : {}),
                },
            });

        it.each([
            ["add", undefined, "a caption"],
            ["change", "old caption", "new caption"],
            ["remove", "old caption", ""],
            ["literal emote", undefined, "/me caption"],
            ["literal command", undefined, "/join #room:server.org"],
            ["unknown command", undefined, "/unknown caption"],
            ["formatted", undefined, "a **caption**"],
        ])("should send a media caption edit: %s", async (_name, oldCaption, caption) => {
            const event = media(oldCaption);
            const attachBundles = vi.fn();
            getComponent(new EditorStateTransfer(event), defaultRoomContext, { attachBundles });
            await userEvent.clear(screen.getByRole("textbox"));
            if (caption) await editText(caption);
            fireEvent.click(screen.getByText("Save"));
            await waitFor(() => expect(mockClient.sendMessage).toHaveBeenCalledTimes(1));
            const content = mockClient.sendMessage.mock.calls[0][2];
            expect(content).toMatchObject({
                "msgtype": "m.image",
                "body": `* ${caption || "photo.png"}`,
                "url": "mxc://server/image",
                "m.relates_to": { rel_type: "m.replace", event_id: event.getId() },
                "m.new_content": {
                    msgtype: "m.image",
                    body: caption || "photo.png",
                    filename: "photo.png",
                    url: "mxc://server/image",
                    info: event.getContent().info,
                },
            });
            if (caption === "a **caption**") {
                expect(content).toMatchObject({
                    "format": "org.matrix.custom.html",
                    "formatted_body": "* a <strong>caption</strong>",
                    "m.new_content": { format: "org.matrix.custom.html", formatted_body: "a <strong>caption</strong>" },
                });
            } else {
                expect(content["m.new_content"]).not.toHaveProperty("format");
                expect(content["m.new_content"]).not.toHaveProperty("formatted_body");
            }
            expect(createRedactEventDialog).not.toHaveBeenCalled();
            expect(attachBundles).not.toHaveBeenCalled();
        });

        it.each(["", "   "])("should close an empty uncaptioned media edit on Enter: %j", async (text) => {
            const event = media();
            getComponent(new EditorStateTransfer(event));
            expect(screen.getByRole("textbox").textContent).toBe("");
            expect(screen.getByText("Save")).toHaveAttribute("disabled");
            if (text) await editText(text);

            await userEvent.type(screen.getByRole("textbox"), "{enter}");

            expect(dispatchSpy).toHaveBeenCalledWith({
                action: Action.EditEvent,
                event: null,
                timelineRenderingType: defaultRoomContext.timelineRenderingType,
            });
            expect(dispatchSpy).toHaveBeenCalledWith({
                action: Action.FocusSendMessageComposer,
                context: defaultRoomContext.timelineRenderingType,
            });
            expect(localStorage.getItem(editorRoomKey(roomId, defaultRoomContext.timelineRenderingType))).toBeNull();
            expect(localStorage.getItem(editorStateKey(event.getId()!))).toBeNull();
            expect(mockClient.sendMessage).not.toHaveBeenCalled();
            expect(createRedactEventDialog).not.toHaveBeenCalled();
        });

        it.each([undefined, "caption"])("should keep Save disabled for unchanged captions: %s", async (caption) => {
            const event = media(caption);
            // Use plain text so serializing the unchanged caption preserves its original format.
            delete event.getContent().format;
            delete event.getContent().formatted_body;
            getComponent(new EditorStateTransfer(event));
            expect(screen.getByText("Save")).toHaveAttribute("disabled");
            fireEvent.click(screen.getByText("Save"));
            expect(mockClient.sendMessage).not.toHaveBeenCalled();
            if (caption) {
                await userEvent.type(screen.getByRole("textbox"), "{enter}");
                expect(dispatchSpy).not.toHaveBeenCalledWith(expect.objectContaining({ action: Action.EditEvent }));
                expect(mockClient.sendMessage).not.toHaveBeenCalled();
                expect(createRedactEventDialog).not.toHaveBeenCalled();
            }
        });
    });

    it.each(["Save", "Enter"])("should still open the redact dialog for an empty text edit via %s", async (submit) => {
        getComponent(new EditorStateTransfer(editedEvent));
        await userEvent.clear(screen.getByRole("textbox"));
        if (submit === "Save") {
            fireEvent.click(screen.getByText("Save"));
        } else {
            await userEvent.type(screen.getByRole("textbox"), "{enter}");
        }
        expect(createRedactEventDialog).toHaveBeenCalledWith(expect.objectContaining({ mxEvent: editedEvent }));
        expect(mockClient.sendMessage).not.toHaveBeenCalled();
    });

    it("should throw when room for message is not found", () => {
        mockClient.getRoom.mockReturnValue(null);
        const editState = new EditorStateTransfer(editedEvent);
        expect(() => getComponent(editState, { ...defaultRoomContext, room: undefined })).toThrow(
            "Cannot render without room",
        );
    });

    describe("createEditContent", () => {
        it("sends plaintext messages correctly", async () => {
            const model = new EditorModel([], createPartCreator());
            const documentOffset = new DocumentOffset(11, true);
            await model.update("hello world", "insertText", documentOffset);

            const content = createEditContent(model, editedEvent);

            expect(content).toEqual({
                "body": "* hello world",
                "msgtype": "m.text",
                "m.new_content": {
                    "body": "hello world",
                    "msgtype": "m.text",
                    "m.mentions": {},
                },
                "m.relates_to": {
                    event_id: editedEvent.getId(),
                    rel_type: "m.replace",
                },
                "m.mentions": {},
            });
        });

        it("sends markdown messages correctly", async () => {
            const model = new EditorModel([], createPartCreator());
            const documentOffset = new DocumentOffset(13, true);
            await model.update("hello *world*", "insertText", documentOffset);

            const content = createEditContent(model, editedEvent);

            expect(content).toEqual({
                "body": "* hello *world*",
                "msgtype": "m.text",
                "format": "org.matrix.custom.html",
                "formatted_body": "* hello <em>world</em>",
                "m.new_content": {
                    "body": "hello *world*",
                    "msgtype": "m.text",
                    "format": "org.matrix.custom.html",
                    "formatted_body": "hello <em>world</em>",
                    "m.mentions": {},
                },
                "m.relates_to": {
                    event_id: editedEvent.getId(),
                    rel_type: "m.replace",
                },
                "m.mentions": {},
            });
        });

        it("strips /me from messages and marks them as m.emote accordingly", async () => {
            const model = new EditorModel([], createPartCreator());
            const documentOffset = new DocumentOffset(22, true);
            await model.update("/me blinks __quickly__", "insertText", documentOffset);

            const content = createEditContent(model, editedEvent);

            expect(content).toEqual({
                "body": "* blinks __quickly__",
                "msgtype": "m.emote",
                "format": "org.matrix.custom.html",
                "formatted_body": "* blinks <strong>quickly</strong>",
                "m.new_content": {
                    "body": "blinks __quickly__",
                    "msgtype": "m.emote",
                    "format": "org.matrix.custom.html",
                    "formatted_body": "blinks <strong>quickly</strong>",
                    "m.mentions": {},
                },
                "m.relates_to": {
                    event_id: editedEvent.getId(),
                    rel_type: "m.replace",
                },
                "m.mentions": {},
            });
        });

        it("allows emoting with non-text parts", async () => {
            const model = new EditorModel([], createPartCreator());
            const documentOffset = new DocumentOffset(16, true);
            await model.update("/me ✨sparkles✨", "insertText", documentOffset);
            expect(model.parts.length).toEqual(4); // Emoji count as non-text

            const content = createEditContent(model, editedEvent);

            expect(content).toEqual({
                "body": "* ✨sparkles✨",
                "msgtype": "m.emote",
                "m.new_content": {
                    "body": "✨sparkles✨",
                    "msgtype": "m.emote",
                    "m.mentions": {},
                },
                "m.relates_to": {
                    event_id: editedEvent.getId(),
                    rel_type: "m.replace",
                },
                "m.mentions": {},
            });
        });

        it("allows sending double-slash escaped slash commands correctly", async () => {
            const model = new EditorModel([], createPartCreator());
            const documentOffset = new DocumentOffset(32, true);

            await model.update("//dev/null is my favourite place", "insertText", documentOffset);

            const content = createEditContent(model, editedEvent);

            // TODO Edits do not properly strip the double slash used to skip
            // command processing.
            expect(content).toEqual({
                "body": "* //dev/null is my favourite place",
                "msgtype": "m.text",
                "m.new_content": {
                    "body": "//dev/null is my favourite place",
                    "msgtype": "m.text",
                    "m.mentions": {},
                },
                "m.relates_to": {
                    event_id: editedEvent.getId(),
                    rel_type: "m.replace",
                },
                "m.mentions": {},
            });
        });
    });

    describe("when message is not a reply", () => {
        it("should attach an empty mentions object for a message with no mentions", async () => {
            const editState = new EditorStateTransfer(editedEvent);
            getComponent(editState);
            const editContent = " + edit";
            await editText(editContent);

            fireEvent.click(screen.getByText("Save"));

            await waitFor(() => expect(mockClient.sendMessage).toHaveBeenCalled());
            const messageContent = mockClient.sendMessage.mock.calls[0][2] as RoomMessageEventContent &
                ReplacementEvent<RoomMessageEventContent>;

            // both content.mentions and new_content.mentions are empty
            expect(messageContent["m.mentions"]).toEqual({});
            expect(messageContent["m.new_content"]!["m.mentions"]).toEqual({});
        });

        it("should retain mentions in the original message that are not removed by the edit", async () => {
            const editState = new EditorStateTransfer(eventWithMentions);
            getComponent(editState);
            // Remove charlie from the message
            const editContent = "{backspace}{backspace}friends";
            await editText(editContent);

            fireEvent.click(screen.getByText("Save"));

            await waitFor(() => expect(mockClient.sendMessage).toHaveBeenCalled());
            const messageContent = mockClient.sendMessage.mock.calls[0][2] as RoomMessageEventContent &
                ReplacementEvent<RoomMessageEventContent>;

            // no new mentions were added, so nothing in top level mentions
            expect(messageContent["m.mentions"]).toEqual({});
            // bob is still mentioned, charlie removed
            expect(messageContent["m.new_content"]!["m.mentions"]).toEqual({
                user_ids: ["@bob:server.org"],
            });
        });

        it("should remove mentions that are removed by the edit", async () => {
            const editState = new EditorStateTransfer(eventWithMentions);
            getComponent(editState);
            const editContent = "new message!";
            // clear the original message
            await editText(editContent, true);

            fireEvent.click(screen.getByText("Save"));

            await waitFor(() => expect(mockClient.sendMessage).toHaveBeenCalled());
            const messageContent = mockClient.sendMessage.mock.calls[0][2] as RoomMessageEventContent &
                ReplacementEvent<RoomMessageEventContent>;

            // no new mentions were added, so nothing in top level mentions
            expect(messageContent["m.mentions"]).toEqual({});
            // bob is not longer mentioned in the edited message, so empty mentions in new_content
            expect(messageContent["m.new_content"]!["m.mentions"]).toEqual({});
        });

        it("should add mentions that were added in the edit", async () => {
            const editState = new EditorStateTransfer(editedEvent);
            getComponent(editState);
            const editContent = " and @d";
            await editText(editContent);

            // wait for autocompletion to render
            await screen.findByText("Dan");
            // submit autocomplete for mention
            await editText("{enter}");

            fireEvent.click(screen.getByText("Save"));

            await waitFor(() => expect(mockClient.sendMessage).toHaveBeenCalled());
            const messageContent = mockClient.sendMessage.mock.calls[0][2] as RoomMessageEventContent &
                ReplacementEvent<RoomMessageEventContent>;

            // new mention in the edit
            expect(messageContent["m.mentions"]).toEqual({
                user_ids: ["@dan:server.org"],
            });
            expect(messageContent["m.new_content"]!["m.mentions"]).toEqual({
                user_ids: ["@dan:server.org"],
            });
        });

        it("should add and remove mentions from the edit", async () => {
            const editState = new EditorStateTransfer(eventWithMentions);
            getComponent(editState);
            // Remove charlie from the message
            await editText("{backspace}{backspace}");
            // and replace with @room
            await editText("@d");
            // wait for autocompletion to render
            await screen.findByText("Dan");
            // submit autocomplete for @dan mention
            await editText("{enter}");

            fireEvent.click(screen.getByText("Save"));

            await waitFor(() => expect(mockClient.sendMessage).toHaveBeenCalled());
            const messageContent = mockClient.sendMessage.mock.calls[0][2] as RoomMessageEventContent &
                ReplacementEvent<RoomMessageEventContent>;

            // new mention in the edit
            expect(messageContent["m.mentions"]).toEqual({
                user_ids: ["@dan:server.org"],
            });
            // all mentions in the edited version of the event
            expect(messageContent["m.new_content"]!["m.mentions"]).toEqual({
                user_ids: ["@bob:server.org", "@dan:server.org"],
            });
        });
    });

    describe("when message is replying", () => {
        const originalEvent = mkEvent({
            type: "m.room.message",
            user: "@ernie:test",
            room: roomId,
            content: { body: "original message", msgtype: "m.text" },
            event: true,
        });

        const replyEvent = mkEvent({
            type: "m.room.message",
            user: "@bert:test",
            room: roomId,
            content: {
                "body": "reply with plain message",
                "msgtype": "m.text",
                "m.relates_to": {
                    "m.in_reply_to": {
                        event_id: originalEvent.getId(),
                    },
                },
                "m.mentions": {
                    user_ids: [originalEvent.getSender()!],
                },
            },
            event: true,
        });

        const replyWithMentions = mkEvent({
            type: "m.room.message",
            user: "@bert:test",
            room: roomId,
            content: {
                "body": 'reply that mentions <a href="https://matrix.to/#/@bob:server.org">Bob</a>',
                "msgtype": "m.text",
                "m.relates_to": {
                    "m.in_reply_to": {
                        event_id: originalEvent.getId(),
                    },
                },
                "m.mentions": {
                    user_ids: [
                        // sender of event we replied to
                        originalEvent.getSender()!,
                    ],
                },
            },
            event: true,
        });

        beforeEach(() => {
            setupRoomWithEventsTimeline(room, [originalEvent, replyEvent]);
        });

        it("should retain parent event sender in mentions when editing with plain text", async () => {
            const editState = new EditorStateTransfer(replyEvent);
            getComponent(editState);
            const editContent = " + edit";
            await editText(editContent);

            fireEvent.click(screen.getByText("Save"));

            await waitFor(() => expect(mockClient.sendMessage).toHaveBeenCalled());
            const messageContent = mockClient.sendMessage.mock.calls[0][2] as RoomMessageEventContent &
                ReplacementEvent<RoomMessageEventContent>;

            // no new mentions from edit
            expect(messageContent["m.mentions"]).toEqual({});
            // edited reply still mentions the parent event sender
            expect(messageContent["m.new_content"]!["m.mentions"]).toEqual({
                user_ids: [originalEvent.getSender()],
            });
        });

        it("should retain parent event sender in mentions when adding a mention", async () => {
            const editState = new EditorStateTransfer(replyEvent);
            getComponent(editState);
            await editText(" and @d");
            // wait for autocompletion to render
            await screen.findByText("Dan");
            // submit autocomplete for @dan mention
            await editText("{enter}");

            fireEvent.click(screen.getByText("Save"));

            await waitFor(() => expect(mockClient.sendMessage).toHaveBeenCalled());
            const messageContent = mockClient.sendMessage.mock.calls[0][2] as RoomMessageEventContent &
                ReplacementEvent<RoomMessageEventContent>;

            // new mention in edit
            expect(messageContent["m.mentions"]).toEqual({
                user_ids: ["@dan:server.org"],
            });
            // edited reply still mentions the parent event sender
            // plus new mention @dan
            expect(messageContent["m.new_content"]!["m.mentions"]).toEqual({
                user_ids: [originalEvent.getSender(), "@dan:server.org"],
            });
        });

        it("should retain parent event sender in mentions when removing all mentions from content", async () => {
            const editState = new EditorStateTransfer(replyWithMentions);
            getComponent(editState);
            // replace text to remove all mentions
            await editText("no mentions here", true);

            fireEvent.click(screen.getByText("Save"));

            await waitFor(() => expect(mockClient.sendMessage).toHaveBeenCalled());
            const messageContent = mockClient.sendMessage.mock.calls[0][2] as RoomMessageEventContent &
                ReplacementEvent<RoomMessageEventContent>;

            // no mentions in edit
            expect(messageContent["m.mentions"]).toEqual({});
            // edited reply still mentions the parent event sender
            // existing @bob mention removed
            expect(messageContent["m.new_content"]!["m.mentions"]).toEqual({
                user_ids: [originalEvent.getSender()],
            });
        });

        it("should retain parent event sender in mentions when removing mention of said user", async () => {
            const replyThatMentionsParentEventSender = mkEvent({
                type: "m.room.message",
                user: "@bert:test",
                room: roomId,
                content: {
                    "body": `reply that mentions the sender of the message we replied to <a href="https://matrix.to/#/${originalEvent.getSender()!}">Ernie</a>`,
                    "msgtype": "m.text",
                    "m.relates_to": {
                        "m.in_reply_to": {
                            event_id: originalEvent.getId(),
                        },
                    },
                    "m.mentions": {
                        user_ids: [
                            // sender of event we replied to
                            originalEvent.getSender()!,
                        ],
                    },
                },
                event: true,
            });
            const editState = new EditorStateTransfer(replyThatMentionsParentEventSender);
            getComponent(editState);
            // replace text to remove all mentions
            await editText("no mentions here", true);

            fireEvent.click(screen.getByText("Save"));

            await waitFor(() => expect(mockClient.sendMessage).toHaveBeenCalled());
            const messageContent = mockClient.sendMessage.mock.calls[0][2] as RoomMessageEventContent &
                ReplacementEvent<RoomMessageEventContent>;

            // no mentions in edit
            expect(messageContent["m.mentions"]).toEqual({});
            // edited reply still mentions the parent event sender
            expect(messageContent["m.new_content"]!["m.mentions"]).toEqual({
                user_ids: [originalEvent.getSender()],
            });
        });
    });

    describe("URL previews", () => {
        // Removing a preview changes the event without changing a character of its text, so Save
        // has to be available and the edit has to be sent even though the body is untouched.
        it("should enable Save when only the preview list is modified", () => {
            getComponent(new EditorStateTransfer(editedEvent), defaultRoomContext, {
                isUrlPreviewsModified: true,
            });

            expect(screen.getByText("Save")).not.toHaveAttribute("disabled");
        });

        it("should keep Save disabled and ignore Enter when nothing is modified", async () => {
            getComponent(new EditorStateTransfer(editedEvent));

            expect(screen.getByText("Save")).toHaveAttribute("disabled");
            await userEvent.type(screen.getByRole("textbox"), "{enter}");
            expect(dispatchSpy).not.toHaveBeenCalledWith(expect.objectContaining({ action: Action.EditEvent }));
            expect(mockClient.sendMessage).not.toHaveBeenCalled();
            expect(createRedactEventDialog).not.toHaveBeenCalled();
        });

        it("should send the edit when only the preview list is modified", async () => {
            getComponent(new EditorStateTransfer(editedEvent), defaultRoomContext, {
                isUrlPreviewsModified: true,
            });

            fireEvent.click(screen.getByText("Save"));

            await waitFor(() => expect(mockClient.sendMessage).toHaveBeenCalledTimes(1));
        });

        it("should attach the bundle to the new content before sending", async () => {
            const attachBundles = vi.fn(async (content: RoomMessageEventContent) => {
                (content as unknown as Record<string, unknown>)["com.beeper.linkpreviews"] = [
                    { matched_url: "https://example.org" },
                ];
                return false;
            });

            getComponent(new EditorStateTransfer(editedEvent), defaultRoomContext, {
                isUrlPreviewsModified: true,
                attachBundles,
            });

            fireEvent.click(screen.getByText("Save"));

            await waitFor(() => expect(mockClient.sendMessage).toHaveBeenCalledTimes(1));
            const messageContent = mockClient.sendMessage.mock.calls[0][2] as RoomMessageEventContent &
                ReplacementEvent<RoomMessageEventContent>;
            const newContent = messageContent["m.new_content"] as unknown as Record<string, unknown>;
            expect(newContent["com.beeper.linkpreviews"]).toEqual([{ matched_url: "https://example.org" }]);
        });

        // The user cancelled the pending message while its preview images were uploading.
        it("should not send the edit when attaching reports a cancellation", async () => {
            const attachBundles = vi.fn().mockResolvedValue(true);

            getComponent(new EditorStateTransfer(editedEvent), defaultRoomContext, {
                isUrlPreviewsModified: true,
                attachBundles,
            });

            fireEvent.click(screen.getByText("Save"));

            await waitFor(() => expect(attachBundles).toHaveBeenCalledTimes(1));
            expect(mockClient.sendMessage).not.toHaveBeenCalled();
        });

        // The preview view model only learns about new links by being handed the editor model.
        it("should report the editor model as the composer changes", async () => {
            const updateUrlPreviews = vi.fn();
            getComponent(new EditorStateTransfer(editedEvent), defaultRoomContext, { updateUrlPreviews });

            await editText(" https://example.org");

            await waitFor(() => expect(updateUrlPreviews).toHaveBeenCalled());
            const model = updateUrlPreviews.mock.calls.at(-1)![0] as EditorModel;
            expect(model.contentPlainText).toContain("https://example.org");
        });
    });
});

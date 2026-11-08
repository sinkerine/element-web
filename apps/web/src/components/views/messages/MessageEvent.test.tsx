/*
Copyright 2024 New Vector Ltd.
Copyright 2022 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, type RenderResult } from "test-utils-rtl";
import { type MatrixClient, type MatrixEvent, EventType, type Room, MsgType } from "matrix-js-sdk/src/matrix";
import fetchMock from "@fetch-mock/vitest";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { mkEvent, mkRoom, stubClient } from "test-utils";

import SettingsStore from "../../../settings/SettingsStore";
import MessageEvent from "./MessageEvent";
import { RoomPermalinkCreator } from "../../../utils/permalinks/Permalinks";
import MatrixClientContext from "../../../contexts/MatrixClientContext";
import { Mjolnir } from "../../../mjolnir/Mjolnir";
import { INTERACTIVE_UI_KEY } from "../../../interactive-ui/protocol";
import EditorStateTransfer from "../../../utils/EditorStateTransfer";
import { type IBodyProps } from "./IBodyProps";
import knowledge from "../../../interactive-ui/fixtures/valid/knowledge-map.en.json";

vi.mock("./MBodyFactory", () => ({
    __esModule: true,
    DecryptionFailureBodyFactory: () => <div data-testid="decryption-failure-body" />,
    FileBodyFactory: () => <div data-testid="file-body" />,
    ImageBodyFactory: () => <div data-testid="image-body" />,
    RedactedBodyFactory: () => <div className="mx_RedactedBody">Message deleted by Moderator</div>,
    VideoBodyFactory: () => <video data-testid="video-body" />,
    renderMBody: () => <div data-testid="file-body" />,
}));

vi.mock("./TextualBodyFactory", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./TextualBodyFactory")>();
    return {
        TextualBodyFactory: (props: IBodyProps) =>
            props.editState ? <actual.TextualBodyFactory {...props} /> : <div data-testid="textual-body" />,
    };
});

vi.mock("../rooms/EditMessageComposerWrapper", () => ({
    EditMessageComposerWrapper: ({ editState }: { editState: EditorStateTransfer }) => (
        <textarea aria-label="Edit message" defaultValue={editState.getEvent().getContent().body} />
    ),
}));

vi.mock("./MImageReplyBody", () => ({
    __esModule: true,
    default: () => <div data-testid="image-reply-body" />,
}));

vi.mock("../../../hooks/useMediaVisible", () => ({
    __esModule: true,
    useMediaVisible: () => [true, vi.fn()],
}));

vi.mock("./MStickerBody", () => ({
    __esModule: true,
    default: () => <div data-testid="sticker-body" />,
}));

describe("MessageEvent", () => {
    let room: Room;
    let client: MatrixClient;
    let event: MatrixEvent;

    const makeRedactedBecauseEvent = ({ sender, originServerTs }: { sender: string; originServerTs: number }) => ({
        content: {},
        event_id: "$redaction:example.com",
        origin_server_ts: originServerTs,
        redacts: "$message:example.com",
        room_id: room.roomId,
        sender,
        type: EventType.RoomRedaction,
        unsigned: {},
    });

    const renderMessageEvent = (): RenderResult => {
        return render(
            <MatrixClientContext.Provider value={client}>
                <MessageEvent mxEvent={event} permalinkCreator={new RoomPermalinkCreator(room)} />
            </MatrixClientContext.Provider>,
        );
    };

    beforeEach(() => {
        localStorage.clear();
        client = stubClient();
        room = mkRoom(client, "!room:example.com");
        vi.spyOn(client, "getRoom").mockReturnValue(room);
        vi.spyOn(SettingsStore, "getValue");
        vi.spyOn(SettingsStore, "watchSetting");
        vi.spyOn(SettingsStore, "unwatchSetting").mockImplementation(vi.fn());
    });

    afterEach(() => {
        localStorage.clear();
        vi.restoreAllMocks();
    });

    it("renders the shared redacted body for redacted events", () => {
        vi.spyOn(room, "getMember").mockReturnValue({ name: "Moderator" } as any);
        event = mkEvent({
            event: true,
            type: EventType.RoomMessage,
            user: "@alice:example.com",
            room: room.roomId,
            content: {
                msgtype: MsgType.Text,
                body: "Secret",
            },
            unsigned: {
                redacted_because: makeRedactedBecauseEvent({
                    sender: "@moderator:example.com",
                    originServerTs: Date.UTC(2022, 10, 17, 15, 58, 32),
                }),
            },
        });
        vi.spyOn(event, "isRedacted").mockReturnValue(true);

        const result = renderMessageEvent();

        expect(result.getByText("Message deleted by Moderator")).toBeInTheDocument();
        expect(result.container.querySelector(".mx_RedactedBody")).not.toBeNull();
        expect(result.queryByTestId("textual-body")).toBeNull();
    });

    it("renders the shared Mjolnir body for banned senders", () => {
        vi.spyOn(SettingsStore, "getValue").mockImplementation((settingName) => settingName === "feature_mjolnir");
        vi.spyOn(Mjolnir, "sharedInstance").mockReturnValue({
            isUserBanned: vi.fn().mockReturnValue(true),
            isServerBanned: vi.fn().mockReturnValue(false),
        } as unknown as Mjolnir);
        event = mkEvent({
            event: true,
            type: EventType.RoomMessage,
            id: "$hidden:example.com",
            user: "@alice:example.com",
            room: room.roomId,
            content: {
                msgtype: MsgType.Text,
                body: "Hidden",
            },
        });

        const result = renderMessageEvent();

        expect(result.getByText(/You have ignored this user, so their message is hidden\./)).toBeInTheDocument();
        const allowButton = result.getByRole("button", { name: "Show anyway." });

        fireEvent.click(allowButton);

        expect(localStorage.getItem(`mx_mjolnir_render_${room.roomId}__$hidden:example.com`)).toBe("true");
    });

    it("renders the shared unknown body for unsupported message types", () => {
        event = mkEvent({
            event: true,
            type: EventType.RoomMessage,
            user: "@alice:example.com",
            room: room.roomId,
            content: {
                msgtype: "org.example.unsupported",
                body: "Unsupported message body",
            },
        });

        const result = renderMessageEvent();

        expect(result.getByText("Unsupported message body")).toBeInTheDocument();
        expect(result.container.querySelector(".mx_UnknownBody")).not.toBeNull();
        expect(result.queryByTestId("textual-body")).toBeNull();
    });

    describe("interactive messages", () => {
        const setup = (payload: unknown = knowledge, enabled = true): void => {
            vi.mocked(SettingsStore.getValue).mockImplementation(
                (name) => name === "feature_interactive_ui" && enabled,
            );
            event = mkEvent({
                event: true,
                type: EventType.RoomMessage,
                id: "$ui",
                user: "@bot:example.com",
                room: room.roomId,
                content: { msgtype: MsgType.Text, body: "Fallback", [INTERACTIVE_UI_KEY]: payload },
            });
        };

        it("should select the interactive body when enabled", () => {
            setup();
            const result = renderMessageEvent();
            expect(result.getByRole("combobox", { name: "Knowledge branch" })).toBeVisible();
            expect(result.queryByTestId("textual-body")).not.toBeInTheDocument();
        });

        it("should open the existing textual edit composer for an own interactive event", () => {
            setup();
            vi.spyOn(event, "getSender").mockReturnValue(client.getUserId()!);
            const renderBody = (editState?: EditorStateTransfer) => (
                <MatrixClientContext.Provider value={client}>
                    <MessageEvent mxEvent={event} editState={editState} />
                </MatrixClientContext.Provider>
            );
            const result = render(renderBody());
            expect(result.getByRole("combobox", { name: "Knowledge branch" })).toBeVisible();
            result.rerender(renderBody(new EditorStateTransfer(event)));
            expect(result.getByRole("textbox", { name: "Edit message" })).toHaveValue("Fallback");
            expect(result.queryByRole("combobox", { name: "Knowledge branch" })).not.toBeInTheDocument();
        });

        it.each([EventType.Sticker, "org.example.custom"])(
            "should preserve the native body for event type %s",
            (type) => {
                setup();
                vi.spyOn(event, "getType").mockReturnValue(type);
                if (type === EventType.Sticker) event.getContent().url = "mxc://server/sticker";
                const result = renderMessageEvent();
                expect(result.queryByRole("combobox")).not.toBeInTheDocument();
                expect(result.getByTestId(type === EventType.Sticker ? "sticker-body" : "textual-body")).toBeVisible();
            },
        );

        it.each([MsgType.Image, MsgType.File])(
            "should preserve %s and its caption for invalid or unsupported extensions",
            (msgtype) => {
                for (const version of [1, 2]) {
                    setup();
                    vi.spyOn(event, "getContent").mockReturnValue({
                        msgtype,
                        body: "Image caption",
                        filename: "photo.png",
                        info: { mimetype: "image/png" },
                        url: "mxc://server/image",
                        [INTERACTIVE_UI_KEY]: { ...knowledge, version, root: "missing" },
                    });
                    const result = renderMessageEvent();
                    expect(result.getByTestId(msgtype === MsgType.Image ? "image-body" : "file-body")).toBeVisible();
                    expect(result.getByTestId("textual-body")).toBeVisible();
                    expect(result.queryByText("Couldn’t show interactive content.")).not.toBeInTheDocument();
                    result.unmount();
                }
            },
        );

        it.each(["off", "export", "preview", "inhibited", "redacted", "decryption"])(
            "should preserve normal rendering for %s",
            (mode) => {
                setup(knowledge, mode !== "off");
                if (mode === "redacted") vi.spyOn(event, "isRedacted").mockReturnValue(true);
                if (mode === "decryption") vi.spyOn(event, "isDecryptionFailure").mockReturnValue(true);
                const result = render(
                    <MatrixClientContext.Provider value={client}>
                        <MessageEvent
                            mxEvent={event}
                            forExport={mode === "export"}
                            inhibitInteraction={mode === "inhibited"}
                            overrideBodyTypes={mode === "preview" ? {} : undefined}
                        />
                    </MatrixClientContext.Provider>,
                );
                expect(result.queryByRole("combobox", { name: "Knowledge branch" })).not.toBeInTheDocument();
                if (mode === "decryption") expect(result.getByTestId("decryption-failure-body")).toBeVisible();
                else if (mode === "redacted") expect(result.getByText("Message deleted by Moderator")).toBeVisible();
                else expect(result.getByTestId("textual-body")).toBeVisible();
            },
        );

        it.each([1, 2])(
            "should fall back for invalid/unsupported version %i with the appropriate caption",
            (version) => {
                setup({ ...knowledge, version, root: "missing" });
                const result = renderMessageEvent();
                expect(result.getByTestId("textual-body")).toBeVisible();
                expect(result.queryAllByText("Couldn’t show interactive content.")).toHaveLength(version === 1 ? 1 : 0);
            },
        );
    });

    it("should keep an uncaptioned image visible alongside its edit composer", () => {
        event = mkEvent({
            event: true,
            type: EventType.RoomMessage,
            user: client.getUserId()!,
            room: room.roomId,
            content: {
                msgtype: MsgType.Image,
                body: "photo.png",
                url: "mxc://server/image",
                info: { mimetype: "image/png" },
            },
        });
        const result = render(
            <MatrixClientContext.Provider value={client}>
                <MessageEvent mxEvent={event} editState={new EditorStateTransfer(event)} />
            </MatrixClientContext.Provider>,
        );
        expect(result.getByTestId("image-body")).toBeVisible();
        expect(result.getByRole("textbox", { name: "Edit message" })).toBeVisible();
    });

    describe("when an image with a caption is sent", () => {
        let result: RenderResult;

        function createEvent(mimetype: string, filename: string, msgtype: string) {
            return mkEvent({
                event: true,
                type: EventType.RoomMessage,
                user: client.getUserId()!,
                room: room.roomId,
                content: {
                    body: "caption for a test image",
                    format: "org.matrix.custom.html",
                    formatted_body: "<strong>caption for a test image</strong>",
                    msgtype: msgtype,
                    filename: filename,
                    info: {
                        w: 40,
                        h: 50,
                        mimetype: mimetype,
                    },
                    url: "mxc://server/image",
                },
            });
        }

        function mockMedia() {
            fetchMock.getOnce("https://server/_matrix/media/v3/download/server/image", {
                body: fs.readFileSync(
                    fileURLToPath(import.meta.resolve("../../../../test/unit-tests/images/animated-logo.webp")),
                ),
            });
        }

        it("should render a TextualBody and an ImageBody", () => {
            event = createEvent("image/webp", "image.webp", MsgType.Image);
            result = renderMessageEvent();
            mockMedia();
            expect(result.getByTestId("image-body")).toBeVisible();
            expect(result.getByTestId("textual-body")).toBeVisible();
        });

        it("should render a TextualBody and a FileBody for mismatched extension", () => {
            event = createEvent("image/webp", "image.exe", MsgType.Image);
            result = renderMessageEvent();
            mockMedia();
            expect(result.getByTestId("file-body")).toBeVisible();
            expect(result.getByTestId("textual-body")).toBeVisible();
        });

        it("should render a TextualBody and a video element", () => {
            event = createEvent("video/mp4", "video.mp4", MsgType.Video);
            result = renderMessageEvent();
            mockMedia();
            expect(result.container.querySelector("video")).not.toBeNull();
            result.getByTestId("textual-body");
        });

        it("should render a TextualBody and a FileBody for non-video mimetype", () => {
            event = createEvent("application/octet-stream", "video.mp4", MsgType.Video);
            result = renderMessageEvent();
            mockMedia();
            expect(result.getByTestId("file-body")).toBeVisible();
            expect(result.getByTestId("textual-body")).toBeVisible();
        });
    });
});

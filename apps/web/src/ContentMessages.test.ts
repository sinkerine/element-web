/*
Copyright 2026 Element Creations Ltd.
Copyright 2024 New Vector Ltd.
Copyright 2022 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import "vitest-canvas-mock";
import {
    type ISendEventResponse,
    type MatrixClient,
    MatrixError,
    Room,
    RoomMember,
    HTTPError,
    RelationType,
    type UploadResponse,
} from "matrix-js-sdk/src/matrix";
import { type ImageInfo } from "matrix-js-sdk/src/types";
import encrypt, { type IEncryptedFile } from "matrix-encrypt-attachment";
import { createTestClient, flushPromises, mkEvent } from "test-utils";

import EditorModel from "./editor/model";
import { createPartCreator } from "./editor/__mocks__";
import { PartCreator, Type } from "./editor/parts";
import SettingsStore from "./settings/SettingsStore";
import ContentMessages, { UploadCanceledError, uploadFile } from "./ContentMessages";
import { clearUploadedMediaCache, queryUploadedMediaCache } from "./utils/UploadedMediaCache";
import { doMaybeLocalRoomAction } from "./utils/local-room";
import { BlurhashEncoder } from "./BlurhashEncoder";
import Modal from "./Modal";
import ErrorDialog from "./components/views/dialogs/ErrorDialog";
import { MediaUploadDialog } from "./components/views/dialogs/MediaUploadDialog";
import UploadFailureDialog from "./components/views/dialogs/UploadFailureDialog";
import UploadConfirmDialog from "./components/views/dialogs/UploadConfirmDialog";
import { _t } from "./languageHandler";
import { PosthogAnalytics } from "./PosthogAnalytics";

vi.mock("matrix-encrypt-attachment", () => ({ default: { encryptAttachment: vi.fn().mockResolvedValue({}) } }));

vi.mock("./BlurhashEncoder", () => ({
    BlurhashEncoder: {
        instance: {
            getBlurhash: vi.fn(),
        },
    },
}));

vi.mock("./utils/local-room", () => ({
    doMaybeLocalRoomAction: vi.fn(),
}));

const createElement = document.createElement.bind(document);

vi.stubGlobal("OffscreenCanvas", undefined);

describe("ContentMessages", () => {
    const stickerUrl = "https://example.com/sticker";
    const roomId = "!room:example.com";
    const imageInfo = {} as unknown as ImageInfo;
    const text = "test sticker";
    let client: MatrixClient;
    let contentMessages: ContentMessages;
    let prom: Promise<ISendEventResponse>;

    beforeEach(() => {
        client = createTestClient();
        contentMessages = new ContentMessages();
        prom = Promise.resolve<ISendEventResponse>({ event_id: "$event_id" });
    });

    describe("sendStickerContentToRoom", () => {
        beforeEach(() => {
            vi.mocked(client.sendStickerMessage).mockReturnValue(prom);
            vi.mocked(doMaybeLocalRoomAction).mockImplementation(
                <T>(roomId: string, fn: (actualRoomId: string) => Promise<T>, client?: MatrixClient) => {
                    return fn(roomId);
                },
            );
        });

        it("should forward the call to doMaybeLocalRoomAction", async () => {
            await contentMessages.sendStickerContentToRoom(stickerUrl, roomId, null, imageInfo, text, client);
            expect(client.sendStickerMessage).toHaveBeenCalledWith(roomId, null, stickerUrl, imageInfo, text);
        });
    });

    describe("sendContentToRoom", () => {
        const roomId = "!roomId:server";
        beforeEach(() => {
            Object.defineProperty(global.Image.prototype, "src", {
                // Define the property setter
                configurable: true,
                set(src) {
                    window.setTimeout(() => this.onload());
                },
            });
            Object.defineProperty(global.Image.prototype, "height", {
                configurable: true,
                get() {
                    return 600;
                },
            });
            Object.defineProperty(global.Image.prototype, "width", {
                configurable: true,
                get() {
                    return 800;
                },
            });
            vi.mocked(doMaybeLocalRoomAction).mockImplementation(
                <T>(roomId: string, fn: (actualRoomId: string) => Promise<T>) => fn(roomId),
            );
            vi.mocked(BlurhashEncoder.instance.getBlurhash).mockResolvedValue("blurhashstring");
        });

        it.each([false, true])("sends caption fields and mentions with encrypted=%s", async (encrypted) => {
            const settingsSpy = vi
                .spyOn(SettingsStore, "getValue")
                .mockImplementation((key) => key === "MessageComposerInput.useMarkdown");
            vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
            const cryptoSpy = vi.spyOn(client.getCrypto()!, "isEncryptionEnabledInRoom").mockResolvedValue(encrypted);
            vi.mocked(encrypt.encryptAttachment).mockResolvedValue({
                data: new ArrayBuffer(0),
                info: {} as IEncryptedFile,
            });
            const pc = createPartCreator();
            const member = new RoomMember(roomId, "@bob:server");
            const model = new EditorModel([pc.plain("**hello** "), pc.userPill("Bob", member.userId)], pc);
            const sent = await contentMessages.sendContentToRoom(
                new File(["hi"], "notes.txt"),
                roomId,
                undefined,
                client,
                undefined,
                undefined,
                model,
            );
            expect(sent).toBe(true);
            expect(client.sendMessage).toHaveBeenCalledWith(
                roomId,
                null,
                expect.objectContaining({
                    "filename": "notes.txt",
                    "body": "**hello** Bob",
                    "format": "org.matrix.custom.html",
                    "formatted_body": expect.stringContaining("<strong>hello</strong>"),
                    "m.mentions": { user_ids: [member.userId] },
                    ...(encrypted ? { file: { url: "mxc://server/file" } } : { url: "mxc://server/file" }),
                }),
            );
            settingsSpy.mockRestore();
            cryptoSpy.mockRestore();
        });

        describe("sendGalleryToRoom", () => {
            const files = ["first.webp", "second.webp"].map(
                (name) => new File(["image"], name, { type: "image/webp" }),
            );

            beforeEach(() => {
                vi.mocked(client.getMediaConfig).mockResolvedValue({});
                vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/media" });
            });

            afterEach(() => vi.restoreAllMocks());

            it.each([false, true])(
                "should upload all items and thumbnails with encryption=%s and preserve caption relations",
                async (encrypted) => {
                    vi.spyOn(client.getCrypto()!, "isEncryptionEnabledInRoom").mockResolvedValue(encrypted);
                    vi.mocked(encrypt.encryptAttachment).mockResolvedValue({
                        data: new ArrayBuffer(0),
                        info: {} as IEncryptedFile,
                    });
                    vi.spyOn(SettingsStore, "getValue").mockImplementation(
                        (key) => key === "MessageComposerInput.useMarkdown",
                    );
                    const pc = createPartCreator();
                    const model = new EditorModel([pc.plain("**photos** "), pc.userPill("Bob", "@bob:server")], pc);
                    const reply = mkEvent({
                        event: true,
                        type: "m.room.message",
                        room: roomId,
                        user: "@alice:server",
                        content: { msgtype: "m.text", body: "hi" },
                    });
                    const relation = { rel_type: "m.thread", event_id: "$root" };
                    expect(
                        await contentMessages.sendGalleryToRoom(
                            files,
                            roomId,
                            relation,
                            client,
                            reply,
                            undefined,
                            model,
                        ),
                    ).toBe(true);
                    expect(client.uploadContent).toHaveBeenCalledTimes(4);
                    expect(client.sendMessage).toHaveBeenCalledExactlyOnceWith(
                        roomId,
                        "$root",
                        expect.objectContaining({
                            "msgtype": "dm.filament.gallery",
                            "body": "**photos** Bob",
                            "format": "org.matrix.custom.html",
                            "formatted_body": expect.stringContaining("<strong>photos</strong>"),
                            "m.mentions": { user_ids: ["@alice:server", "@bob:server"] },
                            "m.relates_to": expect.objectContaining({
                                ...relation,
                                "m.in_reply_to": { event_id: reply.getId() },
                            }),
                            "itemtypes": files.map((file) =>
                                expect.objectContaining({
                                    itemtype: "m.image",
                                    body: file.name,
                                    ...(encrypted
                                        ? { file: { url: "mxc://server/media" } }
                                        : { url: "mxc://server/media" }),
                                    info: expect.objectContaining({
                                        size: file.size,
                                        mimetype: file.type,
                                        w: 800,
                                        h: 600,
                                        ...(encrypted
                                            ? { thumbnail_file: { url: "mxc://server/media" } }
                                            : { thumbnail_url: "mxc://server/media" }),
                                    }),
                                }),
                            ),
                        }),
                    );
                    const controllers = vi
                        .mocked(client.uploadContent)
                        .mock.calls.map(([, options]) => options!.abortController);
                    expect(new Set(controllers).size).toBe(1);
                    expect(encrypt.encryptAttachment).toHaveBeenCalledTimes(encrypted ? 4 : 0);
                    expect(contentMessages.getCurrentUploads()).toEqual([]);
                },
            );

            it("should upload video metadata and thumbnail in a mixed gallery", async () => {
                vi.spyOn(document, "createElement").mockImplementation((tagName) => {
                    const element = createElement(tagName);
                    if (tagName === "video") {
                        const video = element as HTMLVideoElement;
                        video.load = vi.fn();
                        video.play = vi.fn(async () => {
                            video.onloadeddata!(new Event("loadeddata"));
                        });
                        video.pause = vi.fn();
                        Object.defineProperties(video, {
                            videoHeight: { value: 600 },
                            videoWidth: { value: 800 },
                            duration: { value: 123 },
                        });
                    }
                    return element;
                });
                const video = new File(["video"], "clip.mp4", { type: "video/mp4" });
                expect(
                    await contentMessages.sendGalleryToRoom([files[0], video], roomId, undefined, client, undefined),
                ).toBe(true);
                expect(client.sendMessage).toHaveBeenCalledWith(
                    roomId,
                    null,
                    expect.objectContaining({
                        itemtypes: [
                            expect.objectContaining({ itemtype: "m.image" }),
                            expect.objectContaining({
                                itemtype: "m.video",
                                body: "clip.mp4",
                                info: expect.objectContaining({
                                    duration: 123000,
                                    thumbnail_url: "mxc://server/media",
                                    mimetype: "video/mp4",
                                }),
                            }),
                        ],
                    }),
                );
            });

            it("should aggregate progress and wait for the previous send", async () => {
                let release!: () => void;
                const previous = new Promise<void>((resolve) => {
                    release = resolve;
                });
                vi.mocked(client.uploadContent).mockImplementation(async (_file, options) => {
                    options?.progressHandler?.({ loaded: 2, total: 5 });
                    return { content_uri: "mxc://server/media" };
                });
                const sent = contentMessages.sendGalleryToRoom(files, roomId, undefined, client, undefined, previous);
                await vi.waitFor(() => expect(client.uploadContent).toHaveBeenCalledTimes(4));
                expect(client.sendMessage).not.toHaveBeenCalled();
                const [upload] = contentMessages.getCurrentUploads();
                expect(upload.total).toBe(10);
                expect(upload.loaded).toBe(7);
                release();
                expect(await sent).toBe(true);
                expect(client.sendMessage).toHaveBeenCalledWith(roomId, null, expect.objectContaining({ body: "" }));
            });

            it("should retain a pending gallery's UploadBar entry when a separate upload finishes", async () => {
                let release!: () => void;
                const previous = new Promise<void>((resolve) => {
                    release = resolve;
                });
                const gallery = contentMessages.sendGalleryToRoom(
                    files,
                    roomId,
                    undefined,
                    client,
                    undefined,
                    previous,
                );
                await vi.waitFor(() => expect(client.uploadContent).toHaveBeenCalledTimes(4));
                const [upload] = contentMessages.getCurrentUploads();
                expect(
                    await contentMessages.sendContentToRoom(
                        new File(["text"], "a.txt"),
                        roomId,
                        undefined,
                        client,
                        undefined,
                    ),
                ).toBe(true);
                expect(contentMessages.getCurrentUploads()).toEqual([upload]);
                release();
                expect(await gallery).toBe(true);
            });

            it.each(["thumbnail", "media", "send", "cancel"])(
                "should send no partial gallery on %s failure",
                async (failure) => {
                    const dialog = vi.spyOn(Modal, "createDialog");
                    if (failure === "send") vi.mocked(client.sendMessage).mockRejectedValue(new Error("send failed"));
                    else {
                        let index = 0;
                        vi.mocked(client.uploadContent).mockImplementation(async () => {
                            index++;
                            if (failure === "cancel")
                                contentMessages.cancelUpload(contentMessages.getCurrentUploads()[0]);
                            if (index === (failure === "media" ? 2 : 1) && failure !== "cancel")
                                throw new HTTPError("failure", 500);
                            return { content_uri: "mxc://server/media" };
                        });
                    }
                    expect(await contentMessages.sendGalleryToRoom(files, roomId, undefined, client, undefined)).toBe(
                        false,
                    );
                    if (failure !== "send") expect(client.sendMessage).not.toHaveBeenCalled();
                    if (failure === "cancel") expect(dialog).not.toHaveBeenCalled();
                    else expect(dialog).toHaveBeenCalledWith(ErrorDialog, expect.anything());
                    expect(contentMessages.getCurrentUploads()).toEqual([]);
                },
            );

            it("should enforce limits before uploading and use the single-media fallback", async () => {
                expect(
                    await contentMessages.sendGalleryToRoom(
                        Array(61).fill(files[0]),
                        roomId,
                        undefined,
                        client,
                        undefined,
                    ),
                ).toBe(false);
                expect(
                    await contentMessages.sendGalleryToRoom(
                        [new File(["text"], "a.txt"), files[0]],
                        roomId,
                        undefined,
                        client,
                        undefined,
                    ),
                ).toBe(false);
                expect(client.uploadContent).not.toHaveBeenCalled();
                const pc = createPartCreator();
                const model = new EditorModel([pc.plain("/literal caption")], pc);
                expect(
                    await contentMessages.sendGalleryToRoom(
                        [files[0]],
                        roomId,
                        undefined,
                        client,
                        undefined,
                        undefined,
                        model,
                    ),
                ).toBe(true);
                expect(client.sendMessage).toHaveBeenCalledWith(
                    roomId,
                    null,
                    expect.objectContaining({
                        msgtype: "m.image",
                        filename: files[0].name,
                        body: "/literal caption",
                    }),
                );
            });

            it("should reject oversized files before uploading any items", async () => {
                vi.mocked(client.getMediaConfig).mockResolvedValue({ "m.upload.size": 1 });
                expect(await contentMessages.sendGalleryToRoom(files, roomId, undefined, client, undefined)).toBe(
                    false,
                );
                expect(client.uploadContent).not.toHaveBeenCalled();
            });
        });

        it("returns false when the captioned upload fails", async () => {
            vi.mocked(client.uploadContent).mockRejectedValue(new HTTPError("failure", 500));
            const pc = createPartCreator();
            expect(
                await contentMessages.sendContentToRoom(
                    new File(["hi"], "notes.txt"),
                    roomId,
                    undefined,
                    client,
                    undefined,
                    undefined,
                    new EditorModel([pc.plain("caption")], pc),
                ),
            ).toBe(false);
        });

        it("returns false when the captioned upload is cancelled", async () => {
            vi.mocked(client.uploadContent).mockImplementation(async () => {
                contentMessages.cancelUpload(contentMessages.getCurrentUploads()[0]);
                return { content_uri: "mxc://server/file" };
            });
            const pc = createPartCreator();
            expect(
                await contentMessages.sendContentToRoom(
                    new File(["hi"], "notes.txt"),
                    roomId,
                    undefined,
                    client,
                    undefined,
                    undefined,
                    new EditorModel([pc.plain("caption")], pc),
                ),
            ).toBe(false);
        });

        it("should use m.image for image files", async () => {
            vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
            const file = new File([], "fileName", { type: "image/jpeg" });
            await contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined);
            expect(client.sendMessage).toHaveBeenCalledWith(
                roomId,
                null,
                expect.objectContaining({
                    url: "mxc://server/file",
                    msgtype: "m.image",
                }),
            );
        });

        it("should use m.image for PNG files which cannot be parsed but successfully thumbnail", async () => {
            vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
            const file = new File([], "fileName", { type: "image/png" });
            await contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined);
            expect(client.sendMessage).toHaveBeenCalledWith(
                roomId,
                null,
                expect.objectContaining({
                    url: "mxc://server/file",
                    msgtype: "m.image",
                }),
            );
        });

        it("should fall back to m.file for invalid image files", async () => {
            vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
            const file = new File([], "fileName", { type: "image/jpeg" });
            vi.mocked(BlurhashEncoder.instance.getBlurhash).mockRejectedValue("NOT_AN_IMAGE");
            await contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined);
            expect(client.sendMessage).toHaveBeenCalledWith(
                roomId,
                null,
                expect.objectContaining({
                    url: "mxc://server/file",
                    msgtype: "m.file",
                }),
            );
        });

        it("should use m.video for video files", async () => {
            vi.spyOn(document, "createElement").mockImplementation((tagName) => {
                const element = createElement(tagName);
                if (tagName === "video") {
                    (<HTMLVideoElement>element).load = vi.fn();
                    (<HTMLVideoElement>element).play = () => element.onloadeddata!(new Event("loadeddata"));
                    (<HTMLVideoElement>element).pause = vi.fn();
                    Object.defineProperty(element, "videoHeight", {
                        get() {
                            return 600;
                        },
                    });
                    Object.defineProperty(element, "videoWidth", {
                        get() {
                            return 800;
                        },
                    });
                    Object.defineProperty(element, "duration", {
                        get() {
                            return 123;
                        },
                    });
                }
                return element;
            });

            vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
            const file = new File([], "fileName", { type: "video/mp4" });
            await contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined);
            expect(client.sendMessage).toHaveBeenCalledWith(
                roomId,
                null,
                expect.objectContaining({
                    url: "mxc://server/file",
                    msgtype: "m.video",
                    info: expect.objectContaining({
                        duration: 123000,
                    }),
                }),
            );
        });

        it("should use m.audio for audio files", async () => {
            vi.spyOn(document, "createElement").mockImplementation((tagName) => {
                const element = createElement(tagName);
                if (tagName === "audio") {
                    Object.defineProperty(element, "duration", {
                        get() {
                            return 621;
                        },
                    });
                    Object.defineProperty(element, "src", {
                        set() {
                            element.onloadedmetadata!(new Event("loadedmetadata"));
                        },
                    });
                }
                return element;
            });

            vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
            const file = new File([], "fileName", { type: "audio/mp3" });
            await contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined);
            expect(client.sendMessage).toHaveBeenCalledWith(
                roomId,
                null,
                expect.objectContaining({
                    url: "mxc://server/file",
                    msgtype: "m.audio",
                    info: expect.objectContaining({
                        duration: 621000,
                    }),
                }),
            );
        });

        it("should fall back to m.file for invalid audio files", async () => {
            vi.spyOn(document, "createElement").mockImplementation((tagName) => {
                const element = createElement(tagName);
                if (tagName === "audio") {
                    Object.defineProperty(element, "src", {
                        set() {
                            element.onerror!("fail");
                        },
                    });
                }
                return element;
            });
            vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
            const file = new File([], "fileName", { type: "audio/mp3" });
            await contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined);
            expect(client.sendMessage).toHaveBeenCalledWith(
                roomId,
                null,
                expect.objectContaining({
                    url: "mxc://server/file",
                    msgtype: "m.file",
                }),
            );
        });

        it("should default to name 'Attachment' if file doesn't have a name", async () => {
            vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
            const file = new File([], "", { type: "text/plain" });
            await contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined);
            expect(client.sendMessage).toHaveBeenCalledWith(
                roomId,
                null,
                expect.objectContaining({
                    url: "mxc://server/file",
                    msgtype: "m.file",
                    body: "Attachment",
                }),
            );
        });

        it("should keep RoomUpload's total and loaded values up to date", async () => {
            vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
            const file = new File([], "", { type: "text/plain" });
            const prom = contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined);
            const [upload] = contentMessages.getCurrentUploads();

            expect(upload.loaded).toBe(0);
            expect(upload.total).toBe(file.size);
            await flushPromises();
            const { progressHandler } = vi.mocked(client.uploadContent).mock.calls[0][1]!;
            progressHandler!({ loaded: 123, total: 1234 });
            expect(upload.loaded).toBe(123);
            expect(upload.total).toBe(1234);
            await prom;
        });

        it("properly handles replies", async () => {
            vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
            const file = new File([], "fileName", { type: "image/jpeg" });
            const replyToEvent = mkEvent({
                type: "m.room.message",
                user: "@bob:test",
                room: roomId,
                content: {},
                event: true,
            });
            await contentMessages.sendContentToRoom(file, roomId, undefined, client, replyToEvent);
            expect(client.sendMessage).toHaveBeenCalledWith(
                roomId,
                null,
                expect.objectContaining({
                    "url": "mxc://server/file",
                    "msgtype": "m.image",
                    "m.mentions": {
                        user_ids: ["@bob:test"],
                    },
                }),
            );
        });

        it("handles 413 error", async () => {
            vi.mocked(client.uploadContent).mockRejectedValue(
                new MatrixError(
                    {
                        errcode: "M_TOO_LARGE",
                        error: "File size limit exceeded",
                    },
                    413,
                ),
            );
            const file = new File([], "fileName", { type: "image/jpeg" });
            const dialogSpy = vi.spyOn(Modal, "createDialog");
            await contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined);
            expect(dialogSpy).toHaveBeenCalledWith(
                ErrorDialog,
                expect.objectContaining({
                    description: _t("upload_failed_size", { fileName: "fileName" }),
                }),
            );
            dialogSpy.mockRestore();
        });
    });

    describe("getCurrentUploads", () => {
        const file1 = new File([], "file1");
        const file2 = new File([], "file2");
        const roomId = "!roomId:server";

        beforeEach(() => {
            vi.mocked(doMaybeLocalRoomAction).mockImplementation(
                <T>(roomId: string, fn: (actualRoomId: string) => Promise<T>) => fn(roomId),
            );
        });

        it("should return only uploads for the given relation", async () => {
            const relation = {
                rel_type: RelationType.Thread,
                event_id: "!threadId:server",
            };
            const p1 = contentMessages.sendContentToRoom(file1, roomId, relation, client, undefined);
            const p2 = contentMessages.sendContentToRoom(file2, roomId, undefined, client, undefined);

            const uploads = contentMessages.getCurrentUploads(relation);
            expect(uploads).toHaveLength(1);
            expect(uploads[0].relation).toEqual(relation);
            expect(uploads[0].fileName).toEqual("file1");
            await Promise.all([p1, p2]);
        });

        it("should return only uploads for no relation when not passed one", async () => {
            const relation = {
                rel_type: RelationType.Thread,
                event_id: "!threadId:server",
            };
            const p1 = contentMessages.sendContentToRoom(file1, roomId, relation, client, undefined);
            const p2 = contentMessages.sendContentToRoom(file2, roomId, undefined, client, undefined);

            const uploads = contentMessages.getCurrentUploads();
            expect(uploads).toHaveLength(1);
            expect(uploads[0].relation).toEqual(undefined);
            expect(uploads[0].fileName).toEqual("file2");
            await Promise.all([p1, p2]);
        });
    });

    describe("cancelUpload", () => {
        it("should cancel in-flight upload", async () => {
            const deferred = Promise.withResolvers<UploadResponse>();
            vi.mocked(client.uploadContent).mockReturnValue(deferred.promise);
            const file1 = new File([], "file1");
            const prom = contentMessages.sendContentToRoom(file1, roomId, undefined, client, undefined);
            await flushPromises();
            const { abortController } = vi.mocked(client.uploadContent).mock.calls[0][1]!;
            expect(abortController!.signal.aborted).toBeFalsy();
            const [upload] = contentMessages.getCurrentUploads();
            contentMessages.cancelUpload(upload);
            expect(abortController!.signal.aborted).toBeTruthy();
            deferred.resolve({} as UploadResponse);
            await prom;
        });
    });
});

describe("uploadFile", () => {
    let client: MatrixClient;

    beforeEach(() => {
        vi.clearAllMocks();
        client = createTestClient();
    });

    it("should not encrypt the file if the room isn't encrypted", async () => {
        vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
        const progressHandler = vi.fn();
        const file = new Blob([]);

        const res = await uploadFile(client, "!roomId:server", file, progressHandler);

        expect(res.url).toBe("mxc://server/file");
        expect(res.file).toBeFalsy();
        expect(encrypt.encryptAttachment).not.toHaveBeenCalled();
        expect(client.uploadContent).toHaveBeenCalledWith(file, expect.objectContaining({ progressHandler }));
    });

    it("should encrypt the file if the room is encrypted", async () => {
        vi.spyOn(client.getCrypto()!, "isEncryptionEnabledInRoom").mockResolvedValue(true);
        vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
        vi.mocked(encrypt.encryptAttachment).mockResolvedValue({
            data: new ArrayBuffer(123),
            info: {} as IEncryptedFile,
        });
        const progressHandler = vi.fn();
        const file = new Blob(["123"]);

        const res = await uploadFile(client, "!roomId:server", file, progressHandler);

        expect(res.url).toBeFalsy();
        expect(res.file).toEqual(
            expect.objectContaining({
                url: "mxc://server/file",
            }),
        );
        expect(encrypt.encryptAttachment).toHaveBeenCalled();
        expect(client.uploadContent).toHaveBeenCalledWith(
            expect.any(Blob),
            expect.objectContaining({
                progressHandler,
                includeFilename: false,
                type: "application/octet-stream",
            }),
        );
        expect(vi.mocked(client.uploadContent).mock.calls[0][0]).not.toBe(file);
    });

    it("should keep the uploaded file so it does not have to be downloaded again", async () => {
        clearUploadedMediaCache();
        vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/plain" });
        const file = new Blob(["hello"]);

        await uploadFile(client, "!roomId:server", file);

        expect(queryUploadedMediaCache("mxc://server/plain")).toBe(file);
    });

    it("should keep the plaintext of an encrypted upload rather than the ciphertext", async () => {
        clearUploadedMediaCache();
        vi.spyOn(client.getCrypto()!, "isEncryptionEnabledInRoom").mockResolvedValue(true);
        vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/encrypted" });
        vi.mocked(encrypt.encryptAttachment).mockResolvedValue({
            data: new ArrayBuffer(123),
            info: {} as IEncryptedFile,
        });
        const file = new Blob(["hello"]);

        await uploadFile(client, "!roomId:server", file);

        expect(queryUploadedMediaCache("mxc://server/encrypted")).toBe(file);
    });

    it("should throw UploadCanceledError upon aborting the upload", async () => {
        vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://foo/bar" });
        const file = new Blob([]);
        const controller = new AbortController();
        controller.abort();

        await expect(uploadFile(client, "!roomId:server", file, undefined, controller)).rejects.toThrow(
            UploadCanceledError,
        );
    });
});

describe("sendContentListToRoom analytics", () => {
    const roomId = "!roomId:server";
    let client: MatrixClient;
    let contentMessages: ContentMessages;
    let trackEvent: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        client = createTestClient();
        vi.mocked(client.getMediaConfig).mockResolvedValue({});
        vi.mocked(doMaybeLocalRoomAction).mockImplementation(
            <T>(roomId: string, fn: (actualRoomId: string) => Promise<T>) => fn(roomId),
        );
        contentMessages = new ContentMessages();
        vi.spyOn(contentMessages, "sendContentToRoom").mockResolvedValue(true);
        trackEvent = vi.spyOn(PosthogAnalytics.instance, "trackEvent").mockImplementation(() => {});
        // Confirm the complete selection as separate events.
        vi.spyOn(Modal, "createDialog").mockImplementation((component: unknown, ...rest: any[]) => {
            if (component === UploadConfirmDialog || component === MediaUploadDialog) {
                return {
                    finished: Promise.resolve([
                        true,
                        component === MediaUploadDialog
                            ? { files: rest[0].files, groupItems: false }
                            : { confirmedFiles: rest[0].files },
                    ]),
                } as any;
            }
            // Any other dialog (e.g. the fetching-media-config spinner) never resolves on its own.
            return { finished: new Promise(() => {}), close: vi.fn() } as any;
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    function mkFile(type: string, name = "file"): File {
        return new File(["content"], name, { type });
    }

    it("tracks AttachmentSend with the most common file type when files are sent", async () => {
        const files = [mkFile("image/png", "a.png"), mkFile("image/jpeg", "b.jpg"), mkFile("video/mp4", "c.mp4")];
        await contentMessages.sendContentListToRoom(files, roomId, undefined, undefined, client);

        expect(trackEvent).toHaveBeenCalledWith(
            expect.objectContaining({
                eventName: "AttachmentSend",
                count: 3,
                kind: "local",
                type: "image",
            }),
        );
    });

    it("marks the attachment as a reply and in-thread when applicable", async () => {
        const replyToEvent = { getId: () => "$event" } as any;
        const relation = { rel_type: "m.thread" } as any;
        await contentMessages.sendContentListToRoom([mkFile("text/plain")], roomId, relation, replyToEvent, client);

        expect(trackEvent).toHaveBeenCalledWith(
            expect.objectContaining({
                eventName: "AttachmentSend",
                isReply: true,
                inThread: true,
            }),
        );
    });

    it("tracks AttachmentCancel when the user cancels at the confirmation dialog", async () => {
        vi.spyOn(Modal, "createDialog").mockImplementation((component: unknown) => {
            if (component === UploadConfirmDialog) {
                return { finished: Promise.resolve([false, false]) } as any;
            }
            return { finished: new Promise(() => {}), close: vi.fn() } as any;
        });

        await contentMessages.sendContentListToRoom([mkFile("text/plain")], roomId, undefined, undefined, client);

        expect(trackEvent).toHaveBeenCalledWith(
            expect.objectContaining({
                eventName: "AttachmentCancel",
                kind: "local",
                stage: "Confirmation",
            }),
        );
        expect(contentMessages.sendContentToRoom).not.toHaveBeenCalled();
    });
});

describe("sendContentListToRoom captions", () => {
    const roomId = "!caption:server";
    let client: MatrixClient;
    let messages: ContentMessages;
    beforeEach(() => {
        client = createTestClient();
        vi.mocked(client.getRoom).mockReturnValue(new Room(roomId, client, client.getSafeUserId()));
        vi.mocked(client.getMediaConfig).mockResolvedValue({});
        vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
        vi.mocked(doMaybeLocalRoomAction).mockImplementation(
            <T>(id: string, fn: (actualRoomId: string) => Promise<T>) => fn(id),
        );
        messages = new ContentMessages();
    });
    afterEach(() => vi.restoreAllMocks());

    it.each([
        { types: ["image/png", "video/mp4"], grouped: true, gallery: true },
        { types: ["image/png", "image/jpeg"], grouped: false, gallery: false },
        { types: ["image/png", "text/plain"], grouped: true, gallery: false },
        { types: ["image/png"], grouped: true, gallery: false },
        { types: ["text/plain"], grouped: false, gallery: false },
    ])("routes the confirmed selection correctly: %j", async ({ types, grouped, gallery }) => {
        const files = types.map((type, index) => new File(["a"], String(index), { type }));
        const gallerySend = vi.spyOn(messages, "sendGalleryToRoom").mockResolvedValue(true);
        const singleSend = vi.spyOn(messages, "sendContentToRoom").mockResolvedValue(true);
        const dialogs: unknown[] = [];
        vi.spyOn(Modal, "createDialog").mockImplementation((component, props) => {
            const selected = (props as { files?: File[] })?.files;
            if (!selected) return { finished: new Promise(() => {}), close: vi.fn() } as any;
            dialogs.push(component);
            if (component === UploadConfirmDialog && types.includes("image/png")) {
                expect((props as { captionModel?: EditorModel }).captionModel).toBeUndefined();
                expect(singleSend).toHaveBeenCalledTimes(1);
            }
            return {
                finished: Promise.resolve([
                    true,
                    component === MediaUploadDialog
                        ? { files: selected, groupItems: grouped }
                        : { confirmedFiles: selected },
                ]),
            } as any;
        });
        const result = await messages.sendContentListToRoom(files, roomId, undefined, undefined, client, undefined, {
            captionDraft: [{ type: Type.Plain, text: "caption" }],
        });
        expect(result.queuedCount).toBe(files.length);
        expect(await result.caption?.sent).toBe(true);
        expect(gallerySend).toHaveBeenCalledTimes(gallery ? 1 : 0);
        expect(singleSend).toHaveBeenCalledTimes(gallery ? 0 : files.length);
        expect(dialogs).toEqual(
            types.includes("text/plain")
                ? types.includes("image/png")
                    ? [MediaUploadDialog, UploadConfirmDialog]
                    : [UploadConfirmDialog]
                : [MediaUploadDialog],
        );
        if (!gallery) {
            const captionCalls = singleSend.mock.calls.filter((call) => call[6]);
            expect(captionCalls).toHaveLength(1);
            expect(captionCalls[0][0]).toBe(
                files[types.includes("text/plain") && types.includes("image/png") ? 0 : files.length - 1],
            );
            if (files.length > 1) expect(await singleSend.mock.calls[1][5]).toBe(true);
        }
    });

    it.each([true, false])(
        "sends the final media selection and exposes failed caption outcomes (grouped=%s)",
        async (groupItems) => {
            const original = new File(["original"], "original.png", { type: "image/png" });
            const kept = new File(["kept"], "kept.png", { type: "image/png" });
            const added = new File(["added original bytes"], "added.mp4", { type: "video/mp4" });
            const gallery = vi.spyOn(messages, "sendGalleryToRoom").mockResolvedValue(false);
            const single = vi.spyOn(messages, "sendContentToRoom").mockResolvedValue(false);
            vi.spyOn(Modal, "createDialog").mockImplementation(
                (component) =>
                    ({
                        finished:
                            component === MediaUploadDialog
                                ? Promise.resolve([true, { files: [kept, added], groupItems }])
                                : new Promise(() => {}),
                        close: vi.fn(),
                    }) as any,
            );
            const result = await messages.sendContentListToRoom(
                [original, kept],
                roomId,
                undefined,
                undefined,
                client,
                undefined,
                {
                    captionDraft: [{ type: Type.Plain, text: "caption to restore" }],
                },
            );
            expect(result.queuedCount).toBe(2);
            expect(result.caption?.parts).toEqual([{ type: Type.Plain, text: "caption to restore" }]);
            expect(await result.caption?.sent).toBe(false);
            if (groupItems) {
                expect(gallery.mock.calls[0][0]).toEqual([kept, added]);
                expect(single).not.toHaveBeenCalled();
            } else {
                expect(single.mock.calls.map((call) => call[0])).toEqual([kept, added]);
                expect(gallery).not.toHaveBeenCalled();
            }
        },
    );

    it("chains a mixed selection's legacy send after the pending gallery send", async () => {
        const media = [
            new File(["a"], "a.png", { type: "image/png" }),
            new File(["b"], "b.mp4", { type: "video/mp4" }),
        ];
        const document = new File(["c"], "c.txt", { type: "text/plain" });
        let finish!: (success: boolean) => void;
        vi.spyOn(messages, "sendGalleryToRoom").mockImplementation(
            () =>
                new Promise((resolve) => {
                    finish = resolve;
                }),
        );
        let previous: Promise<unknown> | undefined;
        const single = vi
            .spyOn(messages, "sendContentToRoom")
            .mockImplementation(async (_file, _room, _relation, _client, _reply, before) => {
                previous = before;
                await before;
                return true;
            });
        vi.spyOn(Modal, "createDialog").mockImplementation(
            (component, props) =>
                ({
                    finished:
                        component === MediaUploadDialog
                            ? Promise.resolve([true, { files: media, groupItems: true }])
                            : component === UploadConfirmDialog
                              ? Promise.resolve([true, { confirmedFiles: (props as { files: File[] }).files }])
                              : new Promise(() => {}),
                    close: vi.fn(),
                }) as any,
        );
        const result = await messages.sendContentListToRoom([document, ...media], roomId, undefined, undefined, client);
        expect(result.queuedCount).toBe(3);
        expect(single.mock.calls[0][0]).toBe(document);
        expect(previous).toBeInstanceOf(Promise);
        const completed = vi.fn();
        void previous!.then(completed);
        await Promise.resolve();
        expect(completed).not.toHaveBeenCalled();
        finish(true);
        await single.mock.results[0].value;
        expect(completed).toHaveBeenCalledOnce();
    });

    it.each([true, false])("handles cancelling the media selection (continue legacy=%s)", async (hasOther) => {
        const files = [new File(["a"], "a.png", { type: "image/png" })];
        if (hasOther) files.push(new File(["b"], "b.txt", { type: "text/plain" }));
        const track = vi.spyOn(PosthogAnalytics.instance, "trackEvent").mockImplementation(() => {});
        const send = vi.spyOn(messages, "sendContentToRoom").mockResolvedValue(true);
        vi.spyOn(Modal, "createDialog").mockImplementation(
            (component, props) =>
                ({
                    finished:
                        component === MediaUploadDialog
                            ? Promise.resolve([false])
                            : component === UploadConfirmDialog
                              ? Promise.resolve([true, { confirmedFiles: (props as { files: File[] }).files }])
                              : new Promise(() => {}),
                    close: vi.fn(),
                }) as any,
        );
        const result = await messages.sendContentListToRoom(files, roomId, undefined, undefined, client, undefined, {
            captionDraft: [{ type: Type.Plain, text: "draft" }],
        });
        expect(result).toEqual({ queuedCount: hasOther ? 1 : 0 });
        expect(send).toHaveBeenCalledTimes(hasOther ? 1 : 0);
        expect(track).toHaveBeenCalledWith(
            expect.objectContaining({ eventName: hasOther ? "AttachmentSend" : "AttachmentCancel" }),
        );
        if (hasOther) expect(send.mock.calls[0][6]).toBeUndefined();
    });

    it.each([true, false])("checks initial size before the media dialog (continue=%s)", async (proceed) => {
        const good = new File(["a"], "a.png", { type: "image/png" });
        const bad = new File(["too large"], "bad.png", { type: "image/png" });
        vi.spyOn(messages, "isFileSizeAcceptable").mockImplementation((file) => file === good);
        vi.spyOn(messages, "sendContentToRoom").mockResolvedValue(true);
        const dialogs: unknown[] = [];
        vi.spyOn(Modal, "createDialog").mockImplementation((component, props) => {
            if (component === UploadFailureDialog) {
                dialogs.push(component);
                expect(props).toMatchObject({ badFiles: [bad], totalFiles: 2 });
                return { finished: Promise.resolve([proceed]) } as any;
            }
            if (component === MediaUploadDialog) {
                dialogs.push(component);
                expect(props).toMatchObject({ files: [good] });
                return { finished: Promise.resolve([true, { files: [good], groupItems: false }]) } as any;
            }
            return { finished: new Promise(() => {}), close: vi.fn() } as any;
        });
        expect(await messages.sendContentListToRoom([good, bad], roomId, undefined, undefined, client)).toEqual({
            queuedCount: proceed ? 1 : 0,
        });
        expect(dialogs).toEqual(proceed ? [UploadFailureDialog, MediaUploadDialog] : [UploadFailureDialog]);
    });

    it("defensively rejects an overflowing confirmed gallery", async () => {
        const files = Array.from({ length: 61 }, (_, i) => new File(["a"], `${i}.png`, { type: "image/png" }));
        const send = vi.spyOn(messages, "sendGalleryToRoom").mockResolvedValue(true);
        const dialog = vi.spyOn(Modal, "createDialog").mockImplementation(
            (component) =>
                ({
                    finished:
                        component === MediaUploadDialog
                            ? Promise.resolve([true, { files, groupItems: true }])
                            : new Promise(() => {}),
                    close: vi.fn(),
                }) as any,
        );
        expect(await messages.sendContentListToRoom(files, roomId, undefined, undefined, client)).toEqual({
            queuedCount: 0,
        });
        expect(send).not.toHaveBeenCalled();
        expect(dialog).toHaveBeenCalledWith(ErrorDialog, expect.anything());
    });

    it.each([
        { count: 1, cancelAt: -1, all: false, queued: 1 },
        { count: 3, cancelAt: -1, all: false, queued: 3 },
        { count: 3, cancelAt: 2, all: false, queued: 2 },
        { count: 3, cancelAt: -1, all: true, queued: 3 },
        { count: 3, cancelAt: 0, all: false, queued: 0 },
    ])("puts the shared caption on the last confirmed file: %j", async ({ count, cancelAt, all, queued }) => {
        let sharedModel: EditorModel | undefined;
        vi.spyOn(Modal, "createDialog").mockImplementation((component, props) => {
            if (component !== UploadConfirmDialog) {
                return { finished: new Promise(() => {}), close: vi.fn() } as any;
            }
            // No uploads start during any of the confirmation steps.
            expect(client.uploadContent).not.toHaveBeenCalled();
            const { captionModel } = props as { captionModel: EditorModel };
            if (sharedModel) expect(captionModel).toBe(sharedModel);
            sharedModel = captionModel;
            const files = (props as { files: File[] }).files;
            return {
                finished: Promise.resolve([
                    cancelAt !== 0,
                    {
                        confirmedFiles: cancelAt > 0 ? files.slice(0, cancelAt) : files,
                        sendAsGallery: all,
                    },
                ]),
            } as any;
        });
        const result = await messages.sendContentListToRoom(
            Array.from({ length: count }, (_, i) => new File(["hi"], `${i}.txt`)),
            roomId,
            undefined,
            undefined,
            client,
            undefined,
            { captionDraft: [{ type: Type.Plain, text: "/caption" }] },
        );
        expect(result.queuedCount).toBe(queued);
        if (!queued) {
            expect(result.caption).toBeUndefined();
            return;
        }
        expect(await result.caption?.sent).toBe(true);
        const contents = vi.mocked(client.sendMessage).mock.calls.map((call) => call[2]);
        expect(contents).toHaveLength(queued);
        contents.forEach((content, i) => {
            expect(content.body).toBe(i === queued - 1 ? "/caption" : `${i}.txt`);
            expect("filename" in content ? content.filename : undefined).toBe(
                i === queued - 1 ? `${i}.txt` : undefined,
            );
        });
    });

    it.each(["", "   "])("omits caption fields for blank text %j", async (text) => {
        const room = client.getRoom(roomId)!;
        const pc = new PartCreator(room, client);
        const model = new EditorModel([pc.plain(text)], pc);
        expect(
            await messages.sendContentToRoom(
                new File(["hi"], "a.txt"),
                roomId,
                undefined,
                client,
                undefined,
                undefined,
                model,
            ),
        ).toBe(true);
        expect(client.sendMessage).toHaveBeenCalledWith(
            roomId,
            null,
            expect.not.objectContaining({ filename: expect.anything() }),
        );
    });

    it.each([true, false])(
        "queues without a caption when the field is emptied or room missing (room=%s)",
        async (hasRoom) => {
            if (!hasRoom) vi.mocked(client.getRoom).mockReturnValue(null);
            vi.spyOn(Modal, "createDialog").mockImplementation((component, props) => {
                if (component !== UploadConfirmDialog)
                    return { finished: new Promise(() => {}), close: vi.fn() } as any;
                const { room, captionModel } = props as { room?: Room; captionModel?: EditorModel };
                if (hasRoom) captionModel!.reset([]);
                else {
                    expect(room).toBeUndefined();
                    expect(captionModel).toBeUndefined();
                }
                return {
                    finished: Promise.resolve([
                        true,
                        { confirmedFiles: (props as { files: File[] }).files, sendAsGallery: false },
                    ]),
                } as any;
            });
            const send = vi.spyOn(messages, "sendContentToRoom");
            const result = await messages.sendContentListToRoom(
                [new File(["hi"], "a.txt")],
                roomId,
                undefined,
                undefined,
                client,
                undefined,
                { captionDraft: [{ type: Type.Plain, text: "caption" }] },
            );
            expect(result).toEqual({ queuedCount: 1 });
            await send.mock.results[0].value;
            expect(client.sendMessage).toHaveBeenCalledWith(roomId, null, expect.objectContaining({ body: "a.txt" }));
        },
    );

    it("exposes a false caption outcome on HTTP failure", async () => {
        vi.spyOn(Modal, "createDialog").mockImplementation(
            (component, props) =>
                ({
                    finished:
                        component === UploadConfirmDialog
                            ? Promise.resolve([
                                  true,
                                  { confirmedFiles: (props as { files: File[] }).files, sendAsGallery: false },
                              ])
                            : new Promise(() => {}),
                    close: vi.fn(),
                }) as any,
        );
        vi.mocked(client.uploadContent).mockRejectedValue(new HTTPError("failure", 500));
        const result = await messages.sendContentListToRoom(
            [new File(["hi"], "a.txt")],
            roomId,
            undefined,
            undefined,
            client,
            undefined,
            { captionDraft: [{ type: Type.Plain, text: "caption" }] },
        );
        expect(result.queuedCount).toBe(1);
        expect(await result.caption?.sent).toBe(false);
    });
});

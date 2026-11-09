/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

// @vitest-environment happy-dom

import React, { useCallback, useRef, useState } from "react";
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "test-utils-rtl";
import { initOnce, plainToRich, richToPlain } from "@vector-im/matrix-wysiwyg";
import type { IContent } from "matrix-js-sdk/src/matrix";

import SendWysiwygComposer from "./SendWysiwygComposer";
import { createMocks } from "./__mocks__";
import MatrixClientContext from "../../../../contexts/MatrixClientContext";
import { ScopedRoomContextProvider } from "../../../../contexts/ScopedRoomContext";
import { TimelineRenderingType } from "../../../../contexts/RoomContext";
import { RoomUploadContext, RoomUploadViewModel } from "../../../../viewmodels/room/RoomUploadViewModel";
import ContentMessages from "../../../../ContentMessages";
import SettingsStore from "../../../../settings/SettingsStore";
import EditorModel from "../../../../editor/model";
import { createMediaCaptionFields } from "../../../../utils/MediaCaption";
import defaultDispatcher from "../../../../dispatcher/dispatcher";
import { Action } from "../../../../dispatcher/actions";
import { attachMentions } from "../../../../utils/messages";
import { aboveLeftOf } from "../../../structures/ContextMenu";
import { PartCreator, type SerializedPart, Type } from "../../../../editor/parts";

// Model the parent draft lifecycle, including its normal send and formatting toggle callbacks.
function DraftComposer({
    rich,
    timeline,
    onTextSend,
}: {
    rich: boolean;
    timeline: TimelineRenderingType;
    onTextSend: (text: string) => void;
}): React.JSX.Element {
    const [initialContent, setInitialContent] = useState("");
    const [mode, setMode] = useState(rich);
    const draft = useRef("");
    const onChange = useCallback((value: string) => {
        draft.current = value;
    }, []);
    const sendText = (): void => {
        onTextSend(draft.current);
        setInitialContent("");
        defaultDispatcher.dispatch(
            {
                action: Action.ClearAndFocusSendMessageComposer,
                timelineRenderingType: timeline,
            },
            true,
        );
        draft.current = "";
    };
    return (
        <>
            <SendWysiwygComposer
                initialContent={initialContent}
                isRichTextEnabled={mode}
                onChange={onChange}
                onSend={sendText}
                onCaptionDraftChange={(value) => {
                    onChange(value);
                    setInitialContent(value);
                }}
                menuPosition={aboveLeftOf({ top: 0, bottom: 0, right: 0 })}
            />
            <button onClick={sendText}>Send text</button>
            <button
                onClick={async () => {
                    const converted = mode
                        ? await richToPlain(draft.current, false)
                        : await plainToRich(draft.current, false);
                    setInitialContent(converted);
                    setMode(!mode);
                }}
            >
                Toggle editor
            </button>
        </>
    );
}

beforeAll(initOnce, 10000);

const modes = [
    { rich: true, timeline: TimelineRenderingType.Room },
    { rich: false, timeline: TimelineRenderingType.Room },
    { rich: true, timeline: TimelineRenderingType.Thread },
    { rich: false, timeline: TimelineRenderingType.Thread },
];

describe.each(modes)("SendWysiwygComposer caption drafts ($rich, $timeline)", ({ rich, timeline }) => {
    const { defaultRoomContext, mockClient } = createMocks();
    const room = defaultRoomContext.room!;
    const relation =
        timeline === TimelineRenderingType.Thread ? { rel_type: "m.thread", event_id: "$thread" } : undefined;
    let vm: RoomUploadViewModel;
    let send: MockInstance<ContentMessages["sendContentListToRoom"]>;
    const onChange = vi.fn();
    const onCaptionDraftChange = vi.fn();
    const files = [new File(["image"], "image.png", { type: "image/png" })];

    beforeEach(() => {
        sessionStorage.clear();
        vm = new RoomUploadViewModel(room, mockClient, timeline, defaultDispatcher, undefined, relation, vi.fn());
        send = vi.spyOn(ContentMessages.sharedInstance(), "sendContentListToRoom");
        send.mockResolvedValue({ queuedCount: 0 });
    });

    afterEach(() => {
        vm.dispose();
        vi.restoreAllMocks();
        vi.clearAllMocks();
    });

    const withContext = (composer: React.ReactNode, threadId = relation?.event_id) => (
        <MatrixClientContext.Provider value={mockClient}>
            <ScopedRoomContextProvider {...defaultRoomContext} timelineRenderingType={timeline} threadId={threadId}>
                <RoomUploadContext.Provider value={vm}>{composer}</RoomUploadContext.Provider>
            </ScopedRoomContextProvider>
        </MatrixClientContext.Provider>
    );
    const composerTree = (initialContent = "caption", mode = rich, threadId = relation?.event_id) => (
        <MatrixClientContext.Provider value={mockClient}>
            <ScopedRoomContextProvider {...defaultRoomContext} timelineRenderingType={timeline} threadId={threadId}>
                <RoomUploadContext.Provider value={vm}>
                    <SendWysiwygComposer
                        initialContent={initialContent}
                        isRichTextEnabled={mode}
                        onChange={onChange}
                        onCaptionDraftChange={onCaptionDraftChange}
                        onSend={vi.fn()}
                        menuPosition={aboveLeftOf({ top: 0, bottom: 0, right: 0 })}
                        eventRelation={relation}
                    />
                </RoomUploadContext.Provider>
            </ScopedRoomContextProvider>
        </MatrixClientContext.Provider>
    );
    const mount = async (initialContent = "caption") => {
        const result = render(composerTree(initialContent));
        await waitFor(() => expect(screen.getByRole("textbox")).toHaveAttribute("contenteditable", "true"));
        return result;
    };

    const upload = async (): Promise<void> => {
        await act(async () => vm.initiateViaInputFiles(files));
    };

    const seed = (): SerializedPart[] | undefined => send.mock.lastCall?.[6]?.captionDraft;

    it("should seed formatting and mention identity without sending a text message", async () => {
        await mount(
            `hello ${rich ? "<strong>bold</strong>" : "**bold**"} <a href="https://matrix.to/#/@bob:example.org" data-mention-type="user" contenteditable="false">Bob</a>`,
        );
        await upload();
        expect(seed()).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ type: Type.UserPill, resourceId: "@bob:example.org", text: "Bob" }),
            ]),
        );
        expect(
            seed()
                ?.map((part) => part.text)
                .join(""),
        ).toContain("**bold**");
        expect(mockClient.sendMessage).not.toHaveBeenCalled();
        expect(onCaptionDraftChange).not.toHaveBeenCalled();
    });

    it.each([0, 1])(
        "should preserve the editor on cancellation or an empty caption (queued=%s)",
        async (queuedCount) => {
            await mount();
            send.mockResolvedValue({ queuedCount });
            await upload();
            expect(screen.getByRole("textbox")).toHaveTextContent("caption");
            expect(onCaptionDraftChange).not.toHaveBeenCalled();
            expect(sessionStorage.length).toBe(0);
        },
    );

    it("should clear the editor and undo history, save send history, and restore a failed caption", async () => {
        await mount();
        let finish!: (success: boolean) => void;
        const parts: SerializedPart[] = [
            { type: Type.Plain, text: "**changed** " },
            { type: Type.UserPill, text: "Bob", resourceId: "@bob:example.org" },
        ];
        send.mockResolvedValue({
            queuedCount: 1,
            caption: {
                parts,
                sent: new Promise((resolve) => {
                    finish = resolve;
                }),
            },
        });
        await upload();
        await waitFor(() => expect(screen.getByRole("textbox")).toHaveTextContent(/^$/));
        expect(onCaptionDraftChange).toHaveBeenLastCalledWith("");
        const saved = JSON.parse(sessionStorage.getItem(`mx_cider_history_${room.roomId}[0]`)!);
        expect(saved.parts.map((part: SerializedPart) => part.text).join("")).toBe("caption");
        await waitFor(() => expect(screen.getByRole("textbox")).toHaveAttribute("contenteditable", "true"));
        fireEvent.input(screen.getByRole("textbox"), { inputType: "historyUndo" });
        expect(screen.getByRole("textbox")).toHaveTextContent(/^$/);

        await act(async () => finish(false));
        await waitFor(() =>
            expect(screen.getByRole("textbox")).toHaveTextContent(rich ? "changed Bob" : "**changed** Bob"),
        );
        if (rich) expect(screen.getByRole("textbox").querySelector("strong")).toHaveTextContent("changed");
        expect(screen.getByRole("textbox").querySelector("a")).toHaveAttribute(
            "href",
            "https://matrix.to/#/@bob:example.org",
        );
        await upload();
        expect(seed()).toEqual(
            expect.arrayContaining([expect.objectContaining({ type: Type.UserPill, resourceId: "@bob:example.org" })]),
        );
    });

    it("should keep newer typing when an upload fails", async () => {
        await mount();
        let finish!: (success: boolean) => void;
        send.mockResolvedValue({
            queuedCount: 1,
            caption: {
                parts: [{ type: Type.Plain, text: "failed caption" }],
                sent: new Promise((resolve) => {
                    finish = resolve;
                }),
            },
        });
        await upload();
        await waitFor(() => expect(screen.getByRole("textbox")).toHaveAttribute("contenteditable", "true"));
        const editor = screen.getByRole("textbox");
        editor.innerHTML = "new typing";
        fireEvent.input(editor, { data: "new typing", inputType: "insertText" });
        await waitFor(() => expect(onChange).toHaveBeenLastCalledWith("new typing"));
        await act(async () => finish(false));
        expect(screen.getByRole("textbox")).toHaveTextContent("new typing");
        expect(onCaptionDraftChange).toHaveBeenCalledTimes(1);
    });

    it("should ignore slash command drafts", async () => {
        await mount("/invite @bob:example.org");
        await upload();
        expect(seed()).toBeUndefined();
        expect(screen.getByRole("textbox")).toHaveTextContent("/invite @bob:example.org");
    });

    it("should preserve rich formatting and keep plain text literal with Markdown disabled", async () => {
        const getValue = SettingsStore.getValue.bind(SettingsStore);
        vi.spyOn(SettingsStore, "getValue").mockImplementation((name, ...args) =>
            name === "MessageComposerInput.useMarkdown" ? false : getValue(name, ...args),
        );
        await mount(
            `${rich ? '<strong>bold</strong> <a href="https://example.org">link</a>' : "**bold** [link](https://example.org)"} <a href="https://matrix.to/#/@bob:example.org" data-mention-type="user" contenteditable="false">Bob</a>`,
        );
        await upload();
        const model = new EditorModel([], new PartCreator(room, mockClient));
        model.reset(seed()!);
        const policy = send.mock.lastCall?.[6]?.captionUseMarkdown;
        expect(policy).toBe(rich ? true : undefined);
        const caption = createMediaCaptionFields(model, policy)!;
        if (rich) {
            expect(caption.formatted_body).toContain("<strong>bold</strong>");
            expect(caption.formatted_body).toContain('<a href="https://example.org">link</a>');
            expect(caption.formatted_body).toContain("https://matrix.to/#/@bob:example.org");
        } else {
            expect(caption.formatted_body).toBe("**bold** [link](https://example.org) Bob");
        }
    });

    it("should use the latest editor mode and content after toggling formatting", async () => {
        const result = await mount("original");
        result.rerender(composerTree(!rich ? "<strong>changed</strong>" : "**changed**", !rich));
        await waitFor(() => expect(screen.getByRole("textbox")).toHaveTextContent(!rich ? "changed" : "**changed**"));
        await upload();
        expect(
            seed()
                ?.map((part) => part.text)
                .join(""),
        ).toBe("**changed**");
        expect(send.mock.lastCall?.[6]?.captionUseMarkdown).toBe(!rich ? true : undefined);
    });

    it("should ignore callbacks captured before the thread changes", async () => {
        const result = await mount();
        let confirm!: (value: Awaited<ReturnType<ContentMessages["sendContentListToRoom"]>>) => void;
        send.mockReturnValue(
            new Promise((resolve) => {
                confirm = resolve;
            }),
        );
        let pending!: Promise<void>;
        act(() => {
            pending = vm.initiateViaInputFiles(files);
        });
        vm.setThreadRelation({ rel_type: "m.thread", event_id: "$other" });
        result.rerender(composerTree("another thread", rich, "$other"));
        await act(async () => {
            confirm({
                queuedCount: 1,
                caption: { parts: [{ type: Type.Plain, text: "old caption" }], sent: Promise.resolve(false) },
            });
            await pending;
        });
        expect(screen.getByRole("textbox")).toHaveTextContent("another thread");
        expect(onCaptionDraftChange).not.toHaveBeenCalled();
    });

    const typeDraft = async (text: string): Promise<void> => {
        await waitFor(() => {
            expect(screen.getByRole("textbox")).toHaveAttribute("contenteditable", "true");
            expect(screen.getByRole("textbox")).toHaveFocus();
        });
        const editor = screen.getByRole("textbox");
        editor.innerHTML = text;
        fireEvent.input(editor, { data: text, inputType: "insertText" });
        await waitFor(() => expect(editor).toHaveTextContent(text));
    };

    it("should offer no draft after a normal text send from the editor", async () => {
        const onTextSend = vi.fn();
        render(withContext(<DraftComposer rich={rich} timeline={timeline} onTextSend={onTextSend} />));
        await typeDraft("already sent");
        fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", code: "Enter" });
        expect(onTextSend).toHaveBeenCalledWith("already sent");
        await waitFor(() => expect(screen.getByRole("textbox")).toHaveTextContent(/^$/));
        await upload();
        expect(seed()).toBeUndefined();
    });

    it("should offer no draft after a dispatched clear", async () => {
        await mount();
        act(() =>
            defaultDispatcher.dispatch(
                {
                    action: Action.ClearAndFocusSendMessageComposer,
                    timelineRenderingType: timeline,
                },
                true,
            ),
        );
        await waitFor(() => expect(screen.getByRole("textbox")).toHaveTextContent(/^$/));
        await upload();
        expect(seed()).toBeUndefined();
    });

    it("should keep a normally sent restored caption empty through formatting toggles", async () => {
        const onTextSend = vi.fn();
        render(withContext(<DraftComposer rich={rich} timeline={timeline} onTextSend={onTextSend} />));
        await typeDraft("caption draft");
        send.mockResolvedValueOnce({
            queuedCount: 1,
            caption: {
                parts: [{ type: Type.Plain, text: "failed caption" }],
                sent: Promise.resolve(false),
            },
        });
        await upload();
        await waitFor(() => expect(screen.getByRole("textbox")).toHaveTextContent("failed caption"));
        fireEvent.click(screen.getByRole("button", { name: "Send text" }));
        expect(onTextSend).toHaveBeenCalledWith("failed caption");
        await waitFor(() => expect(screen.getByRole("textbox")).toHaveTextContent(/^$/));
        for (let index = 0; index < 2; index++) {
            await act(async () => {
                fireEvent.click(screen.getByRole("button", { name: "Toggle editor" }));
            });
            await waitFor(() => expect(screen.getByRole("textbox")).toHaveAttribute("contenteditable", "true"));
            expect(screen.getByRole("textbox")).toHaveTextContent(/^$/);
        }
        await upload();
        expect(seed()).toBeUndefined();
    });

    it("should restore a failed upload after newer text has been sent normally", async () => {
        const onTextSend = vi.fn();
        render(withContext(<DraftComposer rich={rich} timeline={timeline} onTextSend={onTextSend} />));
        await typeDraft("caption draft");
        let finish!: (success: boolean) => void;
        send.mockResolvedValueOnce({
            queuedCount: 1,
            caption: {
                parts: [{ type: Type.Plain, text: "failed caption" }],
                sent: new Promise((resolve) => {
                    finish = resolve;
                }),
            },
        });
        await upload();
        await typeDraft("newer text");
        fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", code: "Enter" });
        expect(onTextSend).toHaveBeenCalledWith("newer text");
        await waitFor(() => expect(screen.getByRole("textbox")).toHaveTextContent(/^$/));
        await act(async () => finish(false));
        await waitFor(() => expect(screen.getByRole("textbox")).toHaveTextContent("failed caption"));
    });

    it("should supersede a reset permanently when the parent initial content changes", async () => {
        const result = await mount("first");
        send.mockResolvedValueOnce({
            queuedCount: 1,
            caption: {
                parts: [{ type: Type.Plain, text: "restored" }],
                sent: Promise.resolve(false),
            },
        });
        await upload();
        await waitFor(() => expect(screen.getByRole("textbox")).toHaveTextContent("restored"));
        result.rerender(composerTree("second"));
        await waitFor(() => expect(screen.getByRole("textbox")).toHaveTextContent("second"));
        result.rerender(composerTree("first"));
        await waitFor(() => expect(screen.getByRole("textbox")).toHaveTextContent("first"));
        await upload();
        expect(
            seed()
                ?.map((part) => part.text)
                .join(""),
        ).toBe("first");
    });

    it.each([true, false])(
        "should round-trip at-room and other pills with structured line breaks (href=%s)",
        async (hasHref) => {
            const newline = rich ? "<br>" : "\n";
            const html = `line1${newline}line2${newline}<a href="https://matrix.to/#/@bob:example.org" data-mention-type="user" contenteditable="false">Bob</a>${newline}<a href="https://matrix.to/#/#room:example.org" data-mention-type="room" contenteditable="false">#room:example.org</a>${newline}<a ${hasHref ? 'href="#"' : ""} data-mention-type="at-room" contenteditable="false">@room</a>${newline}`;
            await mount(html);
            await upload();
            const parts = seed()!;
            const expected: SerializedPart[] = [
                { type: Type.Plain, text: "line1" },
                { type: Type.Newline, text: "\n" },
                { type: Type.Plain, text: "line2" },
                { type: Type.Newline, text: "\n" },
                { type: Type.UserPill, text: "Bob", resourceId: "@bob:example.org" },
                { type: Type.Newline, text: "\n" },
                { type: Type.RoomPill, text: "#room:example.org", resourceId: "#room:example.org" },
                { type: Type.Newline, text: "\n" },
                { type: Type.AtRoomPill, text: "@room" },
                { type: Type.Newline, text: "\n" },
            ];
            expect(parts).toEqual(expected);
            const model = new EditorModel([], new PartCreator(room, mockClient));
            model.reset(parts);
            const content: IContent = {};
            attachMentions(mockClient.getSafeUserId(), content, model, undefined);
            expect(content["m.mentions"]).toEqual({ room: true, user_ids: ["@bob:example.org"] });
            for (let index = 0; index < 2; index++) {
                send.mockResolvedValueOnce({ queuedCount: 1, caption: { parts, sent: Promise.resolve(false) } });
                await upload();
                await waitFor(() => expect(screen.getByRole("textbox")).toHaveTextContent("@room"));
                const atRoom = screen.getByRole("textbox").querySelector('a[data-mention-type="at-room"]');
                expect(atRoom).toHaveAttribute("href", "#");
                expect(atRoom).toHaveAttribute("contenteditable", "false");
                await upload();
                expect(seed()).toEqual(expected);
            }
        },
    );

    it("should preserve literal Markdown and blank/trailing lines through repeated restoration", async () => {
        const newline = rich ? "<br>" : "\n";
        await mount(`literal **stars**${newline}${newline}last${newline}${newline}`);
        await upload();
        const parts = seed()!;
        expect(parts.filter((part) => part.type === Type.Newline)).toHaveLength(4);
        expect(parts.map((part) => part.text).join("")).toBe(
            rich ? "literal \\*\\*stars\\*\\*\n\nlast\n\n" : "literal **stars**\n\nlast\n\n",
        );
        for (let index = 0; index < 2; index++) {
            send.mockResolvedValueOnce({ queuedCount: 1, caption: { parts, sent: Promise.resolve(false) } });
            await upload();
            await waitFor(() => expect(screen.getByRole("textbox")).toHaveTextContent("literal **stars**"));
            await upload();
            expect(seed()).toEqual(parts);
        }
    });

    it("should unregister on unmount", async () => {
        const result = await mount();
        result.unmount();
        await upload();
        expect(seed()).toBeUndefined();
    });
});

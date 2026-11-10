/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { fireEvent, render, waitFor } from "test-utils-rtl";
import userEvent from "@testing-library/user-event";
import { vi, describe, it, expect, afterEach } from "vitest";

import { createTestClient } from "test-utils";
import { Room } from "matrix-js-sdk/src/matrix";
import type AutocompleteWrapperModel from "../../../editor/autocomplete";
import EditorModel from "../../../editor/model";
import { PartCreator } from "../../../editor/parts";
import { SDKContext } from "../../../contexts/SDKContext";
import { SDKContextClass } from "../../../contexts/SDKContextClass";
import { MediaUploadDialog } from "./MediaUploadDialog";

describe("MediaUploadDialog", () => {
    afterEach(() => vi.restoreAllMocks());
    it.each(["pasted", ""])("should append typing after initially focusing caption %j in a modal", async (draft) => {
        const user = userEvent.setup();
        const client = createTestClient();
        const room = new Room("!room:server", client, client.getSafeUserId());
        const pc = new PartCreator(room, client);
        const captionModel = new EditorModel(draft ? [pc.plain(draft)] : [], pc);

        // Chromium moves the selection into a newly focused contenteditable. Happy-dom leaves it
        // in the previous editor, hiding FocusLock's deferred focus restoration in StrictMode.
        const onFocusIn = (event: FocusEvent): void => {
            const target = event.target;
            const selection = document.getSelection()!;
            if (
                target instanceof HTMLElement &&
                target.getAttribute("contenteditable") === "true" &&
                !target.contains(selection.anchorNode)
            ) {
                const range = document.createRange();
                range.selectNodeContents(target);
                range.collapse(true);
                selection.removeAllRanges();
                selection.addRange(range);
            }
        };
        document.addEventListener("focusin", onFocusIn);
        try {
            const original = render(<div contentEditable tabIndex={0} aria-label="Message" role="textbox" />);
            original.getByRole("textbox", { name: "Message" }).focus();
            const { getByRole } = render(
                <SDKContext.Provider value={SDKContextClass.instance}>
                    <MediaUploadDialog
                        files={[new File(["hi"], "image.png", { type: "image/png" })]}
                        isFileSizeAcceptable={() => true}
                        room={room}
                        captionModel={captionModel}
                        onFinished={vi.fn()}
                    />
                </SDKContext.Provider>,
                { reactStrictMode: true },
            );
            const caption = getByRole("textbox", { name: "Caption" });
            // Let FocusLock finish its deferred returnFocus from the StrictMode unmount.
            await waitFor(() => expect(caption).toHaveFocus());
            await user.keyboard(" more");
            expect(captionModel.parts.map((part) => part.text).join("")).toBe(`${draft} more`);
            expect(caption.textContent).toBe(`${draft} more`);

            // A later focus change must preserve the cursor position chosen by the user.
            const range = document.createRange();
            range.selectNodeContents(caption);
            range.collapse(true);
            document.getSelection()!.removeAllRanges();
            document.getSelection()!.addRange(range);
            const upload = getByRole("button", { name: "Send" });
            upload.focus();
            caption.focus();
            await user.keyboard("new ");
            expect(captionModel.parts.map((part) => part.text).join("")).toBe(`new ${draft} more`);
        } finally {
            document.removeEventListener("focusin", onFocusIn);
        }
    });

    it.each([1, 3])("focuses the caption at the end and confirms on Enter (%s files)", (totalFiles) => {
        const client = createTestClient();
        const room = new Room("!room:server", client, client.getSafeUserId());
        const pc = new PartCreator(room, client);
        const captionModel = new EditorModel([pc.plain("hello")], pc);
        const onFinished = vi.fn();
        const { getByRole, queryByText } = render(
            <SDKContext.Provider value={SDKContextClass.instance}>
                <MediaUploadDialog
                    isFileSizeAcceptable={() => true}
                    room={room}
                    captionModel={captionModel}
                    files={Array.from(
                        { length: totalFiles },
                        (_, index) => new File(["hi"], `${index}.png`, { type: "image/png" }),
                    )}
                    onFinished={onFinished}
                />
            </SDKContext.Provider>,
        );
        const caption = getByRole("textbox", { name: "Caption" });
        expect(caption).toHaveFocus();
        expect(caption).toHaveTextContent("hello");
        expect(document.getSelection()?.anchorOffset).toBe(5);
        expect(queryByText("The caption is sent with the last file")).toBeNull();
        fireEvent.keyDown(caption, { key: "Enter", code: "Enter", keyCode: 13, shiftKey: true });
        expect(onFinished).not.toHaveBeenCalled();
        fireEvent.keyDown(caption, { key: "Enter", code: "Enter", keyCode: 13, isComposing: true });
        expect(onFinished).not.toHaveBeenCalled();
        const autocomplete = vi.spyOn(captionModel, "autoComplete", "get").mockReturnValue({
            hasCompletions: () => true,
        } as unknown as AutocompleteWrapperModel);
        fireEvent.keyDown(caption.parentElement!, { key: "Enter", code: "Enter", keyCode: 13 });
        expect(onFinished).not.toHaveBeenCalled();
        autocomplete.mockRestore();
        fireEvent.keyDown(caption, { key: "Enter", code: "Enter", keyCode: 13 });
        expect(onFinished).toHaveBeenCalledWith(true, { files: expect.any(Array), groupItems: totalFiles > 1 });
    });

    it.each(["caption", "button"])("should append clipboard images while the %s has focus", async (target) => {
        const client = createTestClient();
        const room = new Room("!room:server", client, client.getSafeUserId());
        const pc = new PartCreator(room, client);
        const captionModel = new EditorModel([pc.plain("Keep this caption")], pc);
        const onFinished = vi.fn();
        const createUrl = vi.spyOn(URL, "createObjectURL");
        const revoke = vi.spyOn(URL, "revokeObjectURL");
        const original = new File(["a"], "original.png", { type: "image/png" });
        const pasted = [
            new File(["b"], "clipboard.png", { type: "image/png" }),
            new File(["c"], "clipboard2.jpg", { type: "image/jpeg" }),
        ];
        const { getByRole, queryByRole, unmount } = render(
            <SDKContext.Provider value={SDKContextClass.instance}>
                <MediaUploadDialog
                    files={[original]}
                    isFileSizeAcceptable={() => true}
                    room={room}
                    captionModel={captionModel}
                    onFinished={onFinished}
                />
            </SDKContext.Provider>,
        );
        const caption = getByRole("textbox", { name: "Caption" });
        const send = getByRole("button", { name: "Send" });
        const pasteTarget = target === "caption" ? caption : send;
        pasteTarget.focus();
        expect(
            fireEvent.paste(pasteTarget, {
                clipboardData: { files: [...pasted, new File(["ignore"], "notes.txt", { type: "text/plain" })] },
            }),
        ).toBe(false);

        for (const image of pasted) {
            expect(getByRole("img", { name: image.name })).toBeInTheDocument();
            expect(createUrl).toHaveBeenCalledWith(image);
        }
        expect(getByRole("heading", { name: "3 images selected" })).toBeInTheDocument();
        expect(caption).toHaveTextContent("Keep this caption");
        expect(captionModel.parts.map((part) => part.text).join("")).toBe("Keep this caption");
        expect(getByRole("checkbox", { name: "Group items" })).toBeChecked();
        expect(onFinished).not.toHaveBeenCalled();

        revoke.mockClear();
        fireEvent.click(getByRole("button", { name: "Remove clipboard.png" }));
        expect(queryByRole("img", { name: "clipboard.png" })).toBeNull();
        expect(revoke).toHaveBeenCalledTimes(1);
        fireEvent.click(send);
        expect(onFinished).toHaveBeenCalledExactlyOnceWith(true, {
            files: [original, pasted[1]],
            groupItems: true,
        });
        unmount();
        expect(revoke).toHaveBeenCalledTimes(3);
    });

    it("should apply file size validation to pasted images", () => {
        const original = new File(["a"], "original.png", { type: "image/png" });
        const tooLarge = new File(["too large"], "large.png", { type: "image/png" });
        const onFinished = vi.fn();
        const { getByRole, queryByRole } = render(
            <MediaUploadDialog
                files={[original]}
                isFileSizeAcceptable={(file) => file.size < 2}
                onFinished={onFinished}
            />,
        );
        fireEvent.paste(getByRole("dialog"), { clipboardData: { files: [tooLarge] } });
        expect(getByRole("alert")).toHaveTextContent("large.png");
        expect(queryByRole("img", { name: "large.png" })).toBeNull();
        fireEvent.click(getByRole("button", { name: "Send" }));
        expect(onFinished).toHaveBeenCalledExactlyOnceWith(true, { files: [original], groupItems: false });
    });

    it("should paste text into the caption without adding an attachment", async () => {
        const user = userEvent.setup();
        const client = createTestClient();
        const room = new Room("!room:server", client, client.getSafeUserId());
        const pc = new PartCreator(room, client);
        const captionModel = new EditorModel([], pc);
        const file = new File(["a"], "original.png", { type: "image/png" });
        const onFinished = vi.fn();
        const { getByRole } = render(
            <SDKContext.Provider value={SDKContextClass.instance}>
                <MediaUploadDialog
                    files={[file]}
                    isFileSizeAcceptable={() => true}
                    room={room}
                    captionModel={captionModel}
                    onFinished={onFinished}
                />
            </SDKContext.Provider>,
        );
        const caption = getByRole("textbox", { name: "Caption" });
        await waitFor(() => expect(caption).toHaveFocus());
        await user.paste("Pasted caption");
        expect(caption).toHaveTextContent("Pasted caption");
        fireEvent.click(getByRole("button", { name: "Send" }));
        expect(onFinished).toHaveBeenCalledExactlyOnceWith(true, { files: [file], groupItems: false });
    });

    it("should ignore non-image clipboard files", () => {
        const file = new File(["a"], "original.png", { type: "image/png" });
        const onFinished = vi.fn();
        const { getByRole } = render(
            <MediaUploadDialog files={[file]} isFileSizeAcceptable={() => true} onFinished={onFinished} />,
        );
        const send = getByRole("button", { name: "Send" });
        expect(
            fireEvent.paste(send, {
                clipboardData: { files: [new File(["text"], "notes.txt", { type: "text/plain" })] },
            }),
        ).toBe(true);
        fireEvent.click(send);
        expect(onFinished).toHaveBeenCalledExactlyOnceWith(true, { files: [file], groupItems: false });
    });

    it("renders the title and cancels on Escape", () => {
        const onFinished = vi.fn();
        const { getByRole } = render(
            <MediaUploadDialog
                files={[new File(["a"], "a.png", { type: "image/png" })]}
                isFileSizeAcceptable={() => true}
                onFinished={onFinished}
            />,
        );
        expect(getByRole("heading", { name: "Send an image" })).toBeInTheDocument();
        fireEvent.keyDown(getByRole("dialog"), { key: "Escape", code: "Escape", keyCode: 27 });
        expect(onFinished).toHaveBeenCalledExactlyOnceWith(false);
    });
});

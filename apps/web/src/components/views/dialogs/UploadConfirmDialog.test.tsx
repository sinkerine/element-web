/*
Copyright 2025 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { fireEvent, render, waitFor } from "test-utils-rtl";
import { secureRandomString } from "matrix-js-sdk/src/randomstring";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

import { createTestClient } from "test-utils";
import { Room } from "matrix-js-sdk/src/matrix";
import type AutocompleteWrapperModel from "../../../editor/autocomplete";
import EditorModel from "../../../editor/model";
import { PartCreator } from "../../../editor/parts";
import { SDKContext } from "../../../contexts/SDKContext";
import { SDKContextClass } from "../../../contexts/SDKContextClass";
import UploadConfirmDialog from "./UploadConfirmDialog.tsx";

/**
 * The shared media preview tile hides the image until it has loaded it once out of band, which jsdom
 * never does: it fires neither `load` nor `error` for a real element. Stub the loader so the preview
 * settles into its loaded state.
 */
class MockImage {
    public onload: (() => void) | null = null;
    public onerror: ((error: unknown) => void) | null = null;
    public naturalWidth = 320;
    public naturalHeight = 240;
    private internalSrc = "";

    public get src(): string {
        return this.internalSrc;
    }

    public set src(value: string) {
        this.internalSrc = value;
        setTimeout(() => this.onload?.(), 0);
    }
}

/**
 * The video and audio tiles probe their source the same way, through a detached element that
 * happy-dom never loads either. Resolve the probe as soon as a source is set.
 */
function mockMediaElement(element: HTMLElement): void {
    Object.defineProperties(element, {
        videoWidth: { configurable: true, value: 320 },
        videoHeight: { configurable: true, value: 240 },
        src: {
            configurable: true,
            get: () => element.getAttribute("src") ?? "",
            set: (value: string) => {
                element.setAttribute("src", value);
                setTimeout(() => (element as HTMLMediaElement).onloadedmetadata?.(new Event("loadedmetadata")), 0);
            },
        },
    });
}

describe("<UploadConfirmDialog />", () => {
    const originalImage = window.Image;
    const createElement = document.createElement.bind(document);

    beforeEach(() => {
        window.Image = MockImage as unknown as typeof window.Image;
        vi.spyOn(document, "createElement").mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
            const element = createElement(tagName, options);
            if (tagName === "video" || tagName === "audio") mockMediaElement(element);
            return element;
        }) as typeof document.createElement);
    });

    afterEach(() => {
        window.Image = originalImage;
        vi.mocked(document.createElement).mockRestore();
    });

    it.each([1, 3])("focuses the caption at the end and confirms on Enter (%s files)", (totalFiles) => {
        const client = createTestClient();
        const room = new Room("!room:server", client, client.getSafeUserId());
        const pc = new PartCreator(room, client);
        const captionModel = new EditorModel([pc.plain("hello")], pc);
        const onFinished = vi.fn();
        const { getByRole, queryByText } = render(
            <SDKContext.Provider value={SDKContextClass.instance}>
                <UploadConfirmDialog
                    file={new File(["hi"], "notes.txt")}
                    room={room}
                    captionModel={captionModel}
                    totalFiles={totalFiles}
                    onFinished={onFinished}
                />
            </SDKContext.Provider>,
        );
        const caption = getByRole("textbox", { name: "Caption" });
        expect(caption).toHaveFocus();
        expect(caption).toHaveTextContent("hello");
        expect(document.getSelection()?.anchorOffset).toBe(5);
        expect(!!queryByText("The caption is sent with the last file")).toBe(totalFiles > 1);
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
        expect(onFinished).toHaveBeenCalledWith(true);
    });

    it.each(["room", "model", "neither"])("hides the caption when only %s is provided", (provided) => {
        const client = createTestClient();
        const room = new Room("!room:server", client, client.getSafeUserId());
        const captionModel = new EditorModel([], new PartCreator(room, client));
        const { queryByRole } = render(
            <UploadConfirmDialog
                file={new File(["hi"], "notes.txt")}
                room={provided === "room" ? room : undefined}
                captionModel={provided === "model" ? captionModel : undefined}
                onFinished={vi.fn()}
            />,
        );
        expect(queryByRole("textbox")).not.toBeInTheDocument();
    });

    it("should display image preview", async () => {
        const url = "blob:null/1234-5678-9101-1121";
        vi.spyOn(URL, "createObjectURL").mockReturnValue(url);

        const file = new File([secureRandomString(1024 * 124)], "image.png", { type: "image/png" });
        const { asFragment, getByRole } = render(
            <UploadConfirmDialog file={file} currentIndex={0} totalFiles={1} onFinished={vi.fn()} />,
        );

        // The preview labels the image with the file name.
        await waitFor(() => expect(getByRole("img", { name: "image.png" })).toHaveAttribute("src", url));
        expect(asFragment()).toMatchSnapshot();
    });
    it.each([
        ["video", "video/mp4", "clip.mp4"],
        ["audio", "audio/ogg", "voice.ogg"],
    ])("should display %s preview", async (tag, type, name) => {
        const url = "blob:null/1234-5678-9101-1121";
        vi.spyOn(URL, "createObjectURL").mockReturnValue(url);

        const file = new File([secureRandomString(1024 * 124)], name, { type });
        const { container } = render(
            <UploadConfirmDialog file={file} currentIndex={0} totalFiles={1} onFinished={vi.fn()} />,
        );

        await waitFor(() => expect(container.querySelector(tag)).toHaveAttribute("src", url));
    });

    it("should display a file with no media preview", () => {
        const file = new File(["hello"], "notes.txt", { type: "text/plain" });
        const { container, getByText } = render(
            <UploadConfirmDialog file={file} currentIndex={0} totalFiles={1} onFinished={vi.fn()} />,
        );

        expect(getByText("notes.txt")).toBeInTheDocument();
        expect(container.querySelector("img, video, audio")).toBeNull();
    });
});

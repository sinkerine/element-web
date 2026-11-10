/*
Copyright 2024 New Vector Ltd.
Copyright 2023 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "test-utils-rtl";

import { usePlainTextListeners } from "./usePlainTextListeners";

describe("setContent", () => {
    it("calling with a string calls the onChange argument", () => {
        const mockOnChange = vi.fn();
        const { result } = renderHook(() => usePlainTextListeners("initialContent", mockOnChange));

        const newContent = "new content";
        act(() => {
            result.current.setContent(newContent);
        });

        expect(mockOnChange).toHaveBeenCalledWith(newContent);
    });

    it("calling with no argument and no editor ref does not call onChange", () => {
        const mockOnChange = vi.fn();
        const { result } = renderHook(() => usePlainTextListeners("initialContent", mockOnChange));

        act(() => {
            result.current.setContent();
        });

        expect(mockOnChange).not.toHaveBeenCalled();
    });

    it("calling with no argument and a valid editor ref calls onChange with the editorRef innerHTML", () => {
        const mockOnChange = vi.fn();

        // create a div to represent the editor and append some content
        const mockEditor = document.createElement("div");
        const mockEditorText = "some text content";
        const textNode = document.createTextNode(mockEditorText);
        mockEditor.appendChild(textNode);

        const { result } = renderHook(() => usePlainTextListeners("initialContent", mockOnChange));

        // @ts-ignore in order to allow us to reassign the ref without complaint
        result.current.ref.current = mockEditor;

        act(() => {
            result.current.setContent();
        });

        expect(mockOnChange).toHaveBeenCalledWith(mockEditor.innerHTML);
    });
});

describe("native history ownership", () => {
    let editor: HTMLDivElement;
    let otherEditor: HTMLDivElement;

    beforeEach(() => {
        editor = document.createElement("div");
        otherEditor = document.createElement("div");
        editor.contentEditable = "true";
        otherEditor.contentEditable = "true";
        document.body.append(editor, otherEditor);
    });

    afterEach(() => {
        editor.remove();
        otherEditor.remove();
    });

    const mount = () => {
        const hook = renderHook(() => usePlainTextListeners());
        hook.result.current.ref.current = editor;
        editor.focus();
        return hook;
    };

    const beforeInput = (target: HTMLElement, inputType: string): InputEvent => {
        const event = new InputEvent("beforeinput", { inputType, bubbles: true, cancelable: true });
        target.dispatchEvent(event);
        return event;
    };

    it.each(["historyUndo", "historyRedo"])(
        "should cancel %s routed to another editor while this editor is active",
        (inputType) => {
            mount();
            const otherHandler = vi.fn();
            otherEditor.addEventListener("beforeinput", otherHandler);
            expect(beforeInput(otherEditor, inputType).defaultPrevented).toBe(true);
            expect(otherHandler).not.toHaveBeenCalled();
            expect(editor).toHaveFocus();
        },
    );

    it.each(["historyUndo", "historyRedo"])("should preserve ordinary %s within the active editor", (inputType) => {
        mount();
        const handler = vi.fn();
        editor.addEventListener("beforeinput", handler);
        expect(beforeInput(editor, inputType).defaultPrevented).toBe(false);
        const child = document.createElement("span");
        editor.append(child);
        expect(beforeInput(child, inputType).defaultPrevented).toBe(false);
        expect(handler).toHaveBeenCalledTimes(2);
    });

    it("should preserve other input events and another editor's own history", () => {
        mount();
        expect(beforeInput(otherEditor, "insertText").defaultPrevented).toBe(false);
        otherEditor.focus();
        expect(beforeInput(otherEditor, "historyUndo").defaultPrevented).toBe(false);
        expect(beforeInput(otherEditor, "historyRedo").defaultPrevented).toBe(false);
    });

    it("should remove the history guard when unmounted", () => {
        const hook = mount();
        hook.unmount();
        expect(beforeInput(otherEditor, "historyUndo").defaultPrevented).toBe(false);
    });
});

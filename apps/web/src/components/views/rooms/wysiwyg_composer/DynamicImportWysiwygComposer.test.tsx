/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, vi } from "vitest";
import React, { StrictMode } from "react";
import { act, render, screen, waitFor } from "test-utils-rtl";
import { initOnce } from "@vector-im/matrix-wysiwyg";

import { DynamicImportEditWysiwygComposer, DynamicImportSendWysiwygComposer } from "./DynamicImportWysiwygComposer";
import type EditorStateTransfer from "../../../../utils/EditorStateTransfer";

vi.mock("@vector-im/matrix-wysiwyg", () => ({ initOnce: vi.fn() }));
vi.mock("./SendWysiwygComposer", () => ({ default: () => <div role="textbox">Send composer</div> }));
vi.mock("./EditWysiwygComposer", () => ({ default: () => <div role="textbox">Edit composer</div> }));

describe("DynamicImportWysiwygComposer", () => {
    let initialization: ReturnType<typeof Promise.withResolvers<void>>;

    beforeEach(() => {
        initialization = Promise.withResolvers<void>();
        vi.mocked(initOnce).mockReset().mockReturnValue(initialization.promise);
    });

    it("should keep the send composer suspended until WASM initialization finishes", async () => {
        render(
            <StrictMode>
                <DynamicImportSendWysiwygComposer
                    isRichTextEnabled={true}
                    onChange={vi.fn()}
                    onSend={vi.fn()}
                    menuPosition={{}}
                />
            </StrictMode>,
        );

        await waitFor(() => expect(initOnce).toHaveBeenCalledTimes(1));
        expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

        await act(async () => initialization.resolve());
        expect(await screen.findByRole("textbox")).toHaveTextContent("Send composer");
        expect(initOnce).toHaveBeenCalledTimes(1);
    });

    it("should keep the edit composer suspended until WASM initialization finishes", async () => {
        render(
            <StrictMode>
                <DynamicImportEditWysiwygComposer editorStateTransfer={{} as EditorStateTransfer} />
            </StrictMode>,
        );

        await waitFor(() => expect(initOnce).toHaveBeenCalledTimes(1));
        expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

        await act(async () => initialization.resolve());
        expect(await screen.findByRole("textbox")).toHaveTextContent("Edit composer");
        expect(initOnce).toHaveBeenCalledTimes(1);
    });
});

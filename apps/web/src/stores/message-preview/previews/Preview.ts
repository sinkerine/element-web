/*
Copyright 2024 New Vector Ltd.
Copyright 2020 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type MatrixEvent } from "matrix-js-sdk/src/matrix";

import { type TagID } from "../../room-list-v3/skip-list/tag";

/** Options changing how a preview is rendered. */
export interface PreviewOptions {
    /** Use the display name without the user ID added for disambiguation. Always enabled by the room list. */
    plainSenderName?: boolean;
    /** Remove sender prefixes and reply fallbacks. Implies plainSenderName. */
    textOnly?: boolean;
}

/**
 * Represents an event preview.
 */
export interface Preview {
    /**
     * Gets the text which represents the event as a preview.
     * @param event The event to preview.
     * @param tagId Optional. The tag where the room the event was sent in resides.
     * @param isThread Optional. Whether the preview being generated is for a thread summary.
     * @param options Optional rendering choices for room-list previews.
     * @returns The preview.
     */
    getTextFor(event: MatrixEvent, tagId?: TagID, isThread?: boolean, options?: PreviewOptions): string | null;
}

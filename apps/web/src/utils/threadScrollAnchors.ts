/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

/** Where a thread timeline was scrolled when it was expanded or collapsed. */
export interface ThreadScrollAnchor {
    /** Event nearest the bottom of the viewport (ScrollPanel's tracked scroll token). */
    eventId: string;
    /** Distance in pixels of that event from the bottom of the viewport. */
    pixelOffset?: number;
}

const anchors = new Map<string, ThreadScrollAnchor>();

/** Remember the anchor for the next ThreadView. Null forgets it, meaning "at the latest message". */
export function saveThreadScrollAnchor(threadId: string, anchor: ThreadScrollAnchor | null): void {
    if (anchor) anchors.set(threadId, anchor);
    else anchors.delete(threadId);
}

/** Read the anchor saved for this thread without removing it. */
export function peekThreadScrollAnchor(threadId: string): ThreadScrollAnchor | null {
    return anchors.get(threadId) ?? null;
}

/** Forget the anchor saved for this thread. */
export function clearThreadScrollAnchor(threadId: string): void {
    anchors.delete(threadId);
}

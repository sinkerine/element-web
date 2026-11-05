/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

/** The parts of a room URL that name an expanded thread. */
export interface FullPageThreadPath {
    /** Event ID of the thread root. */
    threadId: string;
    /** Event in the thread to scroll to and highlight, if any. */
    eventId?: string;
}

/** Parse the suffix after `<room>/`, returning null for an ordinary event path. */
export function parseFullPageThreadPath(path: string | undefined): FullPageThreadPath | null {
    if (!path?.startsWith("thread/$")) return null;

    const threadPath = path.substring("thread/".length);
    // Room v3 event IDs can contain slashes, but only begin with a dollar sign.
    const eventOffset = threadPath.indexOf("/$");
    if (eventOffset === -1) return { threadId: threadPath };

    return {
        threadId: threadPath.substring(0, eventOffset),
        eventId: threadPath.substring(eventOffset + 1),
    };
}

/** Format `thread/<threadId>` or `thread/<threadId>/<eventId>` for a room screen. */
export function formatFullPageThreadPath(threadId: string, eventId?: string): string {
    const path = `thread/${threadId}`;
    return eventId && eventId !== threadId ? `${path}/${eventId}` : path;
}

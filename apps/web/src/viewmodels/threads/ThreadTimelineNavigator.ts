/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type MatrixEvent } from "matrix-js-sdk/src/matrix";
import { type OwnMessageBox } from "@element-hq/web-shared-components";

/** What ThreadOwnMessagesViewModel needs from the thread's timeline panel. */
export interface ThreadTimelineNavigator {
    /** Events currently loaded in the panel, oldest first. */
    getLoadedEvents(): MatrixEvent[];
    /** Load one older page. False means exhausted; AbortError means the panel was replaced. */
    loadOlderEvents(): Promise<boolean>;
    /** Load one newer page without moving the viewport anchor. False means the live end was reached. */
    loadNewerEvents(): Promise<boolean>;
    /** Keep loaded jump targets rendered while the list is open; release on close/disposal. */
    setTimelineRetention(retain: boolean): void;
    /** Changes on window replacement or trimming; invalidates completion and the page budget. */
    getTimelineWindowVersion(): number;
    /** Oldest loaded event whose top edge is inside the viewport. */
    getTopVisibleEventId(): string | undefined;
    /** Whether any part of the event tile is inside the viewport. */
    isEventVisible(eventId: string): boolean;
    /** Event tile box relative to the timeline wrapper, if rendered. */
    getEventBox(eventId: string): OwnMessageBox | undefined;
    /** Scroll to a loaded event a third of the way down the viewport and highlight it. */
    jumpToEvent(eventId: string): void;
    /** Undefined is treated as true before the panel loads. */
    isAtEndOfLiveTimeline(): boolean | undefined;
    /** Go to the live end and clear the jump highlight. */
    jumpToLatest(): void;
}

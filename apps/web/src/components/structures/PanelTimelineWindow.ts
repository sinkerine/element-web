/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type EventTimelineSet, type MatrixClient, TimelineWindow } from "matrix-js-sdk/src/matrix";

interface OwnerCallbacks {
    isRetained: () => boolean;
    onTrimmed: () => void;
}

/** A timeline window whose owner can retain jump targets and observe trimming. */
export class PanelTimelineWindow extends TimelineWindow {
    public constructor(
        client: MatrixClient,
        timelineSet: EventTimelineSet,
        windowLimit: number | undefined,
        private ownerCallbacks: OwnerCallbacks | undefined,
    ) {
        super(client, timelineSet, { windowLimit });
    }

    /** Release the panel: the SDK's room listener can outlive this window's owner. */
    public detachOwner(): void {
        this.ownerCallbacks = undefined;
    }

    public override unpaginate(count: number, startOfTimeline: boolean): void {
        if (this.ownerCallbacks?.isRetained()) return;
        super.unpaginate(count, startOfTimeline);
        if (count > 0) this.ownerCallbacks?.onTrimmed();
    }
}

/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import type RightPanelStore from "../stores/right-panel/RightPanelStore";
import { type IRightPanelCard } from "../stores/right-panel/RightPanelStoreIPanelState";
import { RightPanelPhases } from "../stores/right-panel/RightPanelStorePhases";

/**
 * The room's thread card when its panel is open and its root matches the expanded thread, otherwise null.
 */
export function getFullPageThreadCard(
    rightPanelStore: RightPanelStore,
    roomId: string,
    fullPageThreadId: string | null,
): IRightPanelCard | null {
    if (!fullPageThreadId || !rightPanelStore.isOpenForRoom(roomId)) return null;
    const card = rightPanelStore.currentCardForRoom(roomId);
    return card.phase === RightPanelPhases.ThreadView && card.state?.threadHeadEvent?.getId() === fullPageThreadId
        ? card
        : null;
}

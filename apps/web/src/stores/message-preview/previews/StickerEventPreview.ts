/*
Copyright 2024 New Vector Ltd.
Copyright 2020 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type MatrixEvent } from "matrix-js-sdk/src/matrix";

import { type Preview, type PreviewOptions } from "./Preview";
import { type TagID } from "../../room-list-v3/skip-list/tag";
import { getSenderName, isSelf, shouldPrefixMessagesIn } from "./utils";
import { _t } from "../../../languageHandler";

export class StickerEventPreview implements Preview {
    public getTextFor(event: MatrixEvent, tagId?: TagID, isThread?: boolean, options?: PreviewOptions): string | null {
        const stickerName = event.getContent()["body"];
        if (!stickerName) return null;

        if (options?.textOnly || isThread || isSelf(event) || !shouldPrefixMessagesIn(event.getRoomId()!, tagId)) {
            return stickerName;
        } else {
            return _t("event_preview|m.sticker", { senderName: getSenderName(event, options), stickerName });
        }
    }
}

/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { describe, expect, it } from "vitest";

import { getMediaCaption, getMediaFileName, isCaptionableContent, withMediaCaption } from "./MediaCaptionContent";

// Keep this suite in the node environment: content helpers must not require editor or UI initialization.
describe("MediaCaptionContent", () => {
    it("should read and replace an encrypted attachment caption without changing its media", () => {
        const content = {
            msgtype: "m.image",
            body: "A caption",
            filename: "photo.png",
            file: { url: "mxc://example.org/photo" },
            info: { mimetype: "image/png" },
        };

        expect(isCaptionableContent(content)).toBe(true);
        expect(getMediaFileName(content)).toBe("photo.png");
        expect(getMediaCaption(content)).toEqual({ body: "A caption" });
        const replacement = withMediaCaption(content, "photo.png", { body: "Updated caption" });
        expect(replacement).toEqual({ ...content, body: "Updated caption" });
        expect(replacement.file).toBe(content.file);
        expect(replacement.info).toBe(content.info);
        expect(content.body).toBe("A caption");
    });

    it("should distinguish a filename-only attachment from a caption", () => {
        expect(getMediaCaption({ filename: "photo.png", body: "photo.png" })).toBeNull();
        expect(getMediaFileName({})).toBe("Attachment");
    });
});

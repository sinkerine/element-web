/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React, { useEffect, type JSX } from "react";
import { MGalleryBodyView, useCreateAutoDisposedViewModel } from "@element-hq/web-shared-components";

import { type IBodyProps } from "./IBodyProps";
import { isGalleryContent } from "../../../utils/MediaCaptionContent";
import { useMediaVisible } from "../../../hooks/useMediaVisible";
import { GalleryBodyViewModel } from "../../../viewmodels/message-body/GalleryBodyViewModel";
import Modal from "../../../Modal";
import ImageView from "../elements/ImageView";

/** Timeline adapter for a validated gallery event, with per-event media visibility. */
export function MGalleryBody(props: IBodyProps): JSX.Element | null {
    const content = props.mxEvent.getContent();
    if (!isGalleryContent(content)) return null;
    return <GalleryBody key={JSON.stringify(content)} {...props} />;
}

function GalleryBody(props: IBodyProps): JSX.Element {
    const [visible, setVisible] = useMediaVisible(props.mxEvent);
    const content = props.mxEvent.getContent();
    if (!isGalleryContent(content)) throw new Error("Invalid gallery content");
    const vm = useCreateAutoDisposedViewModel(
        () =>
            new GalleryBodyViewModel({
                content,
                mediaVisible: visible,
                inhibitInteraction: props.inhibitInteraction,
                showMedia: () => setVisible(true),
                openLightbox: (items, initialIndex) => {
                    Modal.createDialog(
                        ImageView,
                        {
                            src: items[initialIndex].src,
                            items,
                            initialIndex,
                            mxEvent: props.mxEvent,
                            permalinkCreator: props.permalinkCreator,
                        },
                        "mx_Dialog_lightbox",
                        undefined,
                        true,
                    );
                },
            }),
    );
    useEffect(() => {
        vm.setVisibility(visible, props.inhibitInteraction);
    }, [vm, visible, props.inhibitInteraction]);
    return <MGalleryBodyView vm={vm} />;
}

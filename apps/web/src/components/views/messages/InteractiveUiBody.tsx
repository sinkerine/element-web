/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React, { type JSX, useEffect, useReducer } from "react";
import { InteractiveUiView, useCreateAutoDisposedViewModel } from "@element-hq/web-shared-components";
import { Text } from "@vector-im/compound-web";
import { MatrixEventEvent } from "matrix-js-sdk/src/matrix";

import { type IBodyProps } from "./IBodyProps";
import { TextualBodyFactory } from "./TextualBodyFactory";
import { parseInteractiveUi, type ParseResult } from "../../../interactive-ui/protocol";
import { InteractiveUiBodyViewModel } from "../../../viewmodels/message-body/InteractiveUiBodyViewModel";
import { useMatrixClientContext } from "../../../contexts/MatrixClientContext";
import { _t } from "../../../languageHandler";

function ParsedBody({ parsed, ...props }: IBodyProps & { parsed: Extract<ParseResult, { ok: true }> }): JSX.Element {
    const client = useMatrixClientContext();
    const vm = useCreateAutoDisposedViewModel(
        () => new InteractiveUiBodyViewModel({ mxEvent: props.mxEvent, client, parsed }),
    );
    return <InteractiveUiView vm={vm} fallback={<TextualBodyFactory {...props} ref={undefined} />} />;
}

/** Timeline adapter for interactive event content; props preserve the normal textual fallback. */
export function InteractiveUiBody(props: Readonly<IBodyProps>): JSX.Element {
    const [, update] = useReducer((value: number) => value + 1, 0);
    useEffect(() => {
        props.mxEvent.on(MatrixEventEvent.Replaced, update);
        return () => {
            props.mxEvent.off(MatrixEventEvent.Replaced, update);
        };
    }, [props.mxEvent]);
    const parsed = parseInteractiveUi(props.mxEvent.getContent());
    if (parsed?.ok && !props.mxEvent.isRedacted())
        return <ParsedBody key={props.mxEvent.getId()} {...props} parsed={parsed} />;
    return (
        <>
            <TextualBodyFactory {...props} ref={undefined} />
            {parsed && !parsed.ok && parsed.error.code !== "bad_version" && (
                <Text as="p" size="sm">
                    {_t("interactive_ui|invalid_content")}
                </Text>
            )}
        </>
    );
}

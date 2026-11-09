/*
Copyright 2024 New Vector Ltd.
Copyright 2022 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, {
    type JSX,
    type RefObject,
    useMemo,
    useRef,
    useState,
    useCallback,
    useEffect,
    type ReactNode,
} from "react";
import { type IEventRelation } from "matrix-js-sdk/src/matrix";
import LockOffIcon from "@vector-im/compound-design-tokens/assets/web/icons/lock-off";

import { useWysiwygSendActionHandler } from "./hooks/useWysiwygSendActionHandler";
import { WysiwygComposer } from "./components/WysiwygComposer";
import { PlainTextComposer } from "./components/PlainTextComposer";
import { type ComposerFunctions } from "./types";
import { E2EStatus } from "../../../../utils/ShieldUtils";
import E2EIcon from "../E2EIcon";
import { type MenuProps } from "../../../structures/ContextMenu";
import { Emoji } from "./components/Emoji";
import { ComposerContext, getDefaultContextValue } from "./ComposerContext";
import { useCaptionDraft } from "./hooks/useCaptionDraft";

interface ContentProps {
    disabled?: boolean;
    composerFunctions: ComposerFunctions;
    onClear: () => void;
    ref?: RefObject<HTMLElement | null>;
}

const Content = function Content({ disabled = false, composerFunctions, onClear, ref }: ContentProps): ReactNode {
    const actions = useMemo(
        () => ({
            ...composerFunctions,
            clear: () => {
                composerFunctions.clear();
                onClear();
            },
        }),
        [composerFunctions, onClear],
    );
    useWysiwygSendActionHandler(disabled, ref, actions);
    return null;
};

export interface SendWysiwygComposerProps {
    initialContent?: string;
    isRichTextEnabled: boolean;
    placeholder?: string;
    disabled?: boolean;
    e2eStatus?: E2EStatus;
    onChange: (content: string) => void;
    onSend: () => void;
    /** Update and persist the draft when an upload clears or restores the editor. */
    onCaptionDraftChange?: (content: string) => void;
    menuPosition: MenuProps;
    eventRelation?: IEventRelation;
}

// Default needed for React.lazy
export default function SendWysiwygComposer({
    isRichTextEnabled,
    e2eStatus,
    menuPosition,
    onChange: onContentChange,
    onSend: onSendMessage,
    onCaptionDraftChange,
    ...props
}: SendWysiwygComposerProps): JSX.Element {
    const Composer = isRichTextEnabled ? WysiwygComposer : PlainTextComposer;
    const content = useRef(props.initialContent ?? "");
    const [editorReset, setEditorReset] = useState({
        content: props.initialContent,
        parentInitialContent: props.initialContent,
        revision: 0,
    });
    // A parent update permanently supersedes a local reset, even if it later returns to an earlier value.
    if (editorReset.parentInitialContent !== props.initialContent) {
        setEditorReset({ ...editorReset, content: props.initialContent, parentInitialContent: props.initialContent });
    }
    const clearDraft = useCallback(() => {
        content.current = "";
        setEditorReset((previous) => ({ ...previous, content: "" }));
    }, []);
    const onSend = useCallback(() => {
        // The parent must snapshot the outgoing text before the editor reports its cleared state.
        onSendMessage();
        clearDraft();
    }, [onSendMessage, clearDraft]);
    const onChange = useCallback(
        (value: string): void => {
            content.current = value;
            onContentChange(value);
        },
        [onContentChange],
    );
    useCaptionDraft(content, isRichTextEnabled, (value) => {
        content.current = value;
        // Recreate the editor model so sent captions cannot be recovered through Undo.
        setEditorReset((previous) => ({
            content: value,
            parentInitialContent: props.initialContent,
            revision: previous.revision + 1,
        }));
        (onCaptionDraftChange ?? onContentChange)(value);
    });
    const initialContent = editorReset.content;
    useEffect(() => {
        content.current = initialContent ?? "";
    }, [initialContent, isRichTextEnabled]);
    const defaultContextValue = useMemo(
        () => getDefaultContextValue({ eventRelation: props.eventRelation }),
        [props.eventRelation],
    );

    let leftIcon: false | JSX.Element = false;
    if (!e2eStatus) {
        leftIcon = (
            <LockOffIcon
                data-testid="e2e-icon"
                width={12}
                height={12}
                color="var(--cpd-color-icon-info-primary)"
                className="mx_E2EIcon"
            />
        );
    } else if (e2eStatus !== E2EStatus.Normal) {
        leftIcon = <E2EIcon status={e2eStatus} size={12} />;
    }
    return (
        <ComposerContext.Provider value={defaultContextValue}>
            <Composer
                key={editorReset.revision}
                className="mx_SendWysiwygComposer"
                leftComponent={leftIcon}
                rightComponent={<Emoji menuPosition={menuPosition} />}
                {...props}
                initialContent={initialContent}
                onChange={onChange}
                onSend={onSend}
            >
                {(ref, composerFunctions) => (
                    <Content
                        disabled={props.disabled}
                        ref={ref}
                        composerFunctions={composerFunctions}
                        onClear={clearDraft}
                    />
                )}
            </Composer>
        </ComposerContext.Provider>
    );
}

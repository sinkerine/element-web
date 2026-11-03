/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
    BaseViewModel,
    type OwnMessageItem,
    type ThreadOwnMessagesViewSnapshot,
    type ThreadOwnMessagesViewActions,
} from "@element-hq/web-shared-components";
import {
    type MatrixClient,
    MatrixEvent,
    MatrixEventEvent,
    type Thread,
    ThreadEvent,
    RoomEvent,
    RelationType,
} from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

import { type ThreadTimelineNavigator } from "./ThreadTimelineNavigator";
import { isContentActionable } from "../../utils/EventUtils";
import shouldHideEvent from "../../shouldHideEvent";
import { formatTime } from "../../DateUtils";
import SettingsStore from "../../settings/SettingsStore";
import { _t } from "../../languageHandler";
import { getKeyboardShortcutValue } from "../../accessibility/KeyboardShortcutUtils";
import { ALTERNATE_KEY_NAME, KEY_ICON, KeyBindingAction } from "../../accessibility/KeyboardShortcuts";
import { IS_MAC, Key } from "../../Keyboard";

/** Dependencies for the thread's own-message navigation. */
export interface ThreadOwnMessagesViewModelProps {
    client: MatrixClient;
    thread: Thread;
    timeline: ThreadTimelineNavigator;
}

/** Own-message list, history loading, preview and navigation state for one thread. */
export class ThreadOwnMessagesViewModel
    extends BaseViewModel<ThreadOwnMessagesViewSnapshot, ThreadOwnMessagesViewModelProps>
    implements ThreadOwnMessagesViewActions
{
    private lastTargetId?: string;
    private pendingPreviousFocus = false;
    private loading?: Promise<void>;
    private pages = 0;
    private olderComplete = false;
    private newerComplete = false;
    private windowVersion: number;
    private readonly eventListeners = new Map<MatrixEvent, () => void>();
    private openGeneration = 0;
    private interaction = 0;
    private focusSequence = 0;
    private announcementSequence = 0;
    private noticeTimer?: ReturnType<typeof setTimeout>;

    public constructor(props: ThreadOwnMessagesViewModelProps) {
        const userId = props.client.getSafeUserId();
        const member = props.thread.room.getMember(userId);
        const combo = getKeyboardShortcutValue(KeyBindingAction.JumpToPreviousOwnMessage);
        const keys = combo
            ? [
                  ...(combo.ctrlKey || (combo.ctrlOrCmdKey && !IS_MAC) ? [Key.CONTROL] : []),
                  ...(combo.metaKey || (combo.ctrlOrCmdKey && IS_MAC) ? [Key.META] : []),
                  ...(combo.altKey ? [Key.ALT] : []),
                  ...(combo.shiftKey ? [Key.SHIFT] : []),
                  combo.key,
              ]
            : [];
        const shortcut = keys
            .map((key) => KEY_ICON[key] ?? (ALTERNATE_KEY_NAME[key] ? _t(ALTERNATE_KEY_NAME[key]) : key))
            .join(IS_MAC ? " " : "+");
        super(props, {
            visible: false,
            showJumpToLatest: false,
            userId,
            displayName: member?.name ?? userId,
            avatarUrl: member?.getAvatarUrl(props.client.getHomeserverUrl(), 38, 38, "crop", false, false) ?? undefined,
            shortcut,
            ariaKeyShortcuts: "Alt+PageUp",
            listOpen: false,
            items: [],
            complete: false,
            loading: false,
            loadError: false,
        });
        this.windowVersion = props.timeline.getTimelineWindowVersion();
        this.disposables.trackListener(props.thread, ThreadEvent.NewReply, this.onNewReply);
        this.disposables.trackListener(props.thread, ThreadEvent.Update, this.refreshItems);
        this.disposables.trackListener(props.thread, ThreadEvent.Delete, this.refreshItems);
        this.disposables.trackListener(props.thread.room, RoomEvent.Redaction, this.onRedaction);
        this.disposables.trackListener(props.thread.room, RoomEvent.RedactionCancelled, this.onRedaction);
        this.disposables.track(() => {
            props.timeline.setTimelineRetention(false);
            for (const dispose of this.eventListeners.values()) dispose();
            this.eventListeners.clear();
            clearTimeout(this.noticeTimer);
        });
        this.refreshItems();
    }

    private refreshItems = (): void => {
        if (this.isDisposed) return;
        const { thread, timeline } = this.props;
        const { userId, peek } = this.snapshot.current;
        const version = timeline.getTimelineWindowVersion();
        if (version !== this.windowVersion) {
            this.windowVersion = version;
            this.pages = 0;
            this.olderComplete = this.newerComplete = false;
            this.openGeneration++;
            this.snapshot.merge({ complete: false, loadError: false });
        }
        const events = timeline.getLoadedEvents();
        this.trackEvents(events);
        const showTwelveHour = SettingsStore.getValue("showTwelveHourTimestamps");
        const items: OwnMessageItem[] = [];
        for (let index = events.length - 1; index >= 0; index--) {
            const event = events[index];
            const id = event.getId();
            if (
                !id ||
                event.getSender() !== userId ||
                !isContentActionable(event) ||
                event.isRelation(RelationType.Replace) ||
                shouldHideEvent(event)
            ) {
                continue;
            }
            const body = typeof event.getContent().body === "string" ? event.getContent().body : "";
            const before = events[index - 1];
            const sender = before?.getSender();
            items.push({
                id,
                time: formatTime(new Date(event.getTs()), showTwelveHour),
                body,
                snippet: body.slice(0, 80),
                isRoot: id === thread.id,
                isEdited: !!event.replacingEventId(),
                isOnScreen: timeline.isEventVisible(id),
                isCurrent: id === this.lastTargetId,
                context: before
                    ? {
                          senderName: (sender && thread.room.getMember(sender)?.name) || sender || "",
                          snippet: String(before.getContent().body ?? "").slice(0, 80),
                      }
                    : undefined,
            });
        }
        const peekItem = items.find((item) => item.id === peek?.itemId);
        this.snapshot.merge({
            items,
            visible: thread.hasCurrentUserParticipated || thread.rootEvent?.getSender() === userId || items.length > 0,
            showJumpToLatest: timeline.isAtEndOfLiveTimeline() === false,
            peek: peekItem ? this.peekFor(peekItem) : undefined,
        });
    };

    private onNewReply = (): void => {
        // New replies may be beyond the retained window when the reader is away from the live end.
        this.newerComplete = false;
        this.snapshot.merge({ complete: false });
        this.refreshItems();
        if (this.snapshot.current.listOpen && !this.snapshot.current.loadError) void this.loadAll();
    };

    private onRedaction = (...args: unknown[]): void => {
        const [event, , threadId] = args;
        if (!(event instanceof MatrixEvent)) return;
        if (
            threadId === this.props.thread.id ||
            this.props.timeline.getLoadedEvents().some((loaded) => loaded.getId() === event.getAssociatedId())
        ) {
            this.refreshItems();
        }
    };

    private afterRedaction = (): void => {
        // BeforeRedaction fires before content is removed, including for the final reply in a thread.
        queueMicrotask(this.refreshItems);
    };

    private trackEvents(events: MatrixEvent[]): void {
        const loaded = new Set(events);
        for (const [event, dispose] of this.eventListeners) {
            if (!loaded.has(event)) {
                dispose();
                this.eventListeners.delete(event);
            }
        }
        for (const event of events) {
            if (this.eventListeners.has(event)) continue;
            event.on(MatrixEventEvent.Decrypted, this.refreshItems);
            event.on(MatrixEventEvent.Replaced, this.refreshItems);
            event.on(MatrixEventEvent.BeforeRedaction, this.afterRedaction);
            this.eventListeners.set(event, () => {
                event.off(MatrixEventEvent.Decrypted, this.refreshItems);
                event.off(MatrixEventEvent.Replaced, this.refreshItems);
                event.off(MatrixEventEvent.BeforeRedaction, this.afterRedaction);
            });
        }
    }

    private peekFor(item: OwnMessageItem): ThreadOwnMessagesViewSnapshot["peek"] {
        return {
            itemId: item.id,
            box: item.isOnScreen ? this.props.timeline.getEventBox(item.id) : undefined,
        };
    }

    private requestFocus(item: OwnMessageItem | undefined): void {
        if (!item) return;
        // Automatic focus suppresses row focus/blur actions in the view, so initialise its preview here.
        this.snapshot.merge({
            focusRequest: { itemId: item.id, seq: ++this.focusSequence },
            peek: this.peekFor(item),
        });
    }

    private anchorId(): string | undefined {
        return this.lastTargetId && this.props.timeline.isEventVisible(this.lastTargetId)
            ? this.lastTargetId
            : this.props.timeline.getTopVisibleEventId();
    }

    private previousItem(): OwnMessageItem | undefined {
        const events = this.props.timeline.getLoadedEvents();
        const anchor = this.anchorId();
        const anchorIndex = events.findIndex((event) => event.getId() === anchor);
        if (anchorIndex < 0) return undefined;
        const olderIds = new Set(events.slice(0, anchorIndex).map((event) => event.getId()));
        return this.snapshot.current.items.find((item) => olderIds.has(item.id));
    }

    private announce(text: string): void {
        this.snapshot.merge({ announcement: { id: ++this.announcementSequence, text } });
    }

    private openList(): void {
        if (this.isDisposed || !this.snapshot.current.visible) return;
        this.openGeneration++;
        this.props.timeline.setTimelineRetention(true);
        this.snapshot.merge({ listOpen: true, notice: undefined });
        this.refreshItems();
        const previous = this.previousItem();
        this.pendingPreviousFocus = !previous && !this.snapshot.current.complete;
        this.requestFocus(previous ?? this.snapshot.current.items[0]);
        this.announce(_t("threads_view|own_messages_opened", { count: this.snapshot.current.items.length }));
        if (!this.snapshot.current.loadError) void this.loadAll();
    }

    public toggleList = (): void => {
        if (this.snapshot.current.listOpen) this.closeList();
        else this.openList();
    };

    public closeList = (): void => {
        if (this.isDisposed) return;
        this.openGeneration++;
        this.interaction++;
        this.pendingPreviousFocus = false;
        this.props.timeline.setTimelineRetention(false);
        clearTimeout(this.noticeTimer);
        this.snapshot.merge({
            listOpen: false,
            peek: undefined,
            focusRequest: undefined,
            loading: false,
            notice: undefined,
        });
    };

    private loadAll(): Promise<void> {
        if (this.loading) return this.loading;
        if (this.isDisposed || !this.snapshot.current.listOpen || this.snapshot.current.complete || this.pages >= 50) {
            return Promise.resolve();
        }
        const generation = this.openGeneration;
        this.snapshot.merge({ loading: true, loadError: false });
        this.loading = this.loadPages(generation).finally(() => {
            this.loading = undefined;
            if (this.isDisposed) return;
            this.snapshot.merge({ loading: false });
            // A close/reopen during the in-flight page needs a fresh loop after that page settles.
            if (this.snapshot.current.listOpen && this.openGeneration !== generation) {
                this.refreshItems();
                void this.loadAll();
            }
        });
        return this.loading;
    }

    private async loadPages(generation: number): Promise<void> {
        while (
            !this.isDisposed &&
            this.snapshot.current.listOpen &&
            generation === this.openGeneration &&
            this.pages < 50 &&
            !this.snapshot.current.complete
        ) {
            try {
                this.pages++;
                const backwards = !this.olderComplete;
                const more = await (backwards
                    ? this.props.timeline.loadOlderEvents()
                    : this.props.timeline.loadNewerEvents());
                if (this.isDisposed || !this.snapshot.current.listOpen || generation !== this.openGeneration) return;
                if (backwards) this.olderComplete = !more;
                else this.newerComplete = !more;
                this.snapshot.merge({ complete: this.olderComplete && this.newerComplete });
                this.refreshItems();
                if (this.pendingPreviousFocus) {
                    const previous = this.previousItem();
                    if (previous) {
                        this.requestFocus(previous);
                        this.pendingPreviousFocus = false;
                    }
                }
                if (this.snapshot.current.complete) return;
            } catch (error) {
                if (this.isDisposed || !this.snapshot.current.listOpen || generation !== this.openGeneration) return;
                if (error instanceof Error && error.name === "AbortError") return;
                this.snapshot.merge({ loadError: true });
                logger.warn("Couldn't load older own messages in thread", error);
                return;
            }
        }
    }

    public retryLoad = (): void => {
        if (this.isDisposed) return;
        void this.loadAll();
    };

    public jumpTo = (itemId: string): void => {
        if (this.isDisposed) return;
        const item = this.snapshot.current.items.find((item) => item.id === itemId);
        if (!item) return;
        this.interaction++;
        this.pendingPreviousFocus = false;
        this.props.timeline.jumpToEvent(itemId);
        this.lastTargetId = itemId;
        this.snapshot.merge({ notice: undefined });
        this.announce(
            item.body
                ? item.isRoot
                    ? _t("threads_view|jumped_own_root", { time: item.time, body: item.body })
                    : _t("threads_view|jumped_own_message", { time: item.time, body: item.body })
                : _t("threads_view|jumped_own_message_no_body", { time: item.time }),
        );
        this.refreshItems();
    };

    public peek = (itemId: string | undefined): void => {
        if (this.isDisposed) return;
        this.interaction++;
        this.pendingPreviousFocus = false;
        const item = this.snapshot.current.items.find((item) => item.id === itemId);
        this.snapshot.merge({ peek: item ? this.peekFor(item) : undefined });
    };

    private nextOlderItem(): OwnMessageItem | undefined {
        if (!this.lastTargetId) return this.previousItem();
        const index = this.snapshot.current.items.findIndex((item) => item.id === this.lastTargetId);
        return index >= 0 ? this.snapshot.current.items[index + 1] : this.previousItem();
    }

    public jumpToPrevious = (): void => {
        if (this.isDisposed || !this.snapshot.current.visible) return;
        if (!this.snapshot.current.listOpen) {
            this.openList();
            return;
        }
        void this.jumpToOlder();
    };

    private async jumpToOlder(): Promise<void> {
        const generation = this.openGeneration;
        const interaction = ++this.interaction;
        this.pendingPreviousFocus = false;
        let item = this.nextOlderItem();
        if (!item && !this.snapshot.current.complete && !this.snapshot.current.loadError) {
            await this.loadAll();
            if (
                this.isDisposed ||
                !this.snapshot.current.listOpen ||
                generation !== this.openGeneration ||
                interaction !== this.interaction
            )
                return;
            item = this.nextOlderItem();
        }
        if (item) {
            this.jumpTo(item.id);
            this.requestFocus(this.snapshot.current.items.find((row) => row.id === item.id));
        } else if (this.snapshot.current.complete) {
            const notice = _t("threads_view|no_earlier_own_message");
            this.snapshot.merge({ notice });
            this.announce(notice);
            clearTimeout(this.noticeTimer);
            this.noticeTimer = setTimeout(() => {
                if (!this.isDisposed) this.snapshot.merge({ notice: undefined });
            }, 4000);
        }
    }

    public onTimelineScrolled = (): void => {
        this.refreshItems();
        if (this.snapshot.current.listOpen && !this.snapshot.current.loadError) void this.loadAll();
    };

    public jumpToLatest = (): void => {
        if (this.isDisposed) return;
        this.interaction++;
        this.pendingPreviousFocus = false;
        this.props.timeline.jumpToLatest();
        this.lastTargetId = undefined;
        this.snapshot.merge({ peek: undefined, notice: undefined });
        this.announce(_t("threads_view|jumped_to_latest"));
        this.refreshItems();
    };
}

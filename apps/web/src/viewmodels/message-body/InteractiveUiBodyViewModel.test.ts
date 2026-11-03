/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MatrixEvent, MatrixEventEvent, type MatrixClient, EventType } from "matrix-js-sdk/src/matrix";
import { type InteractiveUiRenderNode } from "@element-hq/web-shared-components";
import { stubClient } from "test-utils";

import { InteractiveUiBodyViewModel, type InteractiveUiBodyViewModelProps } from "./InteractiveUiBodyViewModel";
import {
    INTERACTIVE_UI_ACTION_KEY,
    INTERACTIVE_UI_KEY,
    parseInteractiveUi,
    type InteractiveUiPayload,
} from "../../interactive-ui/protocol";
import { type InteractiveUiActionContent } from "../../interactive-ui/action";
import { decryptFile } from "../../utils/DecryptFile";
import Modal from "../../Modal";
import * as mediaCustomization from "../../customisations/Media";
import knowledge from "../../interactive-ui/fixtures/valid/knowledge-map.en.json";
import controls from "../../interactive-ui/fixtures/valid/controls.json";
import form from "../../interactive-ui/fixtures/valid/form.json";
import carousel from "../../interactive-ui/fixtures/valid/product-carousel.json";
import content from "../../interactive-ui/fixtures/valid/content.json";
import layout from "../../interactive-ui/fixtures/valid/layout.json";
import table from "../../interactive-ui/fixtures/valid/table.json";
import bar from "../../interactive-ui/fixtures/valid/chart-bar.json";
import line from "../../interactive-ui/fixtures/valid/chart-line.json";
import pie from "../../interactive-ui/fixtures/valid/chart-pie.json";
import scatter from "../../interactive-ui/fixtures/valid/chart-scatter.json";

vi.mock("../../utils/DecryptFile", () => ({ decryptFile: vi.fn() }));

const deferred = <T>() => {
    let resolve!: (value: T) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
};

function nodes(root: InteractiveUiRenderNode): InteractiveUiRenderNode[] {
    return [
        root,
        ...("children" in root
            ? root.children.flatMap(nodes)
            : root.kind === "tabs"
              ? root.tabs.flatMap((tab) => nodes(tab.content))
              : []),
    ];
}

describe("InteractiveUiBodyViewModel", () => {
    let client: MatrixClient;
    const vms: InteractiveUiBodyViewModel[] = [];
    const create = (payload: unknown = knowledge, overrides: Partial<InteractiveUiBodyViewModelProps> = {}) => {
        const event = new MatrixEvent({
            event_id: "$original",
            room_id: "!room:example.org",
            sender: "@bot:example.org",
            type: EventType.RoomMessage,
            content: { msgtype: "m.text", body: "Fallback", [INTERACTIVE_UI_KEY]: payload },
        });
        const parsed = parseInteractiveUi(event.getContent());
        if (!parsed?.ok) throw new Error(JSON.stringify(parsed));
        const vm = new InteractiveUiBodyViewModel({
            mxEvent: event,
            client,
            parsed,
            mediaResolver: async () => undefined,
            ...overrides,
        });
        vms.push(vm);
        const replace = (next: unknown) => {
            vi.spyOn(event, "getContent").mockReturnValue({
                msgtype: "m.text",
                body: "Updated fallback",
                [INTERACTIVE_UI_KEY]: next,
            });
            event.emit(MatrixEventEvent.Replaced, event);
        };
        const get = (id: string) => nodes(vm.getSnapshot().root).find((node) => node.id === id);
        return { vm, event, replace, get };
    };

    beforeEach(() => {
        vi.useFakeTimers();
        localStorage.clear();
        client = stubClient();
        vi.spyOn(client, "sendMessage").mockResolvedValue({ event_id: "$action" });
        vi.stubGlobal("open", vi.fn());
        vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    });
    afterEach(() => {
        vms.splice(0).forEach((vm) => vm.dispose());
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it("should update conditions locally, persist device state and restore it", async () => {
        const { vm, get } = create();
        expect(get("nutrition")).toBeUndefined();
        vm.setValue("select", "nutrition");
        vm.selectGraphNode("nutrition", "maillard");
        expect(get("cooking")).toBeUndefined();
        expect(get("text")).toMatchObject({ kind: "text" });
        expect(get("nutrition")).toMatchObject({ selectedId: "maillard" });
        await vi.advanceTimersByTimeAsync(200);
        expect(JSON.parse(localStorage.getItem("mx_interactive_ui:!room:example.org:$original")!)).toMatchObject({
            ui_id: "knowledge-map",
            revision: 0,
            state: { branch: "nutrition", focus: "maillard" },
        });
        expect(create().get("nutrition")).toMatchObject({ selectedId: "maillard" });
        expect(client.sendMessage).not.toHaveBeenCalled();
    });

    it("should tolerate corrupt, inaccessible and exhausted storage", async () => {
        localStorage.setItem("mx_interactive_ui:!room:example.org:$original", "{");
        expect(create().get("cooking")).toBeDefined();
        const storage = {
            getItem: vi.fn(() => {
                throw new Error("blocked");
            }),
            setItem: vi.fn(() => {
                throw new Error("quota");
            }),
        };
        const { vm } = create(knowledge, { storage });
        vm.setValue("select", "nutrition");
        await vi.advanceTimersByTimeAsync(200);
        expect(storage.setItem).toHaveBeenCalled();
    });

    it("should merge compatible revisions, reject lower/equal revisions and reset another ui_id", () => {
        const { vm, replace, get } = create();
        vm.setValue("select", "nutrition");
        replace({ ...knowledge, revision: 1, title: "New title" });
        expect(get("nutrition")).toBeDefined();
        replace({ ...knowledge, revision: 0, title: "Old title" });
        replace({ ...knowledge, revision: 1, title: "Equal title" });
        expect(vm.getSnapshot().title).toBe("New title");
        const revised = structuredClone(knowledge);
        revised.nodes.find((node) => node.id === "select")!.options = [{ value: "cooking", label: "Cooking" }];
        replace({ ...revised, revision: 2 });
        expect(get("cooking")).toBeDefined();
        replace({ ...knowledge, ui_id: "different", revision: 3 });
        expect(get("cooking")).toBeDefined();
    });

    it("should fall back and disable actions on invalid edits and redaction", () => {
        const { vm, replace } = create();
        replace({ ...knowledge, root: "missing" });
        expect(vm.getSnapshot()).toMatchObject({ showAsText: true, status: "expired" });
        vm.activate("button");
        vm.setShowAsText(false);
        expect(vm.getSnapshot().showAsText).toBe(true);
        const other = create();
        other.event.emit(MatrixEventEvent.BeforeRedaction, other.event, other.event);
        other.vm.activate("button");
        expect(other.vm.getSnapshot().showAsText).toBe(true);
        expect(client.sendMessage).not.toHaveBeenCalled();
    });

    it("should keep sending pending until accepted and build an included-values reply with a random nonce", async () => {
        const request = deferred<{ event_id: string }>();
        vi.mocked(client.sendMessage).mockReturnValue(request.promise);
        const { vm, get } = create();
        vm.selectGraphNode("cooking", "maillard");
        vm.activate("button");
        vm.activate("button");
        expect(vm.getSnapshot().status).toBe("sending");
        expect(get("button")).toMatchObject({ disabled: true, pending: true });
        expect(client.sendMessage).toHaveBeenCalledTimes(1);
        const [roomId, threadId, sent] = vi.mocked(client.sendMessage).mock.calls[0];
        expect(roomId).toBe("!room:example.org");
        expect(threadId).toBeNull();
        expect(sent).toMatchObject({
            "body": expect.stringContaining("Maillard reaction"),
            "m.mentions": { user_ids: ["@bot:example.org"] },
            "m.relates_to": { "m.in_reply_to": { event_id: "$original" } },
            [INTERACTIVE_UI_ACTION_KEY]: {
                action_id: "explain_node",
                ui_event_id: "$original",
                revision: 0,
                values: { focus: "maillard" },
                nonce: expect.stringMatching(/^[A-Za-z0-9_-]{22,}$/),
            },
        });
        request.resolve({ event_id: "$action" });
        await request.promise;
        expect(vm.getSnapshot().status).toBe("active");
        expect(get("button")).toMatchObject({ disabled: false, pending: false });
    });

    it("should keep a slow homeserver send pending without starting the confirmation timer", async () => {
        const request = deferred<{ event_id: string }>();
        vi.mocked(client.sendMessage).mockReturnValue(request.promise);
        const { vm, get } = create(form);
        vm.setValue("text_input", "Alice");
        vm.submitForm("form");
        await vi.advanceTimersByTimeAsync(20000);
        expect(vm.getSnapshot()).toMatchObject({ status: "sending", confirmationOverdue: false });
        expect(get("form")).toMatchObject({ disabled: true, pending: true });
        vm.retryAfterOverdue();
        expect(client.sendMessage).toHaveBeenCalledTimes(1);
        request.resolve({ event_id: "$action" });
        await request.promise;
        expect(vm.getSnapshot().status).toBe("awaiting_confirmation");
        await vi.advanceTimersByTimeAsync(8000);
        expect(vm.getSnapshot().confirmationOverdue).toBe(true);
    });

    it("should await single-use confirmation, offer an overdue retry without sending, and use a new nonce", async () => {
        const payload = structuredClone(knowledge) as InteractiveUiPayload;
        const button = payload.nodes.find((n) => n.type === "button");
        if (button?.type !== "button") throw new Error("Missing button fixture");
        button.action = { type: "submit", action_id: "confirm", single_use: true };
        const { vm, replace } = create(payload);
        vm.activate("button");
        await Promise.resolve();
        expect(vm.getSnapshot().status).toBe("awaiting_confirmation");
        await vi.advanceTimersByTimeAsync(7999);
        expect(vm.getSnapshot().confirmationOverdue).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(vm.getSnapshot()).toMatchObject({
            confirmationOverdue: true,
            statusText: expect.stringContaining("@bot:example.org"),
        });
        vm.retryAfterOverdue();
        expect(vm.getSnapshot()).toMatchObject({ status: "active", confirmationOverdue: false });
        expect(client.sendMessage).toHaveBeenCalledTimes(1);
        vm.activate("button");
        await Promise.resolve();
        const contents = vi
            .mocked(client.sendMessage)
            .mock.calls.map((call) => call[2] as unknown as InteractiveUiActionContent);
        expect(contents[0][INTERACTIVE_UI_ACTION_KEY].nonce).not.toBe(contents[1][INTERACTIVE_UI_ACTION_KEY].nonce);
        replace({ ...payload, revision: 1, status: "submitted", status_text: "Accepted" });
        await vi.advanceTimersByTimeAsync(9000);
        expect(vm.getSnapshot()).toMatchObject({
            status: "submitted",
            statusText: "Accepted",
            confirmationOverdue: false,
        });
    });

    it.each(["active", "submitted", "expired", "superseded"])(
        "should preserve a %s sender edit arriving during send",
        async (status) => {
            const request = deferred<{ event_id: string }>();
            vi.mocked(client.sendMessage).mockReturnValue(request.promise);
            const { vm, replace } = create(form);
            vm.setValue("text_input", "Alice");
            vm.submitForm("form");
            replace({ ...form, revision: 1, status, status_text: "Edited during send" });
            request.resolve({ event_id: "$action" });
            await request.promise;
            expect(vm.getSnapshot()).toMatchObject({ status, statusText: "Edited during send" });
            await vi.advanceTimersByTimeAsync(9000);
            expect(vm.getSnapshot().confirmationOverdue).toBe(false);
        },
    );

    it("should validate form requirements and bounds, send in the original thread and reenable after failure", async () => {
        const { vm, event, get } = create(form);
        vi.spyOn(event, "threadRootId", "get").mockReturnValue("$thread");
        vm.submitForm("form");
        expect(get("text_input")).toMatchObject({ invalid: true });
        expect(client.sendMessage).not.toHaveBeenCalled();
        vm.setValue("number_input", 100);
        expect(get("number_input")).toMatchObject({ value: 1 });
        vm.setValue("text_input", "Alice");
        vi.mocked(client.sendMessage).mockRejectedValueOnce(new Error("offline"));
        vm.submitForm("form");
        await Promise.resolve();
        expect(vm.getSnapshot()).toMatchObject({
            status: "active",
            statusText: expect.stringContaining("Could not send"),
        });
        expect(get("form")).toMatchObject({ disabled: false });
        expect(client.sendMessage).toHaveBeenCalledWith(
            "!room:example.org",
            "$thread",
            expect.objectContaining({
                "m.relates_to": expect.objectContaining({ rel_type: "m.thread", event_id: "$thread" }),
                [INTERACTIVE_UI_ACTION_KEY]: expect.objectContaining({
                    values: { name: "Alice", quantity: 1, plan: "basic" },
                }),
            }),
        );
    });

    it("should isolate invalid number-field drafts from restored and persisted state and declarative actions", async () => {
        const payload = structuredClone(form) as InteractiveUiPayload;
        payload.state.quantity = 10;
        payload.state.name = "Alice";
        const number = payload.nodes.find((node) => node.type === "number_input");
        const root = payload.nodes.find((node) => node.type === "form");
        if (number?.type !== "number_input" || root?.type !== "form") throw new Error("Missing form fixture nodes");
        number.display = "field";
        number.min = 10;
        number.max = 100;
        root.children.push("preset");
        payload.nodes.push({
            id: "preset",
            type: "button",
            label: "Use 20",
            action: { type: "set_state", key: "quantity", value: 20 },
        });
        localStorage.setItem(
            "mx_interactive_ui:!room:example.org:$original",
            JSON.stringify({
                ui_id: payload.ui_id,
                revision: payload.revision,
                state: { quantity: 2 },
            }),
        );
        const { vm, get, replace } = create(payload);
        expect(get("number_input")).toMatchObject({ value: 10, invalid: false });
        for (const value of [null, 2, 101]) {
            vm.setValue("number_input", value);
            expect(get("number_input")).toMatchObject({ value, invalid: true });
            vm.submitForm("form");
            expect(client.sendMessage).not.toHaveBeenCalled();
        }
        vm.setValue("text_input", "Updated");
        await vi.advanceTimersByTimeAsync(200);
        expect(JSON.parse(localStorage.getItem("mx_interactive_ui:!room:example.org:$original")!).state).toMatchObject({
            name: "Updated",
            quantity: 10,
        });
        vm.setValue("number_input", Infinity);
        expect(get("number_input")).toMatchObject({ value: 101, invalid: true });
        vm.activate("preset");
        expect(get("number_input")).toMatchObject({ value: 20, invalid: false });
        vm.setValue("number_input", 2);
        replace({ ...payload, revision: 1 });
        expect(get("number_input")).toMatchObject({ value: 20, invalid: false });
        vm.submitForm("form");
        await Promise.resolve();
        expect(client.sendMessage).toHaveBeenCalledWith(
            expect.anything(),
            null,
            expect.objectContaining({
                [INTERACTIVE_UI_ACTION_KEY]: expect.objectContaining({
                    values: { name: "Updated", quantity: 20, plan: "basic" },
                }),
            }),
        );
    });

    it("should use local actions, guard invalid values and confirm full https URLs before opening", async () => {
        const confirm = vi.fn().mockResolvedValue(false);
        const { vm, get } = create(controls, { confirmOpenUrl: confirm });
        vm.activate("set");
        vm.activate("toggleButton");
        expect(get("select")).toMatchObject({ value: "plus" });
        expect(get("toggle")).toMatchObject({ value: true });
        vm.setValue("select", "not-offered");
        expect(get("select")).toMatchObject({ value: "plus" });
        vm.activate("linkButton");
        await Promise.resolve();
        expect(confirm).toHaveBeenCalledWith("https://example.org/");
        expect(window.open).not.toHaveBeenCalled();
        confirm.mockResolvedValue(true);
        vm.activate("linkButton");
        await Promise.resolve();
        expect(window.open).toHaveBeenCalledWith("https://example.org/", "_blank", "noopener,noreferrer");
        expect(client.sendMessage).not.toHaveBeenCalled();
    });

    it("should ignore an external link confirmation after replacement or disposal", async () => {
        const confirm = deferred<boolean>();
        const { vm, replace } = create(controls, { confirmOpenUrl: () => confirm.promise });
        vm.activate("linkButton");
        replace({ ...controls, revision: 1 });
        confirm.resolve(true);
        await confirm.promise;
        expect(window.open).not.toHaveBeenCalled();
    });

    it("should resolve all catalog fixtures and supply local graph/chart/table/carousel actions", () => {
        for (const fixture of [layout, content, controls, form, carousel, table, bar, line, pie, scatter]) {
            const { vm } = create(fixture);
            expect(vm.getSnapshot().root).toBeDefined();
        }
        const graphVm = create();
        graphVm.vm.selectGraphNode("cooking", "nonexistent");
        expect(graphVm.get("cooking")).toMatchObject({ selectedId: null });
        graphVm.vm.setGraphListMode("cooking", true);
        expect(graphVm.get("cooking")).toMatchObject({ showAsList: true });
        const chartVm = create(pie);
        chartVm.vm.setChartDataMode("chart", true);
        expect(chartVm.get("chart")).toMatchObject({
            showData: true,
            chart: { kind: "pie", values: expect.any(Array) },
        });
        const tableVm = create(table);
        tableVm.vm.sortTable("table", table.nodes[0].columns[0].key);
        expect(tableVm.get("table")).toMatchObject({ sort: { dir: "asc" } });
        tableVm.vm.sortTable("table", table.nodes[0].columns[0].key);
        expect(tableVm.get("table")).toMatchObject({ sort: { dir: "desc" } });
        const cards = create(carousel);
        cards.vm.setCarouselIndex("carousel", 2);
        cards.vm.setCarouselIndex("carousel", 99);
        expect(cards.get("carousel")).toMatchObject({ index: 2 });
    });

    it("should validate carousel submit values using its selected item", async () => {
        const payload = structuredClone(carousel) as InteractiveUiPayload;
        const cards = payload.nodes.find((n) => n.type === "carousel");
        if (cards?.type !== "carousel") throw new Error("Missing carousel fixture");
        cards.items[0].action = { type: "submit", action_id: "choose", include: [] };
        const { vm } = create(payload);
        vm.activateCarouselItem("carousel", "item1");
        await Promise.resolve();
        expect(client.sendMessage).toHaveBeenCalledWith(
            expect.anything(),
            null,
            expect.objectContaining({
                [INTERACTIVE_UI_ACTION_KEY]: expect.objectContaining({ action_id: "choose", values: {} }),
            }),
        );
    });

    it("should sanitize rich text and resolve encrypted and plain images, revoking stale/disposed URLs", async () => {
        const pending = deferred<string | undefined>();
        const mediaResolver = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue("blob:current");
        const payload = structuredClone(content);
        payload.nodes.find((node) => node.id === "rich_text")!.html =
            '<script>alert(1)</script><strong>Safe</strong><a href="javascript:alert(1)">bad</a>';
        const { vm, replace, get } = create(payload, { mediaResolver });
        expect(get("rich_text")).toMatchObject({ safeHtml: expect.stringContaining("<strong>Safe</strong>") });
        expect((get("rich_text") as { safeHtml: string }).safeHtml).not.toContain("javascript:");
        replace({ ...payload, revision: 1 });
        await Promise.resolve();
        expect(get("image")).toMatchObject({ src: "blob:current" });
        pending.resolve("blob:stale");
        await pending.promise;
        expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:stale");
        vm.dispose();
        expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:current");
        const cards = create(carousel, { mediaResolver });
        await Promise.resolve();
        expect(mediaResolver).toHaveBeenCalledWith(
            expect.objectContaining({ id: "carousel/item1", file: expect.any(Object) }),
        );
        cards.vm.dispose();
        expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:current");
    });

    it("should resolve default media with existing media/decryption helpers and release their blob URLs", async () => {
        const source = "https://example.org/_matrix/client/v1/media/download/server/image";
        vi.spyOn(mediaCustomization, "mediaFromContent").mockImplementation(
            (imageContent) =>
                ({
                    isEncrypted: !!imageContent.file,
                    srcHttp: source,
                    srcMxc: "mxc://server/image",
                }) as ReturnType<typeof mediaCustomization.mediaFromContent>,
        );
        vi.mocked(decryptFile).mockResolvedValue(new Blob(["image"], { type: "image/png" }));
        vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:decrypted");
        const plain = create(content, { mediaResolver: undefined });
        await vi.advanceTimersByTimeAsync(0);
        expect(plain.get("image")).toMatchObject({ src: source });
        const encrypted = create(carousel, { mediaResolver: undefined });
        await vi.advanceTimersByTimeAsync(0);
        expect(decryptFile).toHaveBeenCalledWith(
            carousel.nodes[1].items![0].image.file,
            expect.objectContaining({ mimetype: "image/png" }),
        );
        expect(encrypted.get("carousel")).toMatchObject({
            items: expect.arrayContaining([expect.objectContaining({ src: "blob:decrypted" })]),
        });
        encrypted.vm.dispose();
        expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:decrypted");
    });

    it("should show the full URL in the default confirmation dialog and route citation links through it", async () => {
        const createDialog = vi.spyOn(Modal, "createDialog").mockReturnValue({
            finished: Promise.resolve([true]),
            close: vi.fn(),
        } as ReturnType<typeof Modal.createDialog>);
        const { vm } = create(content, { confirmOpenUrl: undefined });
        vm.openLink("link");
        await Promise.resolve();
        const link = content.nodes.find((node) => node.type === "link")!;
        expect(createDialog).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ description: link.url }),
        );
        expect(window.open).toHaveBeenCalledWith(link.url, "_blank", "noopener,noreferrer");
    });

    it("should update tabs/disclosures and prevent controls from changing inactive content", () => {
        const { vm, get, replace } = create(layout);
        vm.setValue("tabs", "one");
        vm.setValue("collapsible", false);
        expect(get("collapsible")).toMatchObject({ open: false });
        replace({ ...layout, revision: 1, status: "expired" });
        vm.setValue("collapsible", true);
        expect(get("collapsible")).toMatchObject({ open: false });
        vm.setShowAsText(true);
        expect(vm.getSnapshot().showAsText).toBe(true);
        const graph = create();
        graph.replace({ ...knowledge, revision: 1, status: "submitted" });
        graph.vm.setGraphListMode("cooking", true);
        graph.vm.selectGraphNode("cooking", "maillard");
        graph.vm.activate("button");
        expect(graph.get("cooking")).toMatchObject({ selectedId: null, showAsList: false });
        expect(client.sendMessage).not.toHaveBeenCalled();
    });

    it("should retain media alt text on resolver failure and not open a URL after disposal", async () => {
        const { get } = create(content, {
            mediaResolver: async () => {
                throw new Error("unavailable");
            },
        });
        await Promise.resolve();
        expect(get("image")).toMatchObject({ alt: expect.any(String), src: undefined });
        const confirmation = deferred<boolean>();
        const { vm } = create(controls, { confirmOpenUrl: () => confirmation.promise });
        vm.activate("linkButton");
        vm.dispose();
        confirmation.resolve(true);
        await confirmation.promise;
        expect(window.open).not.toHaveBeenCalled();
    });

    it("should remove event listeners and suppress late sends and media after disposal", async () => {
        const pending = deferred<string | undefined>();
        const { vm, event } = create(content, { mediaResolver: () => pending.promise });
        expect(event.listenerCount(MatrixEventEvent.Replaced)).toBe(1);
        const before = vm.getSnapshot();
        vm.dispose();
        expect(event.listenerCount(MatrixEventEvent.Replaced)).toBe(0);
        expect(event.listenerCount(MatrixEventEvent.BeforeRedaction)).toBe(0);
        pending.resolve("blob:late");
        await pending.promise;
        expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:late");
        expect(vm.getSnapshot()).toBe(before);
        const request = deferred<{ event_id: string }>();
        vi.mocked(client.sendMessage).mockReturnValue(request.promise);
        const other = create(form);
        other.vm.setValue("text_input", "Alice");
        other.vm.submitForm("form");
        other.vm.dispose();
        const snapshot = other.vm.getSnapshot();
        request.resolve({ event_id: "$action" });
        await request.promise;
        await vi.advanceTimersByTimeAsync(9000);
        expect(other.vm.getSnapshot()).toBe(snapshot);
    });
});

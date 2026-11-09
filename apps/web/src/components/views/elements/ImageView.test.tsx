/*
 * Copyright 2024 New Vector Ltd.
 * Copyright 2024 The Matrix.org Foundation C.I.C.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

// @vitest-environment happy-dom

import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, fireEvent, waitFor } from "test-utils-rtl";
import fetchMock from "@fetch-mock/vitest";
import { MatrixEvent, MsgType } from "matrix-js-sdk/src/matrix";
import { stubClient } from "test-utils";

import { MediaEventHelper } from "../../../utils/MediaEventHelper";
import ImageView from "./ImageView";
import { FileDownloader } from "../../../utils/FileDownloader";
import Modal from "../../../Modal";
import ErrorDialog from "../dialogs/ErrorDialog";

vi.mock("../../../utils/FileDownloader");

describe("<ImageView />", () => {
    afterEach(() => {
        vi.resetAllMocks();
    });

    it("navigates mixed media with buttons and arrow keys, stopping previous playback", () => {
        const { getByRole, getByText, container } = render(
            <ImageView
                src="one.png"
                onFinished={vi.fn()}
                items={[
                    { src: "one.png", name: "one.png" },
                    { src: "two.mp4", name: "two.mp4", itemtype: "m.video" },
                    { src: "three.ogg", name: "three.ogg", itemtype: "m.audio" },
                    { src: "four.txt", name: "four.txt", itemtype: "m.file" },
                ]}
            />,
        );
        expect(getByRole("button", { name: "Previous" })).toHaveAttribute("aria-disabled", "true");
        fireEvent.click(getByRole("button", { name: "Next" }));
        expect(getByText("2 of 4")).toBeInTheDocument();
        expect(container.querySelector("video")).toHaveAttribute("src", "two.mp4");
        expect(container.querySelector("img.mx_ImageView_image")).toBeNull();
        expect(container.querySelector('[title="Zoom in"]')).toBeNull();
        const pause = vi.spyOn(container.querySelector("video")!, "pause");
        fireEvent.keyDown(getByRole("dialog"), { key: "ArrowRight" });
        expect(pause).toHaveBeenCalled();
        expect(container.querySelector("video")).toBeNull();
        expect(container.querySelector("audio")).toHaveAttribute("src", "three.ogg");
        fireEvent.keyDown(getByRole("dialog"), { key: "ArrowRight" });
        expect(getByRole("button", { name: "Next" })).toHaveAttribute("aria-disabled", "true");
        expect(container.querySelector(".mx_ImageView_file")).toHaveTextContent("four.txt");
        fireEvent.keyDown(getByRole("dialog"), { key: "ArrowLeft" });
        expect(getByText("3 of 4")).toBeInTheDocument();
    });

    it("starts at the requested image and resets transforms when switching", () => {
        const { getByRole, getByAltText } = render(
            <ImageView
                src="one.png"
                initialIndex={1}
                onFinished={vi.fn()}
                items={[
                    { src: "one.png", name: "one.png" },
                    { src: "two.png", name: "two.png" },
                ]}
            />,
        );
        const image = getByAltText("two.png");
        Object.defineProperties(image, { naturalWidth: { value: 100 }, naturalHeight: { value: 100 } });
        fireEvent.load(image);
        fireEvent.click(getByRole("button", { name: "Rotate Right" }));
        expect(image.style.transform).toContain("rotate(90deg)");
        fireEvent.click(getByRole("button", { name: "Previous" }));
        expect(getByAltText("one.png").style.transform).toContain("rotate(0deg)");
        expect(getByAltText("one.png").style.transform).toContain("translateX(0px)");
    });

    it("downloads the active encrypted item rather than the event's first item", async () => {
        stubClient();
        const first = new MediaEventHelper({ msgtype: MsgType.Image, body: "one.png", url: "mxc://server/one" });
        const second = new MediaEventHelper({
            msgtype: MsgType.Image,
            body: "two.png",
            file: {
                url: "mxc://server/two",
                key: { alg: "A256CTR", ext: true, k: "key", key_ops: ["encrypt", "decrypt"], kty: "oct" },
                iv: "iv",
                hashes: { sha256: "hash" },
                v: "v2",
            },
        });
        const blob = new Blob(["decrypted second"]);
        vi.spyOn(second.sourceBlob, "value", "get").mockResolvedValue(blob);
        const { getByRole } = render(
            <ImageView
                src="blob:one"
                onFinished={vi.fn()}
                items={[
                    { src: "blob:one", name: "one.png", mediaEventHelper: first },
                    { src: "blob:two", name: "two.png", mediaEventHelper: second },
                ]}
            />,
        );
        fireEvent.click(getByRole("button", { name: "Next" }));
        fireEvent.click(getByRole("button", { name: "Download" }));
        await waitFor(() =>
            expect(
                vi
                    .mocked(FileDownloader)
                    .mock.instances.some((instance) =>
                        vi
                            .mocked(instance.download)
                            .mock.calls.some(([arg]) => arg.blob === blob && arg.name === "two.png"),
                    ),
            ).toBe(true),
        );
    });

    it("renders correctly", () => {
        const { container } = render(<ImageView src="https://example.com/image.png" onFinished={vi.fn()} />);
        expect(container).toMatchSnapshot();
    });

    it("should download on click", async () => {
        fetchMock.get("https://example.com/image.png", "TESTFILE");
        const { getByRole } = render(
            <ImageView src="https://example.com/image.png" name="filename.png" onFinished={vi.fn()} />,
        );
        fireEvent.click(getByRole("button", { name: "Download" }));
        await waitFor(() =>
            expect(vi.mocked(FileDownloader).mock.instances[0].download).toHaveBeenCalledWith({
                blob: expect.anything(),
                name: "filename.png",
            }),
        );
        expect(fetchMock).toHaveFetched("https://example.com/image.png");
    });

    it("should use event as download source if given", async () => {
        stubClient();

        const event = new MatrixEvent({
            event_id: "$eventId",
            type: "m.image",
            content: {
                body: "fromEvent.png",
                url: "mxc://test.dummy/fromEvent.png",
                file_name: "filename.png",
            },
            origin_server_ts: new Date(2000, 0, 1, 0, 0, 0, 0).getTime(),
        });

        fetchMock.get("http://this.is.a.url/test.dummy/fromEvent.png", "TESTFILE");
        const { getByRole } = render(
            <ImageView src="https://test.dummy/fromSrc.png" name="fromName.png" onFinished={vi.fn()} mxEvent={event} />,
        );
        fireEvent.click(getByRole("button", { name: "Download" }));
        await waitFor(() =>
            expect(vi.mocked(FileDownloader).mock.instances[0].download).toHaveBeenCalledWith({
                blob: expect.anything(),
                name: "fromEvent.png",
            }),
        );
        expect(fetchMock).toHaveFetched("http://this.is.a.url/test.dummy/fromEvent.png");
    });

    it("should start download on Ctrl+S", async () => {
        fetchMock.get("https://example.com/image.png", "TESTFILE");

        const { container } = render(
            <ImageView src="https://example.com/image.png" name="filename.png" onFinished={vi.fn()} />,
        );

        const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
        dialog?.focus();

        fireEvent.keyDown(dialog!, { key: "s", code: "KeyS", ctrlKey: true });

        await waitFor(() => {
            expect(vi.mocked(FileDownloader).mock.instances[0].download).toHaveBeenCalledWith({
                blob: expect.anything(),
                name: "filename.png",
            });
        });

        expect(fetchMock).toHaveFetched("https://example.com/image.png");
    });

    it("should handle download errors", async () => {
        const modalSpy = vi.spyOn(Modal, "createDialog");
        fetchMock.get("https://example.com/image.png", { status: 500 });
        const { getByRole } = render(
            <ImageView src="https://example.com/image.png" name="filename.png" onFinished={vi.fn()} />,
        );
        fireEvent.click(getByRole("button", { name: "Download" }));
        await waitFor(() =>
            expect(modalSpy).toHaveBeenCalledWith(
                ErrorDialog,
                expect.objectContaining({
                    title: "Download failed",
                }),
            ),
        );
    });
});

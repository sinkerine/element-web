<!--
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
-->

# Developing on NixOS

The repository flake supports `x86_64-linux`. `flake.lock` pins nixpkgs; Node 24 and Corepack provide the pnpm version
specified by the repository. Run commands from this checkout, with the repository dependencies installed.

## Native browser tests

```sh
nix develop
pnpm --config.verifyDepsBeforeRun=false exec playwright install chromium
pnpm --config.verifyDepsBeforeRun=false vitest run apps/web/src/favicon.test.browser.ts
```

The development shell sets `LD_LIBRARY_PATH` with Chromium's runtime libraries, including GLib, NSS, D-Bus, GBM and
udev. Installing these packages with `nix shell` alone does not put their libraries on the downloaded browser's
search path. Playwright continues to use the Chromium version selected by the repository's JavaScript dependencies.

Downloaded Playwright executables also need the standard ELF interpreter provided by NixOS's
`programs.nix-ld.enable = true`. This host already has it enabled. The flake does not change the host configuration.

Vitest defaults to eight workers in this shell to keep browser tests responsive on a shared machine. Override this
with `VITEST_MAX_WORKERS` when needed. The explicit pnpm option above prevents its dependency verification from
triggering an install and Electron postinstall before running a test; install dependencies separately when necessary.

## Full unit suite, including screenshot comparisons

```sh
nix run .#test-unit
```

This runs the prescribed root `pnpm test:unit` script, including its Nx preparation and every configured Vitest
project. It requires a running Docker daemon accessible to the current user. Nix supplies the command's Node,
Corepack, Docker client and other tools; Docker supplies the repository's pinned Playwright 1.64.0 browser image
and fonts. The image is pinned by digest in `flake.nix` and must match the JavaScript Playwright version when updated.

The command starts an ephemeral browser server on a free port bound to `127.0.0.1`, waits for readiness, sets
`PW_TEST_CONNECT_WS_ENDPOINT` and `CI=1`, and takes the shared Git build lock before running the suite. It stops the
container on exit and forwards any arguments to `pnpm test:unit`, for example:

```sh
nix run .#test-unit -- --coverage
```

The native development shell fixes browser startup. Full screenshot verification additionally needs the pinned
browser and fonts: local Storybook runs select `__vis__/local`, while this repository commits Linux baselines.
The test command uses those existing baselines without updating them or excluding tests. It scopes `CI=1` to the
command rather than setting it for every development-shell session.

## Checking the flake

```sh
nix flake check
nix fmt flake.nix
```

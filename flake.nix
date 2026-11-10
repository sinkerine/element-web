# Copyright 2026 sinkerine
#
# SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
# Please see LICENSE in the repository root for full details.
{
  description = "Element Web development and browser tests on NixOS";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { nixpkgs, ... }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs { inherit system; };
      # nix shell only adds executables to PATH. Playwright's downloaded browser
      # also needs these libraries on the dynamic loader's search path.
      browserLibraries = with pkgs; [
        glib
        gtk3
        nss
        nspr
        alsa-lib
        libxkbcommon
        libX11
        libXcomposite
        libXdamage
        libXext
        libXfixes
        libXrandr
        libxcb
        libxshmfence
        libdrm
        libgbm
        mesa
        expat
        at-spi2-core
        dbus
        systemd
        stdenv.cc.cc.lib
      ];
      testUnit = pkgs.writeShellApplication {
        name = "element-web-test-unit";
        runtimeInputs = with pkgs; [
          corepack
          nodejs_24
          docker-client
          git
          util-linux
        ];
        text = ''
          cd "$(git rev-parse --show-toplevel)"
          if [[ $(node -p 'JSON.parse(require("fs").readFileSync("package.json", "utf8")).name') != element-web-monorepo ]]; then
              echo "Run this command inside the Element Web checkout." >&2
              exit 1
          fi

          export npm_config_verify_deps_before_run=false
          export NX_DAEMON=false
          export VITEST_MAX_WORKERS="''${VITEST_MAX_WORKERS:-8}"
          # Select committed Linux baselines and their matching browser/fonts.
          export CI=1
          container=$(docker run --rm -d --shm-size=1g \
              -p 127.0.0.1::3000 -e PORT=3000 \
              ghcr.io/element-hq/element-web/playwright-server@sha256:94c53013f64a536b739cdcbda282b81bf2cb857f380b3a70eed5e6b374c9026d)
          trap 'docker stop "$container" >/dev/null' EXIT
          binding=$(docker port "$container" 3000/tcp)
          export PW_TEST_CONNECT_WS_ENDPOINT="http://127.0.0.1:''${binding##*:}"

          pnpm --config.verifyDepsBeforeRun=false --dir packages/playwright-common exec \
              wait-on "$PW_TEST_CONNECT_WS_ENDPOINT" --timeout 30000
          flock "$(git rev-parse --git-common-dir)/e2e-feature-build.lock" \
              pnpm --config.verifyDepsBeforeRun=false test:unit "$@"
        '';
      };
    in
    {
      devShells.${system}.default = pkgs.mkShell {
        packages = with pkgs; [
          nodejs_24
          corepack
        ];
        shellHook = ''
          export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath browserLibraries}''${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
          export VITEST_MAX_WORKERS="''${VITEST_MAX_WORKERS:-8}"
        '';
      };

      apps.${system}.test-unit = {
        type = "app";
        meta.description = "Run the full unit suite with the pinned screenshot browser";
        program = "${testUnit}/bin/element-web-test-unit";
      };
      formatter.${system} = pkgs.nixfmt;
    };
}

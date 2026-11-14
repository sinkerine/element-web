---
name: deploy-sachi
description: Deploy this Element Web repository to sachi at https://element.mado.moe using its existing Docker Compose service. Use when asked to deploy, update, verify, or roll back Element Web on sachi.
---

<!--
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
-->

# Deploy Element Web to sachi

Use this skill for an explicitly requested deployment or deployment inspection. Writing or editing this skill does not request a deployment. Once deployment is requested, carry out preparation, build, rollout, and verification without another routine approval gate. Do not push Git branches or open a PR.

## Target

These values were verified against the running deployment; recheck them before making changes:

| Item                      | Value                                                                 |
| ------------------------- | --------------------------------------------------------------------- |
| SSH host                  | `sachi` (`sachi.m.mado.moe`, user `sinkerine`)                        |
| Public URL                | `https://element.mado.moe`                                            |
| Compose directory         | `/pool/main/docker/available/element-web`                             |
| Compose file              | `docker-compose.yaml`                                                 |
| Compose project / service | `element-web` / `app`                                                 |
| Container                 | `element-web-app-1`                                                   |
| Live image tag            | `element-web:local`                                                   |
| Existing source           | `/pool/main/docker/available/element-web/source`                      |
| Build Dockerfile / target | `apps/web/Dockerfile` / `element_web`                                 |
| Runtime config            | `persist/config/config.json`, mounted read-only at `/app/config.json` |
| Routing                   | External Docker network `g_proxy`, Traefik, container port 80         |

Preserve the Compose file, runtime config, network, and routing. No host NixOS rebuild or proxy restart is needed. Keep credentials and runtime config contents out of logs.

## Inspect and validate the source

1. Resolve the requested checkout and revision. Default to the current checkout's `HEAD`; do not silently deploy another worktree or the remote default branch. Record the full SHA and `git status --short`.
2. Deploy committed source. If application changes are uncommitted, ask whether to include them or deploy `HEAD`; do not commit or discard them implicitly. If the user explicitly requests committing or merging the current changes before deployment, complete that authorized work and deploy the resulting revision. A pending edit to this documentation alone need not block deployment.
3. Inspect the live container's Compose labels, mounts, image ID, health, and public `/version`. Read the remote Compose file and inspect `git diff` in its existing `source` directory. Use selective `docker inspect --format` output rather than dumping environment variables.
4. Skip test suites during deployment, including unit, Playwright, and browser smoke tests. Do not troubleshoot test environments as part of deployment. Build the candidate and perform the container health and HTTP verification below; a failed build must block rollout. Feature acceptance testing remains part of feature implementation.

Useful read-only commands:

```sh
ssh -o BatchMode=yes -o ConnectTimeout=10 sachi \
    'docker inspect element-web-app-1 --format "{{.Image}} {{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}"'
ssh sachi 'git -C /pool/main/docker/available/element-web/source status --short'
ssh sachi 'git -C /pool/main/docker/available/element-web/source diff -- apps/web/Dockerfile scripts/get-version-from-git.sh'
curl --fail --silent --show-error --max-time 20 https://element.mado.moe/version
```

## Stage an isolated build

Build on sachi. Use a unique release ID such as `<timestamp>-<short SHA>` with only letters, digits, and hyphens. Record the timestamp's timezone; use the current host's system timezone for user-facing reports. Keep build logs and the previous image ID with the deployment evidence.

Create a temporary, standalone local clone of the selected repo using `git clone --no-hardlinks`, then `git checkout -B deploy-sachi <full SHA>` inside that clone. This includes committed source and real Git metadata without the original worktree's `.git` pointer, ignored files, dependencies, or runtime configuration. Transfer the clone with `rsync -a` to a new directory under `/pool/main/docker/available/element-web/releases/<release ID>/source/`. Never rsync with `--delete` into the live Compose directory or its `persist` directory.

A real `.git` directory is required: the Dockerfile bind-mounts it during the build. The `deploy-sachi` branch also makes `scripts/docker-package.sh` use the commit-based version path instead of requiring a matching release tag for detached HEAD.

The existing remote source has two deployment-only fixes. Inspect current source first; apply these to the staged clone only if still needed:

- In `apps/web/Dockerfile`, omit the `RUN ... /src/scripts/docker-link-repos.sh` instruction. Keep the lockfile-pinned Matrix SDK and its patches; relinking upstream `develop` can replace it with an incompatible version. Preserve all other build steps, including the Git mount used by `docker-package.sh`.
- In `scripts/get-version-from-git.sh`, replace the `jq` package-version lookup with `node -p 'require(process.argv[1]).dependencies["matrix-js-sdk"]' "$SCRIPT_DIR/../apps/web/package.json"`. The builder has Node but may lack `jq`.

Record the staged diff. Do not overwrite the existing remote source's modifications or change the user's local checkout to apply these build adaptations. Confirm the staged clone's `HEAD` equals the requested full SHA.

Build a candidate image, substituting the validated release ID below:

```sh
ssh sachi 'docker build \
    --file /pool/main/docker/available/element-web/releases/<release ID>/source/apps/web/Dockerfile \
    --target element_web \
    --tag element-web:candidate-<release ID> \
    /pool/main/docker/available/element-web/releases/<release ID>/source'
```

Run long builds in a way that allows progress updates and retains their exit status. A failed build must leave the running container untouched.

## Roll out and verify

Execute these steps serially, checking each result. Use the existing Compose project explicitly:

1. Record the running container's image ID and tag that ID as `element-web:rollback-<release ID>` **before** replacing `element-web:local`.
2. Tag the successful candidate image as `element-web:local`.
3. Recreate only the app service:

    ```sh
    ssh sachi 'cd /pool/main/docker/available/element-web && docker compose -p element-web -f docker-compose.yaml up -d --no-deps --no-build --pull never --force-recreate app'
    ```

4. Check container state and Docker health with bounded retries. Allow up to three minutes for health, keeping individual waits short enough to report progress. Inspect recent app logs if unhealthy.
5. Verify the running image ID matches the candidate. Check public `/`, `/config.json`, and `/version` with HTTP failures enabled and cache bypassing headers. Validate that config is JSON without printing its contents. Fetch at least one JavaScript bundle referenced by the served index to catch stale HTML or missing assets.
6. Compare the public `/version` with `/app/version` in the container and the expected commit-based build version. The version includes an SDK suffix; an unchanged package version alone is insufficient evidence. Record any failed health or HTTP check accurately.

If rollout or verification fails, tag the saved rollback image as `element-web:local` and repeat the same Compose command. Verify health and the public endpoints again. Report the failed candidate, the error, and whether rollback restored service. Never prune images, delete previous releases, or remove Docker volumes as part of deployment.

Leave the existing `source` directory intact; the active image is built from the recorded release directory. Retain that staged source, build diff, and rollback image for investigation. Remove only the temporary local clone created for this run after transfer succeeds.

Finish with the deployed full SHA, public URL, confirmation that test suites were skipped, candidate and running image IDs, health and HTTP verification, rollback tag, and retained release path. State any deployment-only build adaptations and any verification limits.

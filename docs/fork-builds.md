# Fork builds

This checkout is the keefeere/paseo-app fork of getpaseo/paseo. These rules cover fork test builds. Upstream release docs ([release.md](release.md)) do not apply here.

## Rules

- Start upstreamable features on focused branches from `upstream/main`, so you can open an upstream PR directly from the feature branch. Keep host-specific tooling outside this repository.
- Build only from fork `main`. Merge feature branches into `main` first; never build from a feature branch or a mix of branches.
- Before a build, merge the latest published upstream stable release tag into `main` and resolve conflicts there. Keep fork changes. Do not routinely merge unreleased `upstream/main` into the release track; feature branches can still start there for upstream PRs. Never reset or rewrite existing history to remove previously merged commits.
- Desktop and Docker come from the same commit, so both report the same version.
- Never push a `v*` tag. It starts Desktop Release, Android, Docker and Release Notes Sync.

## Fork changes

See the [fork inventory](fork-inventory.md) for changes, evidence and merge checks. The inventory is still under audit.

The Windows release workflow patch stays out of `main`: build branches carry it by cherry-pick,
so a build branch can differ from `main` beyond the version stamp. Other fork CI and release
changes are present on `main`; see the inventory before comparing build sources.

## Version

`<official stable X.Y.Z>-beta.N`, for example `0.11.2-beta.901`.

- Resolve the latest published, non-draft, non-prerelease release in `getpaseo/paseo`. Use its exact `X.Y.Z`; do not increment the patch or infer the base from fork tags, draft releases, or `upstream/main`.
- Allocate 901, 902, … on that stable line. Restart at 901 only when the official stable version changes. A failed or canceled dispatched build still consumes its number; retries for the same source reuse that build's number.
- Reserve a number with the exact branch `build/v<version>` before dispatch. Inspect remote branches and tags for occupied numbers, including historical branches with feature suffixes. Recheck immediately before pushing; a collision requires replanning, never a force push.
- Historical 998, 999 and 9001 test stamps are legacy, not allocation inputs or official release evidence. New builds use 901–997. If the range is exhausted, stop and revise the policy with the user rather than inventing a version line.
- Name the official upstream tag in the stamp commit message. Desktop and Docker share the stamped commit and version; they do not each increment the counter.
- The release scripts accept only `X.Y.Z` or `X.Y.Z-beta.N` (`scripts/release-version-utils.mjs`), so a `-fork.N` suffix does not work.

`main` keeps its unstamped upstream version. The stamp lives only on the build branch. A stamped version identifies the chosen stable baseline, not proof that the checkout contains no newer commits. Report previously merged unreleased upstream changes when preparing a build.

Existing higher legacy versions can make a build under this policy look like a downgrade. Check the installed Desktop and host-updater versions before deployment. Handle that transition explicitly; do not change the base or counter to satisfy an updater. Preserve historical tags and branches unless the user separately requests cleanup.

## Update feed

`packages/desktop/electron-builder.yml` points to the keefeere/paseo-app release feed. Pointing it at upstream risks replacing the fork with vanilla Paseo when an upstream release is newer. Published fork releases can provide updates; draft releases and unpublished artifacts do not by themselves provide a published feed. Verify the selected channel and release assets before relying on an update.

## Build

1. On a branch from `main`, set the build version, then commit `chore(build): stamp v<version> (upstream <base>)`:
   ```bash
   node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync("package.json"));p.version="<version>";fs.writeFileSync("package.json",JSON.stringify(p,null,2)+"\n")'
   npm run version:sync-internal
   npm install --workspaces --include-workspace-root
   ```
   `version:sync-internal` rewrites every workspace package and every internal `@getpaseo/*` dependency. The install rewrites `package-lock.json`. Commit all of it together: CI uses `npm ci`, which fails when the lock still references the unstamped versions.
2. Push to `build/v<version>`. Non-`main` pushes start no workflows.
3. Desktop: `gh workflow run desktop-release.yml -R keefeere/paseo-app --ref build/v<version> -f tag=v<version> -f platform=linux -f checkout_ref=<sha> -f publish=false`. The AppImage is the `desktop-linux` artifact. Download it with `gh run download <run> -n desktop-linux -D ~/Downloads/paseo-<version>`. Without `-D` it extracts 700 MB into the current directory.
4. Docker: `gh workflow run docker.yml -R keefeere/paseo-app --ref main -f export_image=true -f checkout_ref=<full-sha> -f paseo_version=<version> -f publish=false`. CI exports the standard image from `docker/base/Dockerfile`, without agent CLIs or personal configuration. Download `paseo-image`; verify `SHA256SUMS`, then import the archive with `docker load`. Match its image ID and source commit against `image-metadata.txt`. The metadata ID is the config blob digest from the archive manifest — the ID `docker load` assigns. Docker 28 on the runner reports the manifest digest from `image inspect .Id`, which older daemons never assign, so never verify against a locally inspected ID.
5. Host-specific tools and deployment automation stay on the target host, outside this public repository. Derive the local image from the verified CI base and deploy through the host's container manager, preserving the existing persistent data. An update restarts the daemon and stops its agents. Manual updates need explicit restart approval; enabling a scheduled updater authorizes later updates within that schedule. Run the updater on the host so health checks and rollback survive the agent container's restart.

Check failures on the selected source commit. Do not dismiss a failing CI job based on an older build.

# Fork builds

This checkout is the keefeere/paseo-app fork of getpaseo/paseo. These rules cover fork test builds. Upstream release docs ([release.md](release.md)) do not apply here.

## Rules

- Build only from fork `main`. Merge feature branches into `main` first; never build from a feature branch or a mix of branches.
- Sync upstream into `main` before a build and resolve conflicts there. Fork changes stay.
- Desktop and Docker come from the same commit, so both report the same version.
- Never push a `v*` tag. It starts Desktop Release, Android, Docker and Release Notes Sync.

## Version

`<upstream X.Y.Z>-beta.9NN`, for example `0.11.0-beta.901`.

- `X.Y.Z` is the upstream version line `main` is synced to. If the upstream base is a stable `X.Y.Z`, use `X.Y.(Z+1)`.
- `NN` counts fork builds on that line: 901, 902, … It restarts at 901 when `X.Y.Z` changes. Upstream betas stay far below 900.
- The release scripts accept only `X.Y.Z` or `X.Y.Z-beta.N` (`scripts/release-version-utils.mjs`), so a `-fork.N` suffix does not work.
- Name the upstream base in the stamp commit message.

`main` keeps the upstream version. The stamp lives only on the build branch.

## Update feed

`packages/desktop/electron-builder.yml` publishes to keefeere/paseo-app. The auto-updater downloads any newer release from that feed. Pointed at upstream, it would replace the fork build with vanilla Paseo the first time upstream releases a higher version. The fork publishes no releases, so fork builds see no updates.

## Build

1. On a branch from `main`, set every workspace package to the build version, then commit `chore(build): stamp v<version> (upstream <base>)`. Edit versions with the closing quote included: an unanchored `sed` also rewrites `@xterm/addon-ligatures` `^0.11.0-beta.213`.
2. Push to `build/v<version>`. Non-`main` pushes start no workflows.
3. Desktop: `gh workflow run desktop-release.yml -R keefeere/paseo-app --ref build/v<version> -f tag=v<version> -f platform=linux -f checkout_ref=<sha> -f publish=false`. The AppImage is the `desktop-linux` artifact. Download it with `gh run download <run> -n desktop-linux -D ~/Downloads/paseo-<version>`. Without `-D` it extracts 700 MB into the current directory.
4. Docker: `gh workflow run docker.yml -R keefeere/paseo-app --ref main -f nas_image=true -f checkout_ref=<full-sha> -f paseo_version=<version> -f publish=false`. CI builds the base image and the NAS agent/tool layer from `docker/nas/Dockerfile`. Download `paseo-nas-image`; verify `SHA256SUMS`, then import the archive with `docker load` on the NAS. Match its image ID and source commit against `image-metadata.txt`. Use the immutable `paseo-nas:sha-<full-sha>` tag in Compose. No registry credentials are needed on the NAS.
5. Deploy the image through the Container Manager API. This restarts the daemon and stops every agent running on it, including the one deploying, so get explicit approval and arrange how the result will be checked.

Known failures on fork `main` that are not regressions: Nix Update Hash (missing `app-id` secret), Desktop Packages (`unshare ... uid_map`), CI server-tests.

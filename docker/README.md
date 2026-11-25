# Paseo Docker Image

This directory contains the official Paseo daemon image.

The image runs the daemon headless and serves the bundled web UI from the same
HTTP origin. Start it, then open the daemon URL in a browser.

```bash
docker run -d --name paseo \
  -p 6767:6767 \
  -e PASEO_PASSWORD=change-me \
  -v "$PWD/paseo-home:/home/paseo" \
  -v "$PWD:/workspace" \
  ghcr.io/getpaseo/paseo:latest
```

Then open `http://localhost:6767`.

The base image intentionally does not bundle agent CLIs. Extend it with the
agents you use:

```Dockerfile
FROM ghcr.io/getpaseo/paseo:latest

ENV NPM_PREFIX=/opt/agent-cli
ENV PATH="${NPM_PREFIX}/bin:${PATH}"

USER root
RUN mkdir -p "${NPM_PREFIX}" && chown -R paseo:paseo "${NPM_PREFIX}"

USER paseo
RUN npm install -g --prefix "${NPM_PREFIX}" @openai/codex @anthropic-ai/claude-code

USER root
```

Install into a paseo-writable prefix outside `/home/paseo` so agent CLIs can
self-update from the app. See [docs/docker.md](../docs/docker.md) for details.

See [docs/docker.md](../docs/docker.md) for Compose, reverse proxy, security,
agent auth, and troubleshooting notes.

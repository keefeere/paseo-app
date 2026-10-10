ARG BASE_IMAGE=paseo-custom-base:local
FROM ${BASE_IMAGE}
USER root
RUN npm install -g @anthropic-ai/claude-code @openai/codex opencode-ai @earendil-works/pi-coding-agent \
    && npm cache clean --force
RUN curl -fsSL https://antigravity.google/cli/install.sh -o /tmp/install-agy.sh \
    && bash /tmp/install-agy.sh --dir /usr/local/bin \
    && rm /tmp/install-agy.sh \
    && chmod 755 /usr/local/bin/agy
RUN claude --version && codex --version && opencode --version && agy --version && pi --version

RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv rsync ripgrep jq gh build-essential unzip xz-utils && rm -rf /var/lib/apt/lists/*
RUN usermod --home /home/keefeere paseo && mkdir -p /var/home/keefeere && ln -s /var/home/keefeere /home/keefeere && chown paseo:paseo /var/home/keefeere
ENV HOME=/home/keefeere PASEO_HOME=/home/keefeere/.paseo CODEX_HOME=/home/keefeere/.codex CLAUDE_CONFIG_DIR=/home/keefeere/.claude XDG_CONFIG_HOME=/home/keefeere/.config XDG_DATA_HOME=/home/keefeere/.local/share XDG_STATE_HOME=/home/keefeere/.local/state XDG_CACHE_HOME=/home/keefeere/.cache
ENV PATH=/home/keefeere/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

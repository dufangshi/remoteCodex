FROM node:22-bookworm AS node
FROM rust:1-bookworm
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && apt-get update && apt-get install -y --no-install-recommends python3 ripgrep ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN npm install -g @openai/codex@0.154.0 @agentclientprotocol/codex-acp@1.10.0
RUN curl -fsSL https://x.ai/cli/install.sh -o /tmp/install-grok.sh \
    && bash /tmp/install-grok.sh 1.0.25 && rm /tmp/install-grok.sh
ENV PATH=/root/.grok/bin:/usr/local/cargo/bin:/usr/local/bin:/usr/bin:/bin
WORKDIR /src
CMD ["sleep","infinity"]

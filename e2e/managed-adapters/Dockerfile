FROM pockymoe-thread-e2e:local AS tools
FROM ubuntu:24.04
RUN apt-get update && apt-get install -y --no-install-recommends python3 ca-certificates libssl3 libatomic1 passwd && rm -rf /var/lib/apt/lists/*
COPY --from=tools /usr/local/bin/node /usr/local/bin/node
COPY --from=tools /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
COPY --from=tools /usr/local/lib/node_modules/@openai /usr/local/lib/node_modules/@openai
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm && ln -s ../lib/node_modules/@openai/codex/bin/codex.js /usr/local/bin/codex && useradd -m -u 1101 tester && mkdir -p /home/tester/workspaces /home/tester/.codex && chown -R tester:tester /home/tester
USER tester
ENV HOME=/home/tester CODEX_HOME=/home/tester/.codex POCKYMOE_DATABASE_PATH=/home/tester/db.sqlite POCKYMOE_WORKSPACE_ROOT=/home/tester/workspaces HOST=0.0.0.0 PORT=8787 POCKYMOE_ENABLED_AGENT_PROVIDERS=codex,acp
CMD ["/build/debug/pockymoe", "supervisor"]

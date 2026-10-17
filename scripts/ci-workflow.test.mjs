import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { relative as relativePath } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";

const repoRoot = new URL("../", import.meta.url);
const ciWorkflowPath = new URL(".github/workflows/ci.yml", repoRoot);
const dockerWorkflowPath = new URL(".github/workflows/docker.yml", repoRoot);
const nixWorkflowPath = new URL(".github/workflows/nix.yml", repoRoot);
const filtersPath = new URL(".github/ci-paths.yml", repoRoot);
const serverTsconfigPath = new URL("packages/server/tsconfig.server.json", repoRoot);
const desktopPackagePath = new URL("packages/desktop/package.json", repoRoot);

const gatedCiJobs = new Map([
  ["format", { name: "format", contract: "format" }],
  ["lint", { name: "lint", contract: "quality" }],
  ["typecheck", { name: "typecheck", contract: "quality" }],
  ["server-tests-ubuntu", { name: "server-tests (ubuntu-latest)", contracts: ["server", "hub"] }],
  ["server-tests-windows", { name: "server-tests (windows-latest)", contracts: ["server", "hub"] }],
  ["server-tests-macos", { name: "server-tests (macos-14, file observation)", contract: "server" }],
  ["desktop-tests-ubuntu", { name: "desktop-tests (ubuntu-latest)", contract: "desktop" }],
  ["desktop-tests-windows", { name: "desktop-tests (windows-latest)", contract: "desktop" }],
  ["app-tests", { name: "app-tests", contract: "app" }],
  ["sdk-tests", { name: "sdk-tests", contract: "sdk" }],
  ["playwright-1", { name: "playwright (shard 1/4)", contract: "browser" }],
  ["playwright-2", { name: "playwright (shard 2/4)", contract: "browser" }],
  ["playwright-3", { name: "playwright (shard 3/4)", contract: "browser" }],
  ["playwright-4", { name: "playwright (shard 4/4)", contract: "browser" }],
  ["relay-tests", { name: "relay-tests", contract: "relay" }],
  ["cli-tests-1", { name: "cli-tests (shard 1/3)", contract: "cli" }],
  ["cli-tests-2", { name: "cli-tests (shard 2/3)", contract: "cli" }],
  ["cli-tests-3", { name: "cli-tests (shard 3/3)", contract: "cli" }],
]);

function jobBlocks(source) {
  const jobs = new Map();
  let currentJob;

  for (const line of source.split("\n")) {
    const jobMatch = /^  ([a-z0-9-]+):\s*$/.exec(line);
    if (jobMatch) {
      currentJob = jobMatch[1];
      jobs.set(currentJob, []);
      continue;
    }
    if (currentJob) jobs.get(currentJob).push(line);
  }
  return jobs;
}

function loadFilters(path) {
  const filters = {};
  let currentFilter;

  for (const line of readFileSync(path, "utf8").split("\n")) {
    const filterMatch = /^([a-z_]+):\s*$/.exec(line);
    if (filterMatch) {
      currentFilter = filterMatch[1];
      filters[currentFilter] = [];
      continue;
    }
    const patternMatch = /^  - "([^"]+)"\s*$/.exec(line);
    if (currentFilter && patternMatch) filters[currentFilter].push(patternMatch[1]);
  }
  return filters;
}

function filesUnder(relativeDirectory, predicate) {
  const directory = new URL(`${relativeDirectory}/`, repoRoot);
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      [relativeDirectory, relativePath(directory.pathname, entry.parentPath), entry.name]
        .filter(Boolean)
        .join("/")
        .replaceAll("\\", "/"),
    )
    .filter(predicate)
    .sort();
}

test("gated checks are statically named jobs with real job-level gating", () => {
  const workflowSource = readFileSync(ciWorkflowPath, "utf8");
  const jobs = jobBlocks(workflowSource);
  const trigger = workflowSource.split("jobs:", 1)[0];

  assert.match(trigger, /^\s+merge_group:\s*$/m);
  assert.doesNotMatch(workflowSource, /strategy:\s*\n\s+matrix:/);
  assert.doesNotMatch(workflowSource, /RUN_TESTS|Skip unaffected|No .* changes detected/);

  for (const [jobId, expected] of gatedCiJobs) {
    const job = jobs.get(jobId)?.join("\n");
    assert.ok(job, `missing static job ${jobId}`);
    assert.match(job, new RegExp(`^    name: ${expected.name.replace(/[()]/g, "\\$&")}$`, "m"));
    assert.match(job, /needs\.changes\.outputs\.full != 'false'/);
    for (const contract of expected.contracts ?? [expected.contract]) {
      assert.match(job, new RegExp(`needs\\.changes\\.outputs\\.${contract} != 'false'`));
    }
  }
});

test("change gating allows superseded workflow runs to cancel", () => {
  for (const workflowPath of [ciWorkflowPath, dockerWorkflowPath, nixWorkflowPath]) {
    const source = readFileSync(workflowPath, "utf8");
    assert.doesNotMatch(
      source,
      /\$\{\{\s*always\(\)/,
      "always() keeps jobs alive after concurrency cancellation; use !cancelled() for fail-open gating",
    );
  }
});

test("focused contracts stay inside existing required checks", () => {
  const jobs = jobBlocks(readFileSync(ciWorkflowPath, "utf8"));
  const changes = jobs.get("changes")?.join("\n") ?? "";
  const server = jobs.get("server-tests-ubuntu")?.join("\n") ?? "";
  const desktop = jobs.get("desktop-tests-ubuntu")?.join("\n") ?? "";

  assert.match(changes, /scripts\/daemon-launch-contract\.test\.mjs/);
  assert.doesNotMatch(changes, /Install dependencies|npm run build/);

  assert.match(server, /test:hub-cli-contract/);
  assert.match(server, /npm run test --workspace=@getpaseo\/server/);
  assert.ok(!jobs.has("hub-cli-contract"));

  assert.match(desktop, /test:e2e:renderer/);
  assert.match(desktop, /test:e2e:browser-tabs/);
  assert.match(desktop, /npm run test --workspace=@getpaseo\/desktop/);
  assert.ok(!jobs.has("desktop-browser-bridge"));
  assert.ok(!jobs.has("playwright-desktop"));
});

test("server builds exclude test utilities at every domain depth", () => {
  const tsconfig = JSON.parse(readFileSync(serverTsconfigPath, "utf8"));
  assert.ok(tsconfig.exclude.includes("src/server/**/test-utils/**"));
  assert.ok(!tsconfig.exclude.includes("src/server/test-utils/**"));
});

test("PR routing declares stable behavior ownership", () => {
  const filters = loadFilters(filtersPath);
  assert.deepEqual(filters, {
    routing: [".github/ci-paths.yml"],
    workspace: [
      ".mise.toml",
      ".tool-versions",
      "package.json",
      "package-lock.json",
      "patches/**",
      "scripts/**",
      "tsconfig.json",
      "tsconfig.base.json",
      "vitest.config.ts",
    ],
    ci: [".github/actions/**", ".github/workflows/ci.yml"],
    format: [
      ".agents/**/*.{cjs,css,html,js,json,jsonc,jsx,md,mjs,ts,tsx,yaml,yml}",
      ".github/**/*.{cjs,css,html,js,json,jsonc,jsx,md,mjs,ts,tsx,yaml,yml}",
      "**/*.{cjs,css,html,js,json,jsonc,jsx,md,mjs,ts,tsx,yaml,yml}",
      "packages/expo-two-way-audio/**",
    ],
    quality: ["**/*.{cjs,js,json,jsx,mjs,ts,tsx}", "packages/expo-two-way-audio/**"],
    hub: ["packages/cli/src/commands/hub/**", "packages/server/src/server/hub/**"],
    server: ["plugins/**", "packages/server/**", "packages/app/e2e/support/fixtures/recording.*"],
    desktop: [
      "packages/desktop/**",
      "packages/app/src/desktop/**",
      "packages/server/src/server/browser-tools/**",
      "packages/app/e2e/support/**",
      "packages/app/*config.{cjs,js,ts}",
      "packages/app/package.json",
    ],
    app: ["packages/app/**", "packages/expo-two-way-audio/**"],
    sdk: [
      "packages/plugin/**",
      "plugin-examples/**",
      "public-docs/plugins/**",
      "packages/client/**",
      "packages/highlight/**",
      "packages/protocol/**",
    ],
    browser: [
      "packages/server/src/server/agent/provider-snapshot-manager.ts",
      "packages/server/src/server/session/provider/provider-catalog-session.ts",
      "packages/client/src/compat/normalize-provider-models.ts",
      "packages/protocol/src/client-capabilities.ts",
      "packages/server/src/server/agent/provider-registry.ts",
      "packages/server/src/server/agent/agent-sdk-types.ts",
      "packages/server/src/server/agent/providers/codex-app-server-agent.ts",
      "packages/server/src/server/agent/providers/claude/agent.ts",
      "packages/server/src/server/agent/plugin-provider.ts",
      "packages/server/src/server/plugins/{index,plugin-process,plugin-process-protocol,runtime}.ts",
      "packages/server/src/executable-resolution/**",
      "packages/plugin/src/server/provider.ts",
      "packages/app/src/!(desktop)/**",
      "packages/app/e2e/browser/**",
      "packages/app/e2e/support/**",
      "packages/app/assets/**",
      "packages/app/public/**",
      "packages/app/index.ts",
      "packages/app/*config.{cjs,js,ts}",
      "packages/app/package.json",
    ],
    relay: ["packages/relay/**"],
    cli: ["packages/cli/**"],
  });
});

test("cross-package invariants live in the suite that owns them", () => {
  const cliTests = filesUnder("packages/cli", (path) => path.endsWith(".test.ts"));
  assert.ok(cliTests.length > 0);
  for (const path of cliTests) {
    assert.doesNotMatch(
      readFileSync(new URL(path, repoRoot), "utf8"),
      /server\/src\/server\/test-utils/,
      path,
    );
  }

  const protocolWireCompatibility = new URL(
    "packages/protocol/src/messages.wire-compat.test.ts",
    repoRoot,
  );
  assert.match(readFileSync(protocolWireCompatibility, "utf8"), /wire schema compatibility/);
});

test("browser and desktop tests have exclusive, directory-owned suites", () => {
  const filters = loadFilters(filtersPath);
  const browserSpecs = filesUnder("packages/app/e2e", (path) => path.endsWith(".spec.ts"));
  const desktopSpecs = filesUnder("packages/desktop/e2e", (path) => path.endsWith(".spec.ts"));
  const electronModules = filesUnder("packages/app/src", (path) => /\.electron\.tsx?$/.test(path));

  assert.ok(browserSpecs.length > 0);
  assert.ok(desktopSpecs.length > 0);
  assert.ok(browserSpecs.every((path) => path.startsWith("packages/app/e2e/browser/")));
  assert.ok(desktopSpecs.every((path) => path.startsWith("packages/desktop/e2e/")));
  assert.ok(electronModules.every((path) => path.startsWith("packages/app/src/desktop/")));

  const desktopPackage = JSON.parse(readFileSync(desktopPackagePath, "utf8"));
  assert.match(desktopPackage.scripts.test, /--exclude ["']e2e\/\*\*["']/);

  for (const path of browserSpecs) {
    assert.doesNotMatch(
      readFileSync(new URL(path, repoRoot), "utf8"),
      /paseoDesktop|injectDesktopBridge/,
    );
  }
  for (const path of desktopSpecs) {
    assert.ok(path.startsWith("packages/desktop/e2e/"));
  }

  const routingSource = readFileSync(filtersPath, "utf8");
  assert.doesNotMatch(routingSource, /desktop_bridge|playwright_desktop|browser-\*|browser-\*\//);
  assert.deepEqual(filters.desktop, [
    "packages/desktop/**",
    "packages/app/src/desktop/**",
    "packages/server/src/server/browser-tools/**",
    "packages/app/e2e/support/**",
    "packages/app/*config.{cjs,js,ts}",
    "packages/app/package.json",
  ]);
  assert.deepEqual(filters.browser, [
    "packages/server/src/server/agent/provider-snapshot-manager.ts",
    "packages/server/src/server/session/provider/provider-catalog-session.ts",
    "packages/client/src/compat/normalize-provider-models.ts",
    "packages/protocol/src/client-capabilities.ts",
    "packages/server/src/server/agent/provider-registry.ts",
    "packages/server/src/server/agent/agent-sdk-types.ts",
    "packages/server/src/server/agent/providers/codex-app-server-agent.ts",
    "packages/server/src/server/agent/providers/claude/agent.ts",
    "packages/server/src/server/agent/plugin-provider.ts",
    "packages/server/src/server/plugins/{index,plugin-process,plugin-process-protocol,runtime}.ts",
    "packages/server/src/executable-resolution/**",
    "packages/plugin/src/server/provider.ts",
    "packages/app/src/!(desktop)/**",
    "packages/app/e2e/browser/**",
    "packages/app/e2e/support/**",
    "packages/app/assets/**",
    "packages/app/public/**",
    "packages/app/index.ts",
    "packages/app/*config.{cjs,js,ts}",
    "packages/app/package.json",
  ]);
});

test("packaging runs on main without allocating pull-request runners", () => {
  for (const workflowPath of [dockerWorkflowPath, nixWorkflowPath]) {
    const source = readFileSync(workflowPath, "utf8");
    const trigger = source.split("jobs:", 1)[0];
    assert.match(trigger, /push:\s*\n\s+branches: \[main\]/);
    assert.doesNotMatch(trigger, /pull_request/);
    assert.doesNotMatch(source, /dorny\/paths-filter/);
  }
});

test("desktop packaging smokes main pushes and only the pull requests that touch packaging", () => {
  const source = readFileSync(new URL(".github/workflows/desktop-packages.yml", repoRoot), "utf8");
  const trigger = source.split("jobs:", 1)[0];
  assert.match(trigger, /push:\s*\n\s+branches: \[main\]/);
  assert.match(trigger, /pull_request:\s*\n\s+branches: \[main\]\s*\n\s+paths:/);
  assert.match(trigger, /- "packages\/desktop\/\*\*"/);
  assert.doesNotMatch(source, /dorny\/paths-filter/);
  for (const action of ["actions/checkout", "actions/setup-node", "actions/upload-artifact"]) {
    assert.match(source, new RegExp(`${action}@[0-9a-f]{40} # v\\d+\\.\\d+\\.\\d+`));
  }
});

function evaluateWorkflowExpression(expression, context) {
  return runInNewContext(
    expression
      .replace(/^\$\{\{\s*|\s*\}\}$/g, "")
      .replaceAll("needs.create-release", 'needs["create-release"]'),
    {
      cancelled: () => false,
      always: () => true,
      startsWith: (value, prefix) => value.startsWith(prefix),
      ...context,
    },
  );
}

test("the personal fork skips unused OS runners even for a full CI run", () => {
  const workflows = [
    [ciWorkflowPath, ["server-tests-windows", "server-tests-macos", "desktop-tests-windows"]],
    [
      new URL(".github/workflows/desktop-release.yml", repoRoot),
      ["publish-macos", "publish-windows"],
    ],
  ];
  for (const [workflowPath, ids] of workflows) {
    const jobs = jobBlocks(readFileSync(workflowPath, "utf8"));
    for (const id of ids) {
      const condition = jobs
        .get(id)
        .find((line) => line.startsWith("    if: "))
        .trim()
        .slice(4);
      const context = {
        github: {
          repository: "keefeere/paseo-app",
          event_name: "workflow_dispatch",
          event: { inputs: { platform: "all" } },
        },
        needs: { changes: { outputs: { full: "true" } }, "create-release": { result: "success" } },
      };
      assert.equal(evaluateWorkflowExpression(condition, context), false, id);
      context.github.repository = "getpaseo/paseo";
      assert.equal(evaluateWorkflowExpression(condition, context), true, id);
    }
  }
});

test("fork main pushes route affected contracts while manual CI keeps full coverage", () => {
  const source = readFileSync(ciWorkflowPath, "utf8");
  const expression = source.match(/^      full: (.+)$/m)[1];
  const context = {
    github: { repository: "keefeere/paseo-app", event_name: "push" },
    steps: {
      baseline: { outputs: { known: "true" } },
      filter: { outputs: { routing: "false", workspace: "false", ci: "false" } },
    },
  };
  assert.equal(evaluateWorkflowExpression(expression, context), false);
  context.steps.baseline.outputs.known = "false";
  assert.equal(evaluateWorkflowExpression(expression, context), true);
  context.steps.baseline.outputs.known = "true";
  assert.match(source, /base: \$\{\{ steps\.baseline\.outputs\.base \|\| '' \}\}/);
  assert.match(source, /status=success/);
  assert.match(source, /git merge-base --is-ancestor/);
  context.steps.filter.outputs.workspace = "true";
  assert.equal(evaluateWorkflowExpression(expression, context), true);
  context.steps.filter.outputs.workspace = "false";
  context.github.event_name = "workflow_dispatch";
  assert.equal(evaluateWorkflowExpression(expression, context), true);
  context.github.event_name = "push";
  context.github.repository = "getpaseo/paseo";
  assert.equal(evaluateWorkflowExpression(expression, context), true);
});

test("fork Docker builds allocate runners only for manual runs and tags", () => {
  const jobs = jobBlocks(readFileSync(dockerWorkflowPath, "utf8"));
  const expression = jobs
    .get("setup")
    .find((line) => line.startsWith("    if: "))
    .trim()
    .slice(4);
  const context = {
    github: { repository: "keefeere/paseo-app", event_name: "push", ref: "refs/heads/main" },
  };
  assert.equal(evaluateWorkflowExpression(expression, context), false);
  context.github.event_name = "workflow_dispatch";
  assert.equal(evaluateWorkflowExpression(expression, context), true);
  context.github.event_name = "push";
  context.github.ref = "refs/tags/v0.11.2-beta.907";
  assert.equal(evaluateWorkflowExpression(expression, context), true);
  context.github.ref = "refs/heads/main";
  context.github.repository = "getpaseo/paseo";
  assert.equal(evaluateWorkflowExpression(expression, context), true);
});

test("main routing retains changes from canceled pushes and fails open without a baseline", () => {
  const source = readFileSync(ciWorkflowPath, "utf8");
  const step = source
    .split("      - name: Resolve tested main baseline")[1]
    .split("      - name: Detect affected CI contracts")[0];
  const script = step
    .split("        run: |\n")[1]
    .split("\n")
    .map((line) => line.slice(10))
    .join("\n");
  const cwd = mkdtempSync(`${tmpdir()}/paseo-ci-baseline-`);
  const git = (...args) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  try {
    git("init");
    git("config", "user.name", "CI test");
    git("config", "user.email", "ci@example.invalid");
    const commit = () => {
      git("add", ".");
      git("-c", "commit.gpgsign=false", "commit", "-m", "fixture");
    };
    writeFileSync(`${cwd}/initial`, "tested\n");
    commit();
    const baseline = git("rev-parse", "HEAD");
    writeFileSync(`${cwd}/cli`, "changed by the canceled push\n");
    commit();
    writeFileSync(`${cwd}/app`, "changed by the current push\n");
    commit();
    const output = `${cwd}/outputs`;
    const result = spawnSync(
      "bash",
      ["-euc", 'gh() { printf "%s\\n" "$TEST_BASELINE"; };\n' + script],
      {
        cwd,
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_REPOSITORY: "keefeere/paseo-app",
          GITHUB_OUTPUT: output,
          TEST_BASELINE: baseline,
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(output, "utf8"), `base=${baseline}\nknown=true\n`);
    assert.deepEqual(git("diff", "--name-only", baseline, "HEAD").split("\n"), ["app", "cli"]);
    rmSync(output);
    const unavailable = spawnSync("bash", ["-euc", "gh() { return 1; };\n" + script], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, GITHUB_REPOSITORY: "keefeere/paseo-app", GITHUB_OUTPUT: output },
    });
    assert.equal(unavailable.status, 0, unavailable.stderr);
    assert.equal(readFileSync(output, "utf8"), "known=false\n");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

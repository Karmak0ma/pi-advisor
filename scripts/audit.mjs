import { spawnSync } from "node:child_process";

// Registry outages must not block CI; real findings always must.
const SERVICE_ERROR_PATTERNS = [
  /\b(?:500|502|503|504)\b/,
  /service unavailable/i,
  /bad gateway/i,
  /gateway timeout/i,
  /internal server error/i,
  /fetch failed/i,
  /failed to fetch/i,
  /unable to connect/i,
  /econnrefused/i,
  /econnreset/i,
  /enotfound/i,
  /etimedout/i,
  /eai_again/i,
  /network/i,
  /timed out/i,
  /connection refused/i,
  /socket hang up/i,
];
const FINDING_MARKERS = /vulnerabilit|advisor|severity/i;

const runAudit = () => {
  const result = spawnSync("bun", ["audit", "--audit-level=high"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (output.trim()) {
    process.stdout.write(output.endsWith("\n") ? output : `${output}\n`);
  }
  if (result.status === 0) {
    return;
  }
  // Endpoint URLs contain "advisories" and version-like numbers; classify on message text only.
  const text = output.replace(/https?:\/\/\S+/g, " ");
  const serviceError = SERVICE_ERROR_PATTERNS.some((pattern) =>
    pattern.test(text)
  );
  const reportsFindings = FINDING_MARKERS.test(text);
  if (serviceError && !reportsFindings) {
    console.warn(
      "bun audit could not reach the registry (service error) — failing open. Re-run scripts/audit.mjs manually once the registry is healthy."
    );
    return;
  }
  process.exit(result.status ?? 1);
};

runAudit();

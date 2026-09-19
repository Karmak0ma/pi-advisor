import {
  type AdvisorUsageTotals,
  addAdvisorUsage,
  emptyAdvisorUsageTotals,
  formatAdvisorUsageStatus,
  formatAdvisorUsageTotals,
  formatTokenCount,
} from "./usage.ts";

export type GateDecision = "proceed" | "revise" | "blocked";
export type ConsultationTrigger = "manual" | "executor-requested" | "turn-gate";
export type GateTrigger =
  | "repeated-tool-call"
  | "completion-review"
  | "custom-rule";
type AdvisorTrigger = ConsultationTrigger | GateTrigger;
type ExecutionEffect = "continued" | "tool-blocked" | "session-blocked";

export interface AdvisorInvocationRecord {
  cost?: number;
  decision?: GateDecision;
  executionEffect: ExecutionEffect;
  failure?: string;
  kind: "markdown" | "gate";
  model: string;
  trigger: AdvisorTrigger;
  usage?: unknown;
}

const WHITESPACE = /\s/;
const TIMESTAMP_KEYS = new Set([
  "createdat",
  "date",
  "datetime",
  "time",
  "timestamp",
  "updatedat",
]);
const REQUEST_ID_KEYS = new Set(["correlationid", "requestid", "traceid"]);
const normalizedKey = (key: string) => key.replace(/[-_]/g, "").toLowerCase();
const isVolatileKey = (key: string, keys: Set<string>) =>
  keys.has(normalizedKey(key));

const normalizeShellWhitespace = (command: string) => {
  let result = "";
  let quote: "'" | '"' | "`" | undefined;
  let pendingSpace = false;
  for (const char of command.trim()) {
    if (quote) {
      result += char;
      if (char === quote) {
        quote = undefined;
      }
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      if (pendingSpace && result) {
        result += " ";
      }
      pendingSpace = false;
      quote = char;
      result += char;
    } else if (WHITESPACE.test(char)) {
      pendingSpace = true;
    } else {
      if (pendingSpace && result) {
        result += " ";
      }
      pendingSpace = false;
      result += char;
    }
  }
  return result;
};

const normalizeString = (value: string) =>
  value
    .replace(/\/(?:private\/)?tmp\/[^\s/]+/g, "/tmp/<temporary>")
    .replace(/\/var\/folders\/[^\s/]+/g, "/var/folders/<temporary>");

export const normalizeToolInput = (
  toolName: string,
  input: unknown
): unknown => {
  const visit = (value: unknown, key?: string): unknown => {
    if (typeof value === "string") {
      if (key && isVolatileKey(key, TIMESTAMP_KEYS)) {
        return "<timestamp>";
      }
      if (key && isVolatileKey(key, REQUEST_ID_KEYS)) {
        return "<request-id>";
      }
      const normalized = normalizeString(value);
      return toolName === "bash" && key === "command"
        ? normalizeShellWhitespace(normalized)
        : normalized;
    }
    if (Array.isArray(value)) {
      return value.map((item) => visit(item));
    }
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(record)
          .sort()
          .map((childKey) => [childKey, visit(record[childKey], childKey)])
      );
    }
    return value;
  };
  return visit(input);
};

export const normalizedToolSignature = (toolName: string, input: unknown) =>
  `${toolName}:${JSON.stringify(normalizeToolInput(toolName, input))}`;

interface RepetitionState {
  count: number;
  interventions: number;
  previousSignature?: string;
}

export interface AdvisorJevUsageTotals {
  cost: number;
  inputTokens: number;
  outputTokens: number;
}

export interface AdvisorJevFilterLedger {
  allowed: number;
  failures: number;
  overrides: number;
  repeatSkipped: number;
  screened: number;
  skipped: number;
}

export interface AdvisorJevGateLedger {
  checks: number;
  consultations: number;
  failures: number;
  usage: AdvisorJevUsageTotals;
}

export interface AdvisorJevLedger {
  filter: AdvisorJevFilterLedger;
  gate: AdvisorJevGateLedger;
  usage: AdvisorJevUsageTotals;
}

export interface AdvisorJevUsage {
  cost: number;
  inputTokens: number;
  outputTokens: number;
}

const freshJevUsage = (): AdvisorJevUsageTotals => ({
  cost: 0,
  inputTokens: 0,
  outputTokens: 0,
});

const freshJevLedger = (): AdvisorJevLedger => ({
  filter: {
    allowed: 0,
    failures: 0,
    overrides: 0,
    repeatSkipped: 0,
    screened: 0,
    skipped: 0,
  },
  gate: { checks: 0, consultations: 0, failures: 0, usage: freshJevUsage() },
  usage: freshJevUsage(),
});

export const addJevUsage = (
  totals: AdvisorJevUsageTotals,
  usage: AdvisorJevUsage
) => {
  totals.cost += usage.cost;
  totals.inputTokens += usage.inputTokens;
  totals.outputTokens += usage.outputTokens;
};

interface AdviceLedger {
  draftConsultations: number;
  issued: Map<
    string,
    {
      advice: string;
      normalizedQuestion?: string;
      trigger: ConsultationTrigger;
    }
  >;
  lastAdvice?: string;
  outcomes: number;
  pending: Set<string>;
  reported: Set<string>;
}

interface UsageState {
  invocations: AdvisorInvocationRecord[];
  totals: AdvisorUsageTotals;
}

const freshRepetition = (): RepetitionState => ({
  count: 0,
  interventions: 0,
});
const freshAdviceLedger = (): AdviceLedger => ({
  draftConsultations: 0,
  issued: new Map(),
  outcomes: 0,
  pending: new Set(),
  reported: new Set(),
});
const freshUsage = (): UsageState => ({
  invocations: [],
  totals: emptyAdvisorUsageTotals(),
});

export class AdvisorSessionState {
  #repetition = freshRepetition();
  #blockedReason?: string;
  #ledger = freshAdviceLedger();
  #usage = freshUsage();
  #consumedCalls = 0;
  #jev = freshJevLedger();
  #sessionTurnOrdinal = 0;
  #turnsSinceConsultation = 0;
  #lastSkip: { normalizedQuestion?: string; turn: number } | undefined;

  resetTask() {
    this.#repetition = freshRepetition();
    this.#blockedReason = undefined;
    this.#ledger = freshAdviceLedger();
    this.#usage = freshUsage();
    this.#consumedCalls = 0;
    this.#jev = freshJevLedger();
    this.#sessionTurnOrdinal = 0;
    this.#turnsSinceConsultation = 0;
    this.#lastSkip = undefined;
  }

  clearBlocked() {
    this.#blockedReason = undefined;
  }
  resetRepetition() {
    // Cumulative interventions feed the session summary and must survive this reset.
    this.#repetition.count = 0;
    this.#repetition.previousSignature = undefined;
  }
  get blocked() {
    return this.#blockedReason !== undefined;
  }
  get blockedReason() {
    return this.#blockedReason;
  }
  block(reason: string) {
    this.#blockedReason ??= reason;
  }

  recordToolCall(toolName: string, input: unknown, threshold: number) {
    if (toolName === "ask_advisor") {
      return false;
    }
    const signature = normalizedToolSignature(toolName, input);
    this.#repetition.count =
      signature === this.#repetition.previousSignature
        ? this.#repetition.count + 1
        : 1;
    this.#repetition.previousSignature = signature;
    if (this.#repetition.count < threshold) {
      return false;
    }
    this.#repetition.interventions += 1;
    return true;
  }

  canConsult(limit: number | undefined) {
    return limit === undefined || this.#consumedCalls < limit;
  }
  consumeCall() {
    this.#consumedCalls += 1;
  }
  remainingCalls(limit: number | undefined) {
    return limit === undefined
      ? undefined
      : Math.max(0, limit - this.#consumedCalls);
  }
  get consumedCalls() {
    return this.#consumedCalls;
  }

  /** Counts one completed executor turn on both turn counters. The ordinal
   * feeds the filter override window and summary positions and is never reset
   * by anything; turnsSinceConsultation resets on every consultation. */
  recordCompletedTurn() {
    this.#sessionTurnOrdinal += 1;
    this.#turnsSinceConsultation += 1;
  }

  resetTurnsSinceConsultation() {
    this.#turnsSinceConsultation = 0;
  }

  get sessionTurnOrdinal() {
    return this.#sessionTurnOrdinal;
  }

  get turnsSinceConsultation() {
    return this.#turnsSinceConsultation;
  }

  /** Returns a copy of cumulative direct Advisor usage for this session. */
  get usageTotals(): AdvisorUsageTotals {
    return { ...this.#usage.totals };
  }

  /** Returns the footer-ready direct Advisor usage status for this session. */
  usageStatus() {
    return formatAdvisorUsageStatus(this.#usage.totals);
  }

  recordInvocation(record: AdvisorInvocationRecord) {
    this.#usage.invocations.push(record);
    addAdvisorUsage(this.#usage.totals, record.usage);
  }
  issueAdvice(
    id: string,
    advice: string,
    trigger: ConsultationTrigger,
    draft = false,
    normalizedQuestion?: string
  ) {
    this.#ledger.issued.set(id, {
      advice,
      ...(normalizedQuestion ? { normalizedQuestion } : {}),
      trigger,
    });
    this.#ledger.lastAdvice = advice;
    if (draft) {
      this.#ledger.draftConsultations += 1;
    }
  }

  /** Returns earlier advice for an exactly-matching normalized question. */
  reattachedAdviceFor(
    normalizedQuestion: string | undefined
  ): string | undefined {
    if (!normalizedQuestion) {
      return undefined;
    }
    for (const entry of this.#ledger.issued.values()) {
      if (entry.normalizedQuestion === normalizedQuestion) {
        return entry.advice;
      }
    }
    return undefined;
  }
  claimTrackedFiles(paths: string[]) {
    const advice = this.#ledger.lastAdvice;
    if (!advice || paths.length === 0) {
      return false;
    }
    const mentioned = paths.every((path) => {
      const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const boundary =
        "(^|[\\s\\\"'`()\\[])" +
        escaped +
        "(?=$|[\\s\\\"'`),;:!?\\]]|\\.(?=\\s|$))";
      return new RegExp(boundary).test(advice);
    });
    if (!mentioned) {
      return false;
    }
    this.#ledger.lastAdvice = undefined;
    return true;
  }

  reserveAdvice(id: string) {
    if (this.#ledger.reported.has(id) || this.#ledger.pending.has(id)) {
      return;
    }
    const advice = this.#ledger.issued.get(id);
    if (!advice) {
      return;
    }
    this.#ledger.pending.add(id);
    return advice;
  }

  commitAdvice(id: string) {
    if (!this.#ledger.pending.delete(id)) {
      return false;
    }
    this.#ledger.reported.add(id);
    this.#ledger.outcomes += 1;
    return true;
  }

  releaseAdvice(id: string) {
    this.#ledger.pending.delete(id);
  }

  /** Compatibility helper for synchronous callers that can commit immediately. */
  claimAdvice(id: string) {
    const advice = this.reserveAdvice(id);
    if (!advice) {
      return;
    }
    this.commitAdvice(id);
    return advice;
  }

  #decisionsLine() {
    const gates = this.#usage.invocations.filter(
      (item) => item.kind === "gate"
    );
    return (
      (["proceed", "revise", "blocked"] as GateDecision[])
        .map(
          (decision) =>
            [
              decision,
              gates.filter((item) => item.decision === decision).length,
            ] as const
        )
        .filter(([, count]) => count > 0)
        .map(([decision, count]) => `${count} ${decision}`)
        .join(", ") || "none"
    );
  }

  #countTrigger(trigger: AdvisorTrigger) {
    return this.#usage.invocations.filter((item) => item.trigger === trigger)
      .length;
  }

  #triggersLine() {
    return (
      [
        "manual",
        "executor-requested",
        "turn-gate",
        "repeated-tool-call",
        "completion-review",
        "custom-rule",
      ]
        .filter((trigger) => this.#countTrigger(trigger as AdvisorTrigger) > 0)
        .join(", ") || "none"
    );
  }

  recordJevFilterAllowed() {
    this.#jev.filter.allowed += 1;
    this.#jev.filter.screened += 1;
  }
  recordJevFilterSkipped(repeat: boolean, normalizedQuestion?: string) {
    this.#jev.filter.skipped += 1;
    this.#jev.filter.screened += 1;
    if (repeat) {
      this.#jev.filter.repeatSkipped += 1;
    }
    this.#lastSkip = {
      ...(normalizedQuestion ? { normalizedQuestion } : {}),
      turn: this.#sessionTurnOrdinal,
    };
  }
  get lastJevSkip() {
    return this.#lastSkip;
  }
  recordJevFilterOverride() {
    this.#jev.filter.overrides += 1;
  }
  recordJevFilterFailure() {
    this.#jev.filter.failures += 1;
  }
  recordJevFilterUsage(usage: AdvisorJevUsage) {
    addJevUsage(this.#jev.usage, usage);
  }

  recordJevGateCheck(usage?: AdvisorJevUsage) {
    this.#jev.gate.checks += 1;
    if (usage) {
      addJevUsage(this.#jev.gate.usage, usage);
    }
  }
  recordJevGateConsultation() {
    this.#jev.gate.consultations += 1;
  }
  recordJevGateFailure() {
    this.#jev.gate.failures += 1;
  }

  #jevFilterActive() {
    const { filter } = this.#jev;
    return filter.screened > 0 || filter.overrides > 0 || filter.failures > 0;
  }

  #savingsLine(markdownCosts: number[], skipped: number) {
    if (markdownCosts.length === 0) {
      return "Estimated saving from skips: unavailable — no observed consultation cost this session";
    }
    const mean =
      markdownCosts.reduce((sum, cost) => sum + cost, 0) / markdownCosts.length;
    return `Estimated saving from skips: ≤ $${(mean * skipped).toFixed(4)} — upper bound; assumes each skipped consultation would have cost this session's mean allowed-consultation cost ($${mean.toFixed(4)}), which the skipped calls would likely have undercut`;
  }

  #gateLine(gate: AdvisorJevGateLedger) {
    const consultationCosts = this.#usage.invocations
      .filter(
        (item): item is AdvisorInvocationRecord & { cost: number } =>
          item.trigger === "turn-gate" && typeof item.cost === "number"
      )
      .map((item) => item.cost);
    const gateSpend = consultationCosts.reduce((sum, cost) => sum + cost, 0);
    return `Turn gate: ${gate.checks} check${gate.checks === 1 ? "" : "s"} (Jev ${this.#formatJevTokens(gate.usage)} · $${gate.usage.cost.toFixed(4)}), ${gate.consultations} consultation${gate.consultations === 1 ? "" : "s"} ($${gateSpend.toFixed(4)})`;
  }

  #formatJevTokens(usage: AdvisorJevUsageTotals) {
    return `↑${formatTokenCount(usage.inputTokens + usage.outputTokens)}`;
  }

  #jevSummaryLines() {
    const lines: string[] = [];
    const { filter, gate, usage } = this.#jev;
    if (this.#jevFilterActive()) {
      lines.push(this.#filterLine(filter));
      const jevTokens = usage.inputTokens + usage.outputTokens;
      if (jevTokens > 0) {
        lines.push(
          `Jev cost: ${this.#formatJevTokens(usage)} tokens · $${usage.cost.toFixed(4)} (input only; output free)`
        );
      }
      if (filter.skipped > 0) {
        lines.push(this.#savingsLine(this.#markdownCosts(), filter.skipped));
      }
    }
    if (gate.checks > 0 || gate.consultations > 0) {
      lines.push(this.#gateLine(gate));
    }
    return lines;
  }

  #markdownCosts(): number[] {
    return this.#usage.invocations
      .filter(
        (item): item is AdvisorInvocationRecord & { cost: number } =>
          item.kind === "markdown" && typeof item.cost === "number"
      )
      .map((item) => item.cost);
  }

  #filterLine(filter: AdvisorJevFilterLedger) {
    const head = `${filter.screened} screened (${filter.allowed} allowed, ${filter.skipped} skipped${filter.repeatSkipped > 0 ? ` [${filter.repeatSkipped} repeat]` : ""})`;
    const parts = [head];
    if (filter.overrides > 0) {
      parts.push(
        `${filter.overrides} override${filter.overrides === 1 ? "" : "s"}`
      );
    }
    if (filter.failures > 0) {
      parts.push(
        `${filter.failures} failure${filter.failures === 1 ? "" : "s"}`
      );
    }
    return `Jev filter: ${parts.join(", ")}`;
  }

  summary(limit: number | undefined) {
    const { invocations, totals } = this.#usage;
    const jevLines = this.#jevSummaryLines();
    if (
      invocations.length === 0 &&
      this.#repetition.interventions === 0 &&
      jevLines.length === 0
    ) {
      return;
    }
    const markdown = invocations.filter((item) => item.kind === "markdown");
    const gates = invocations.filter((item) => item.kind === "gate");
    const effects = (effect: ExecutionEffect) =>
      invocations.filter((item) => item.executionEffect === effect).length;
    const failures = invocations
      .filter((item) => item.failure)
      .map((item) => item.failure);
    const models =
      [...new Set(invocations.map((item) => item.model).filter(Boolean))].join(
        ", "
      ) || "unknown";
    const budget =
      limit === undefined
        ? `${this.#consumedCalls} used; unlimited remaining`
        : `${this.#consumedCalls} / ${limit} used; ${Math.max(0, limit - this.#consumedCalls)} remaining`;
    return [
      "[Session Advisor Summary]",
      `Consultations: ${markdown.length} Markdown (${this.#countTrigger("manual")} manual, ${this.#countTrigger("executor-requested")} executor-requested), automatic gates: ${gates.length}`,
      `Triggers: ${this.#triggersLine()}`,
      `Models: ${models}`,
      `Budget: ${budget}`,
      `Usage: ${formatAdvisorUsageTotals(totals)}`,
      `Markdown advice: ${markdown.length} responses (${this.#ledger.draftConsultations} with drafts)`,
      `Outcome reports: ${this.#ledger.outcomes}`,
      `Gate decisions: ${this.#decisionsLine()}`,
      `Loop matching: normalized tool signatures; ${this.#repetition.interventions} gate intervention${this.#repetition.interventions === 1 ? "" : "s"}`,
      `Execution effects: ${effects("tool-blocked")} tool blocked, ${effects("session-blocked")} sessions blocked, ${effects("continued")} continued`,
      `Failures: ${failures.length ? failures.join(", ") : "none"}`,
      ...jevLines,
    ].join("\n");
  }
}

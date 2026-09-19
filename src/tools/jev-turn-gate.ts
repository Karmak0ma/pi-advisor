import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Fetch } from "@typesafe-ai/sdk";
import {
  advisorJevModelRef,
  advisorJevTimeoutMsRef,
  advisorJevTurnGateEveryTurnsRef,
  advisorJevTurnGateNoulThresholdRef,
  getAdvisorMaxCallsPerSession,
  isSimpleMode,
} from "../config/state.ts";
import { herdrAdvisorActivity } from "../herdr.ts";
import { JevClient, JevFailure } from "../jev/client.ts";
import { composeTurnGateVerdict } from "../jev/questions.ts";
import { buildJevState } from "../jev/state.ts";
import { type JevCredentials, resolveJevTransport } from "../jev/transport.ts";
import type { AdvisorSessionState } from "../session-state.ts";
import { advisorUsageCost } from "../usage.ts";
import type { consultAdvisor } from "./consultation.ts";
import { updateAdvisorUsageStatus } from "./gate-policy.ts";

export const turnGateQuestion = {
  criteria: {
    false:
      "The executor is progressing soundly on work that matches the user's intent; interrupting would add nothing material.",
    true: "The executor is approaching a material decision, repeating a failure, about to claim success without validation, or drifting from the user's intent; a second opinion now would change what happens next.",
  },
  instructions:
    "Should a senior engineering advisor be consulted right now, before the executor continues? Judge from `recent_conversation`.",
  type: "noul",
} as const;

export interface JevTurnGateDeps {
  consult?: typeof consultAdvisor;
  fetch?: Fetch;
  resolveTransport?: () => Promise<JevCredentials | undefined>;
}

export interface JevTurnGateRegistration {
  activeTools: () => string[];
  consult: typeof consultAdvisor;
  deps?: JevTurnGateDeps;
  send: (message: {
    content: string;
    customType: string;
    details: Record<string, unknown>;
    display: boolean;
  }) => void;
  session: AdvisorSessionState;
}

let lastNotifiedOutage: string | undefined;

const notifyFailureOnce = (
  ctx: ExtensionContext,
  category: string,
  message: string
) => {
  const key = `${category}:${message}`;
  if (key === lastNotifiedOutage) {
    return;
  }
  lastNotifiedOutage = key;
  if (ctx.hasUI) {
    ctx.ui.notify(
      `Advisor Jev turn gate failed (${category}); continuing without a proactive consultation. ${message}`,
      "warning"
    );
  }
};

/** Test-only: re-arms the once-per-outage notification. */
export const resetJevTurnGateNotification = () => {
  lastNotifiedOutage = undefined;
};

/**
 * turn_end handler: counts turns without a consultation and, every Nth such
 * turn, asks Jev whether the Advisor should proactively weigh in. Confident
 * true runs a real consultation delivered as a steer message; everything else
 * keeps the status quo.
 */
export const handleJevTurnEnd = async (
  registration: JevTurnGateRegistration,
  ctx: ExtensionContext
): Promise<void> => {
  const { session } = registration;
  session.recordCompletedTurn();
  const interval = advisorJevTurnGateEveryTurnsRef;
  if (
    interval <= 0 ||
    session.turnsSinceConsultation <= 0 ||
    session.turnsSinceConsultation % interval !== 0
  ) {
    return;
  }
  if (
    isSimpleMode() ||
    session.blocked ||
    !registration.activeTools().includes("ask_advisor") ||
    !session.canConsult(getAdvisorMaxCallsPerSession())
  ) {
    return;
  }

  const consult = registration.deps?.consult ?? registration.consult;
  const deps = registration.deps ?? {};
  try {
    const credentials = await (deps.resolveTransport ?? resolveJevTransport)(
      ctx
    );
    if (!credentials) {
      session.recordJevGateFailure();
      notifyFailureOnce(
        ctx,
        "missing-key",
        "No Jev credentials resolved (no TypeSafe key and no OpenRouter login)."
      );
      return;
    }
    const client = new JevClient({
      apiKey: credentials.apiKey,
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
      model: advisorJevModelRef,
      timeoutMs: advisorJevTimeoutMsRef,
      transport: credentials.transport,
    });
    const result = await client.ask(buildJevState(ctx, {}), {
      should_consult: turnGateQuestion,
    });
    session.recordJevGateCheck(result.usage);
    const shouldConsult = composeTurnGateVerdict(
      result.answers,
      advisorJevTurnGateNoulThresholdRef
    );
    if (!shouldConsult) {
      return;
    }

    session.consumeCall();
    herdrAdvisorActivity.start();
    registration.send({
      content: "Proactive Advisor turn review",
      customType: "advisor-turn-gate-call",
      details: {
        question: `Turn gate: ${session.turnsSinceConsultation} turns without a consultation`,
        turn: session.sessionTurnOrdinal,
      },
      display: true,
    });
    try {
      const consulted = await consult(
        ctx,
        undefined,
        ctx.signal,
        undefined,
        "turn-gate"
      );
      session.recordJevGateConsultation();
      session.resetTurnsSinceConsultation();
      session.recordInvocation({
        cost: advisorUsageCost(consulted.usage),
        executionEffect: "continued",
        kind: "markdown",
        model: consulted.model,
        trigger: "turn-gate",
        usage: consulted.usage,
      });
      updateAdvisorUsageStatus(ctx, session);
      registration.send({
        content: consulted.markdown,
        customType: "advisor-turn-gate-result",
        details: {
          advisor: consulted.model,
          text: consulted.markdown,
          usage: consulted.usage,
        },
        display: true,
      });
    } finally {
      herdrAdvisorActivity.finish();
    }
  } catch (error) {
    session.recordJevGateFailure();
    if (error instanceof JevFailure) {
      notifyFailureOnce(ctx, error.category, error.message);
    } else if (!ctx.signal?.aborted) {
      notifyFailureOnce(
        ctx,
        "error",
        error instanceof Error ? error.message : String(error)
      );
    }
  }
};

/** Wires the turn_end handler on an ExtensionAPI-like surface. */
export const registerJevTurnGate = <T extends string>(
  on: (
    event: T,
    handler: (event: unknown, ctx: ExtensionContext) => unknown
  ) => void,
  registration: JevTurnGateRegistration
): void => {
  on("turn_end" as T, (_event, ctx) => handleJevTurnEnd(registration, ctx));
};

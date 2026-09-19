import {
  setAdvisorAutoLoopGateRef,
  setAdvisorBlockOnBlockedRef,
  setAdvisorCollapseResponsesRef,
  setAdvisorCompletionGateRef,
  setAdvisorCustomInvocationRef,
  setAdvisorEffortRef,
  setAdvisorFailureGateRef,
  setAdvisorFailureModeRef,
  setAdvisorGitContextMaxCharsRef,
  setAdvisorGitContextRef,
  setAdvisorHerdrIntegrationRef,
  setAdvisorJevDigestMaxCharsRef,
  setAdvisorJevModelRef,
  setAdvisorJevPricePerMtokRef,
  setAdvisorJevTimeoutMsRef,
  setAdvisorJevTransportRef,
  setAdvisorLoopThresholdRef,
  setAdvisorMaxCallsPerSessionRef,
  setAdvisorOutcomeLoggingRef,
  setAdvisorPlanGateRef,
  setAdvisorRedactSecretsRef,
  setAdvisorRef,
  setAdvisorScoutEnabledRef,
  setAdvisorSessionSummaryRef,
  setAdvisorToolPoliciesRef,
  setAdvisorToolResultMaxBytesRef,
  setAdvisorToolResultMaxLinesRef,
  setAdvisorTrackedFileContentRef,
  setAdvisorUntrackedContentRef,
  setAlwaysOnRef,
  setContextMaxCharsRef,
  setExecutorEffortRef,
  setExecutorRef,
  setPersistedModelRefs,
  setShowUsageDetailsRef,
  setShowUsageFooterRef,
  setSimpleModeRef,
} from "./state.ts";
import type { AdvisorConfig } from "./types.ts";
import {
  DEFAULT_ADVISOR_GIT_CONTEXT_MAX_CHARS,
  DEFAULT_ADVISOR_TOOL_RESULT_MAX_BYTES,
  DEFAULT_ADVISOR_TOOL_RESULT_MAX_LINES,
  DEFAULT_CONTEXT_MAX_CHARS,
  DEFAULT_JEV_DIGEST_MAX_CHARS,
  DEFAULT_JEV_MODEL,
  DEFAULT_JEV_PRICE_PER_MTOK,
  DEFAULT_JEV_TIMEOUT_MS,
} from "./types.ts";

export const resetDefaults = () => {
  setExecutorRef("");
  setAdvisorRef("");
  setPersistedModelRefs(undefined, undefined);
  setExecutorEffortRef(undefined);
  setAdvisorEffortRef(undefined);
  setContextMaxCharsRef(DEFAULT_CONTEXT_MAX_CHARS);
  setAdvisorPlanGateRef(true);
  setAdvisorFailureGateRef(true);
  setAdvisorCompletionGateRef(true);
  setAdvisorCustomInvocationRef(undefined);
  setAdvisorCollapseResponsesRef(false);
  setAdvisorBlockOnBlockedRef(true);
  setAdvisorAutoLoopGateRef(true);
  setAdvisorLoopThresholdRef(3);
  setAdvisorMaxCallsPerSessionRef(undefined);
  setAdvisorSessionSummaryRef(false);
  setSimpleModeRef(false);
  setAlwaysOnRef(false);
  setAdvisorFailureModeRef("block-session");
  setAdvisorHerdrIntegrationRef(true);
  setAdvisorJevModelRef(DEFAULT_JEV_MODEL);
  setAdvisorJevTimeoutMsRef(DEFAULT_JEV_TIMEOUT_MS);
  setAdvisorJevDigestMaxCharsRef(DEFAULT_JEV_DIGEST_MAX_CHARS);
  setAdvisorJevPricePerMtokRef(DEFAULT_JEV_PRICE_PER_MTOK);
  setAdvisorJevTransportRef("auto");
  setAdvisorToolResultMaxLinesRef(DEFAULT_ADVISOR_TOOL_RESULT_MAX_LINES);
  setAdvisorToolResultMaxBytesRef(DEFAULT_ADVISOR_TOOL_RESULT_MAX_BYTES);
  setAdvisorRedactSecretsRef(false);
  setAdvisorGitContextRef("summary");
  setAdvisorGitContextMaxCharsRef(DEFAULT_ADVISOR_GIT_CONTEXT_MAX_CHARS);
  setAdvisorToolPoliciesRef({});
  setAdvisorOutcomeLoggingRef(false);
  setAdvisorUntrackedContentRef(false);
  setAdvisorTrackedFileContentRef(false);
  setAdvisorScoutEnabledRef(false);
  setShowUsageDetailsRef(true);
  setShowUsageFooterRef(false);
};

const applyOptionalConfig = <Key extends keyof AdvisorConfig>(
  config: AdvisorConfig,
  key: Key,
  apply: (value: NonNullable<AdvisorConfig[Key]>) => void
) => {
  const value = config[key];
  if (value !== undefined) {
    apply(value as NonNullable<AdvisorConfig[Key]>);
  }
};

const applyNonEmptyStringConfig = (
  value: string | undefined,
  apply: (value: string) => void
) => {
  if (value) {
    apply(value);
  }
};

export const applyConfig = (config: AdvisorConfig) => {
  applyNonEmptyStringConfig(config.executor, setExecutorRef);
  applyNonEmptyStringConfig(config.advisor, setAdvisorRef);
  applyNonEmptyStringConfig(config.executorEffort, setExecutorEffortRef);
  applyNonEmptyStringConfig(config.advisorEffort, setAdvisorEffortRef);
  applyOptionalConfig(config, "contextMaxChars", setContextMaxCharsRef);
  applyOptionalConfig(config, "advisorPlanGate", setAdvisorPlanGateRef);
  applyOptionalConfig(config, "advisorFailureGate", setAdvisorFailureGateRef);
  applyOptionalConfig(
    config,
    "advisorCompletionGate",
    setAdvisorCompletionGateRef
  );
  applyOptionalConfig(
    config,
    "advisorCustomInvocation",
    setAdvisorCustomInvocationRef
  );
  applyOptionalConfig(
    config,
    "advisorCollapseResponses",
    setAdvisorCollapseResponsesRef
  );
  applyOptionalConfig(
    config,
    "advisorBlockOnBlocked",
    setAdvisorBlockOnBlockedRef
  );
  applyOptionalConfig(config, "advisorAutoLoopGate", setAdvisorAutoLoopGateRef);
  applyOptionalConfig(
    config,
    "advisorLoopThreshold",
    setAdvisorLoopThresholdRef
  );
  applyOptionalConfig(
    config,
    "advisorMaxCallsPerSession",
    setAdvisorMaxCallsPerSessionRef
  );
  applyOptionalConfig(
    config,
    "advisorSessionSummary",
    setAdvisorSessionSummaryRef
  );
  applyOptionalConfig(config, "advisorScoutEnabled", setAdvisorScoutEnabledRef);
  applyOptionalConfig(config, "showUsageDetails", setShowUsageDetailsRef);
  applyOptionalConfig(config, "showUsageFooter", setShowUsageFooterRef);
  applyOptionalConfig(config, "simpleMode", setSimpleModeRef);
  applyOptionalConfig(config, "alwaysOn", setAlwaysOnRef);
  applyOptionalConfig(config, "gateFailureMode", setAdvisorFailureModeRef);
  applyOptionalConfig(
    config,
    "advisorHerdrIntegration",
    setAdvisorHerdrIntegrationRef
  );
  applyNonEmptyStringConfig(config.advisorJevModel, setAdvisorJevModelRef);
  applyOptionalConfig(config, "advisorJevTimeoutMs", setAdvisorJevTimeoutMsRef);
  applyOptionalConfig(
    config,
    "advisorJevDigestMaxChars",
    setAdvisorJevDigestMaxCharsRef
  );
  applyOptionalConfig(
    config,
    "advisorJevPricePerMtok",
    setAdvisorJevPricePerMtokRef
  );
  applyOptionalConfig(config, "advisorJevTransport", setAdvisorJevTransportRef);
  applyOptionalConfig(
    config,
    "advisorToolResultMaxLines",
    setAdvisorToolResultMaxLinesRef
  );
  applyOptionalConfig(
    config,
    "advisorToolResultMaxBytes",
    setAdvisorToolResultMaxBytesRef
  );
  applyOptionalConfig(
    config,
    "advisorRedactSecrets",
    setAdvisorRedactSecretsRef
  );
  applyOptionalConfig(config, "advisorGitContext", setAdvisorGitContextRef);
  applyOptionalConfig(
    config,
    "advisorGitContextMaxChars",
    setAdvisorGitContextMaxCharsRef
  );
  applyOptionalConfig(config, "advisorToolPolicies", setAdvisorToolPoliciesRef);
  applyOptionalConfig(
    config,
    "advisorUntrackedContent",
    setAdvisorUntrackedContentRef
  );
  applyOptionalConfig(
    config,
    "advisorTrackedFileContent",
    setAdvisorTrackedFileContentRef
  );
  applyOptionalConfig(
    config,
    "advisorOutcomeLogging",
    setAdvisorOutcomeLoggingRef
  );
};

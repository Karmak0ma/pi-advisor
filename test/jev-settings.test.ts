import { describe, expect, test } from "bun:test";
import { initTheme } from "@earendil-works/pi-coding-agent";
import {
  advisorJevDigestMaxCharsRef,
  advisorJevModelRef,
  advisorJevPricePerMtokRef,
  advisorJevTimeoutMsRef,
  advisorJevTransportRef,
  setAdvisorJevModelRef,
  setAdvisorJevTimeoutMsRef,
  setAdvisorJevTransportRef,
} from "../src/config/state.ts";
import { saveConfig } from "../src/config/storage.ts";
import { validateConfig } from "../src/config/validation.ts";
import { loadConfig } from "../src/config.ts";
import { AdvisorSettingsSelector } from "../src/ui.ts";
import { savedConfig, withAgentDir } from "./helpers/config-fixture.ts";
import { changeSetting, plainScreen } from "./helpers/settings-navigation.ts";

initTheme();

const selectorTheme = {
  bold: (text: string) => text,
  fg: (_color: string, text: string) => text,
} as any;

const openSelector = (initial: any = {}) => {
  const saved: any[] = [];
  const selector = new AdvisorSettingsSelector({
    effortLevels: ["Default (Model Default)", "low", "high"],
    initial: {
      collapseResponses: false,
      completionGate: true,
      contextMaxChars: 15_000,
      effort: "Default (Model Default)",
      failureGate: true,
      planGate: true,
      ...initial,
    },
    onCancel: () => undefined,
    onChange: (value: any) => saved.push(value),
    presets: [
      { description: "none", label: "0", value: 0 },
      { description: "15k", label: "15k", value: 15_000 },
    ],
    theme: selectorTheme,
    tui: { requestRender: () => undefined },
  } as any);
  return { saved, selector };
};

const INVALID_SETTINGS: [Record<string, unknown>, RegExp][] = [
  [{ advisorJevTimeoutMs: 0 }, /advisorJevTimeoutMs/],
  [{ advisorJevTimeoutMs: 1.5 }, /advisorJevTimeoutMs/],
  [{ advisorJevDigestMaxChars: -1 }, /advisorJevDigestMaxChars/],
  [{ advisorJevPricePerMtok: 0 }, /advisorJevPricePerMtok/],
  [{ advisorJevTransport: "vercel" }, /advisorJevTransport/],
];

describe("Jev shared settings", () => {
  test("default to safe values and validate their types", async () => {
    await withAgentDir({}, () => {
      loadConfig({ cwd: "/", isProjectTrusted: () => false } as any);
      expect(advisorJevModelRef).toBe("jev-latest");
      expect(advisorJevTimeoutMsRef).toBe(8000);
      expect(advisorJevDigestMaxCharsRef).toBe(4000);
      expect(advisorJevPricePerMtokRef).toBe(0.042);
      expect(advisorJevTransportRef).toBe("auto");
      expect(validateConfig({ advisorJevModel: "jev-1.13.0" })).toBe(true);
      expect(validateConfig({ advisorJevTimeoutMs: 5000 })).toBe(true);
      expect(validateConfig({ advisorJevDigestMaxChars: 0 })).toBe(true);
      expect(validateConfig({ advisorJevPricePerMtok: 0.042 })).toBe(true);
      expect(validateConfig({ advisorJevTransport: "openrouter" })).toBe(true);
      for (const [invalid, pattern] of INVALID_SETTINGS) {
        expect(() => validateConfig(invalid)).toThrow(pattern);
      }
    });
  });

  test("apply and persist configured values", async () => {
    await withAgentDir(
      {
        advisorJevDigestMaxChars: 8000,
        advisorJevModel: "jev-1.13.0",
        advisorJevPricePerMtok: 0.05,
        advisorJevTimeoutMs: 15_000,
        advisorJevTransport: "openrouter",
      },
      () => {
        loadConfig({ cwd: "/", isProjectTrusted: () => false } as any);
        expect(advisorJevModelRef).toBe("jev-1.13.0");
        expect(advisorJevTimeoutMsRef).toBe(15_000);
        expect(advisorJevDigestMaxCharsRef).toBe(8000);
        expect(advisorJevPricePerMtokRef).toBe(0.05);
        expect(advisorJevTransportRef).toBe("openrouter");

        setAdvisorJevModelRef(undefined);
        setAdvisorJevTimeoutMsRef(30_000);
        setAdvisorJevTransportRef("typesafe");
        saveConfig({ cwd: "/", isProjectTrusted: () => false } as any);
        expect(savedConfig(process.env.PI_CODING_AGENT_DIR as string)).toEqual({
          advisorJevDigestMaxChars: 8000,
          advisorJevModel: "jev-latest",
          advisorJevPricePerMtok: 0.05,
          advisorJevTimeoutMs: 30_000,
          advisorJevTransport: "typesafe",
        });
      }
    );
  });

  test("preserve a hand-placed typesafe_api_key without warning on it", async () => {
    await withAgentDir(
      { typesafe_api_key: "tsk-config-key", unrelatedTypo: true },
      () => {
        loadConfig({ cwd: "/", isProjectTrusted: () => false } as any);
        const saved = savedConfig(process.env.PI_CODING_AGENT_DIR as string);
        expect(saved.typesafe_api_key).toBe("tsk-config-key");
        expect("typesafe_api_key" in saved).toBe(true);
        // The reserved key never became a config setting.
        expect(saved).not.toHaveProperty("advisorJevFilterEnabled");
      }
    );
  });

  test("navigate and change the Jev rows", () => {
    const { saved, selector } = openSelector({
      jevDigestMaxChars: 4000,
      jevPricePerMtok: 0.042,
      jevTimeoutMs: 8000,
      jevTransport: "auto",
    });
    changeSetting(selector, "Jev timeout ms");
    expect(saved.at(-1)).toMatchObject({ jevTimeoutMs: 15_000 });
    changeSetting(selector, "Jev digest chars");
    expect(saved.at(-1)).toMatchObject({ jevDigestMaxChars: 8000 });
    changeSetting(selector, "Jev price/Mtok");
    expect(saved.at(-1)).toMatchObject({ jevPricePerMtok: 0.05 });
    changeSetting(selector, "Jev transport");
    expect(saved.at(-1)).toMatchObject({ jevTransport: "typesafe" });
    expect(plainScreen(selector)).toContain("typesafe");
    selector.dispose();
  });

  test("the Jev model submenu applies a trimmed custom model", () => {
    const { saved, selector } = openSelector();
    const presses = (() => {
      for (let i = 0; i < 60; i += 1) {
        if (plainScreen(selector).includes("→ Jev model")) {
          return i;
        }
        selector.handleInput("\u001b[B");
      }
      throw new Error("Jev model row not reachable");
    })();
    expect(presses).toBeGreaterThanOrEqual(0);
    selector.handleInput("\r");
    const editor = (selector as any).settingsList.submenuComponent;
    editor.input.setValue("  jev-1.13.0 \n");
    editor.input.onSubmit(editor.input.getValue());
    expect(saved.at(-1)).toMatchObject({ jevModel: "jev-1.13.0" });
    selector.dispose();
  });
});

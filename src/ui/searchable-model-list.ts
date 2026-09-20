import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  type Focusable,
  fuzzyFilter,
  Input,
  type Keybindings,
  type KeybindingsManager,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import type {
  SearchableModelMultiSelectorOptions,
  SearchableModelSelectorOptions,
} from "./types.ts";

type ModelSelectorOptions =
  | SearchableModelSelectorOptions
  | SearchableModelMultiSelectorOptions;

export class SearchableModelList implements Component, Focusable {
  private readonly tui: SearchableModelSelectorOptions["tui"];
  private readonly searchInput: Input;
  private readonly allOptions: string[];
  private readonly currentOption: string | undefined;
  private readonly multiSelect: boolean;
  private readonly selected = new Set<string>();
  private filteredOptions: string[];
  private selectedIndex = 0;
  private readonly title: string;
  private readonly onSelect: (value: string | string[]) => void;
  private readonly onCancel: () => void;
  private readonly theme: Theme;
  private readonly keybindings: KeybindingsManager;
  private _focused = false;

  get focused(): boolean {
    return this._focused;
  }
  set focused(val: boolean) {
    this._focused = val;
    this.searchInput.focused = val;
  }

  constructor(options: ModelSelectorOptions) {
    this.multiSelect = options.multiSelect === true;
    this.tui = options.tui;
    this.title = options.title;
    this.currentOption =
      !this.multiSelect &&
      "currentOption" in options &&
      options.currentOption &&
      options.allOptions.includes(options.currentOption)
        ? options.currentOption
        : undefined;
    let allOptions: string[];
    if (this.multiSelect) {
      allOptions = [...new Set(options.allOptions)].sort((left, right) =>
        left.localeCompare(right)
      );
    } else if (this.currentOption) {
      allOptions = [
        this.currentOption,
        ...options.allOptions.filter((item) => item !== this.currentOption),
      ];
    } else {
      allOptions = [...options.allOptions];
    }
    this.allOptions = allOptions;
    if (this.multiSelect) {
      for (const value of (options as SearchableModelMultiSelectorOptions)
        .currentOptions) {
        if (this.allOptions.includes(value)) {
          this.selected.add(value);
        }
      }
    }
    this.theme = options.theme;
    this.keybindings = options.keybindings;
    this.onSelect = options.onSelect as (value: string | string[]) => void;
    this.onCancel = options.onCancel;
    this.searchInput = new Input();
    this.filteredOptions = this.allOptions;
  }

  invalidate(): void {
    this.searchInput.invalidate();
  }

  render(width: number): string[] {
    const lines: string[] = [this.theme.fg("border", "─".repeat(width))];
    lines.push(`  ${this.theme.fg("accent", this.theme.bold(this.title))}`);
    const inputLines = this.searchInput.render(Math.max(1, width - 10));
    lines.push(
      `  ${this.theme.fg("accent", "Search: ")}${inputLines[0] || ""}`
    );
    lines.push("");

    const query = this.searchInput.getValue().trim();
    this.filteredOptions = query
      ? fuzzyFilter(this.allOptions, query, (item) => item)
      : this.allOptions;
    this.selectedIndex = Math.min(
      this.selectedIndex,
      Math.max(0, this.filteredOptions.length - 1)
    );

    const maxVisible = 10;
    const total = this.filteredOptions.length;
    if (total === 0) {
      lines.push(`  ${this.theme.fg("muted", "No matching models found.")}`);
    } else {
      const startIndex = Math.max(
        0,
        Math.min(
          this.selectedIndex - Math.floor(maxVisible / 2),
          total - maxVisible
        )
      );
      const endIndex = Math.min(startIndex + maxVisible, total);
      for (let i = startIndex; i < endIndex; i += 1) {
        lines.push(this.renderOption(this.filteredOptions[i], i));
      }
      if (total > maxVisible) {
        lines.push(
          "  " +
            this.theme.fg("muted", `  (${this.selectedIndex + 1}/${total})`)
        );
      }
    }
    lines.push("");
    lines.push(`  ${this.theme.fg("dim", this.interactionHint())}`);
    lines.push(this.theme.fg("border", "─".repeat(width)));
    return lines.map((line) => truncateToWidth(line, width));
  }

  handleInput(keyData: string): void {
    if (this.matchesAction(keyData, "tui.select.up", "\u001b[A")) {
      this.moveSelection(-1);
      return;
    }
    if (this.matchesAction(keyData, "tui.select.down", "\u001b[B")) {
      this.moveSelection(1);
      return;
    }
    if (this.multiSelect && keyData === " ") {
      const item = this.filteredOptions[this.selectedIndex];
      if (item) {
        if (this.selected.has(item)) {
          this.selected.delete(item);
        } else {
          this.selected.add(item);
        }
      }
      this.tui.requestRender();
      return;
    }
    if (
      this.matchesAction(keyData, "tui.select.confirm", "\n") ||
      keyData === "\r"
    ) {
      if (this.filteredOptions.length > 0) {
        if (this.multiSelect) {
          this.onSelect(
            this.allOptions.filter((item) => this.selected.has(item))
          );
        } else {
          this.onSelect(this.filteredOptions[this.selectedIndex]);
        }
      }
      return;
    }
    if (this.matchesAction(keyData, "tui.select.cancel", "\u001b")) {
      this.onCancel();
      return;
    }
    this.searchInput.handleInput(keyData);
    this.selectedIndex = 0;
    this.tui.requestRender();
  }

  private interactionHint(): string {
    return this.multiSelect
      ? "Type to search · ↑↓: navigate · Space: toggle · Enter: apply · Esc: cancel"
      : "Type to search · ↑↓: navigate · Enter: select · Esc: cancel";
  }

  private renderOption(item: string, index: number): string {
    let tick = "  ";
    if (
      this.multiSelect ? this.selected.has(item) : item === this.currentOption
    ) {
      tick = "✓ ";
    }
    if (index === this.selectedIndex) {
      return `  ${this.theme.fg("accent", `→ ${tick}${item}`)}`;
    }
    return `    ${this.theme.fg("text", `${tick}${item}`)}`;
  }

  private matchesAction(
    keyData: string,
    action: keyof Keybindings,
    fallback: string
  ) {
    return this.keybindings.matches(keyData, action) || keyData === fallback;
  }

  private moveSelection(direction: -1 | 1) {
    if (this.filteredOptions.length > 0) {
      const lastIndex = this.filteredOptions.length - 1;
      const nextIndex = this.selectedIndex + direction;
      if (nextIndex < 0) {
        this.selectedIndex = lastIndex;
      } else if (nextIndex > lastIndex) {
        this.selectedIndex = 0;
      } else {
        this.selectedIndex = nextIndex;
      }
    }
    this.tui.requestRender();
  }
}

// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * @vitest-environment jsdom
 *
 * Every password field in the fleet has a show/hide toggle, so this one
 * component carries that rule for the whole template. The toggle must not
 * be a submit button and must not be a tab stop — either would make the
 * eye icon a hazard in the middle of a login form.
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PasswordInput } from "./PasswordInput";

// Testing Library's auto-cleanup only registers itself when vitest runs with
// globals enabled, and this project keeps them off - so unmounting is ours to
// do. Without it every render stacks up in one document and the queries start
// finding the previous test's markup.
afterEach(cleanup);

const field = () => document.querySelector("input")!;

describe("PasswordInput", () => {
  it("starts masked and carries the field wiring through", () => {
    render(
      <PasswordInput id="password" name="password" autoComplete="current-password" minLength={12} />,
    );
    const input = field();
    expect(input.type).toBe("password");
    expect(input.id).toBe("password");
    expect(input.name).toBe("password");
    expect(input.autocomplete).toBe("current-password");
    expect(input.minLength).toBe(12);
    expect(input.required).toBe(true);
  });

  it("can be made optional and given a placeholder", () => {
    render(<PasswordInput id="p" name="p" required={false} placeholder="current password" />);
    expect(field().required).toBe(false);
    expect(field().placeholder).toBe("current password");
  });

  it("reveals and re-masks, renaming the control each way", async () => {
    const user = userEvent.setup();
    render(<PasswordInput id="p" name="p" />);

    const toggle = screen.getByRole("button", { name: "Show password" });
    expect(toggle.getAttribute("type")).toBe("button"); // never submits the form
    expect(toggle.tabIndex).toBe(-1); // never a tab stop between the fields

    await user.click(toggle);
    expect(field().type).toBe("text");
    expect(screen.getByRole("button", { name: "Hide password" }).title).toBe("Hide password");

    await user.click(screen.getByRole("button", { name: "Hide password" }));
    expect(field().type).toBe("password");
  });

  it("is uncontrolled unless a value is supplied", () => {
    render(<PasswordInput id="p" name="p" />);
    expect(field().value).toBe("");
  });

  it("reports each keystroke to a controlling parent", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<PasswordInput id="p" name="p" value="" onChange={onChange} />);
    await user.type(field(), "ab");
    expect(onChange).toHaveBeenNthCalledWith(1, "a");
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});

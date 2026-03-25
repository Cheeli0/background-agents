// @vitest-environment jsdom
/// <reference types="@testing-library/jest-dom" />

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";
import { SessionConnectionBanner } from "./session-connection-banner";

expect.extend(matchers);

afterEach(() => {
  cleanup();
});

describe("SessionConnectionBanner", () => {
  it("lets message text container consume available width", () => {
    render(
      <SessionConnectionBanner
        message="A very long connection error message that should take all available banner width before the reconnect action"
        onReconnect={vi.fn()}
      />
    );

    const message = screen.getByText(/very long connection error message/i);
    const textContainer = message.parentElement;

    expect(textContainer).toHaveClass("flex-1");
    expect(textContainer).toHaveClass("min-w-0");
  });

  it("keeps reconnect action available", () => {
    const onReconnect = vi.fn();

    render(<SessionConnectionBanner message="Connection lost" onReconnect={onReconnect} />);

    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });
});

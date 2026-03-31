import { type ReactElement } from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App.js";

function renderWithProviders(ui: ReactElement): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("App", () => {
  it("renders ShiftSync title", () => {
    renderWithProviders(<App />);
    expect(screen.getByRole("heading", { name: /shiftsync/i })).toBeTruthy();
  });
});

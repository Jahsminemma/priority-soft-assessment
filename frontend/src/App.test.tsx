import { type ReactElement } from "react";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import App from "./App.js";
import { AuthProvider } from "./context/AuthContext.js";

function renderWithProviders(ui: ReactElement): ReturnType<typeof render> {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AuthProvider>{ui}</AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("App", () => {
  it("renders sign-in when not authenticated", () => {
    const { getByRole } = renderWithProviders(<App />);
    expect(getByRole("heading", { name: /sign in/i })).toBeTruthy();
  });
});

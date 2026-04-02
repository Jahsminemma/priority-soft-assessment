import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, it, expect } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import App from "./App.js";
import { AuthProvider } from "./context/AuthContext.js";

describe("App", () => {
  it("renders sign-in when not authenticated", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const root: Root = createRoot(container);
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <AuthProvider>
              <App />
            </AuthProvider>
          </MemoryRouter>
        </QueryClientProvider>,
      );
      await Promise.resolve();
    });
    expect(container.querySelector("h1")?.textContent).toMatch(/sign in/i);
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});

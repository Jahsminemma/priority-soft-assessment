import "@testing-library/jest-dom/vitest";

/** Silence React `act(...)` warnings in Vitest + jsdom. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- React global for test env
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

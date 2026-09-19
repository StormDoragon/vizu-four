// Extends `expect` with jest-dom matchers (toBeInTheDocument, etc.) for
// component tests. Importing this in the node-environment engine/lib tests
// is a harmless no-op - the matchers it adds are simply never called there.
import "@testing-library/jest-dom/vitest";

// React Testing Library normally auto-registers this via a global `afterEach`
// when it detects one; we don't set `test.globals: true`, so it's wired up
// explicitly here instead. Without it, each render leaks into the document
// and the next test's queries return every previous render's elements too.
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

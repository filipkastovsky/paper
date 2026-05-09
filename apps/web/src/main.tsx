import "@/styles/globals.css";
import { bootstrapAuth } from "@/lib/auth";
import { initPostHog, posthog } from "@/lib/posthog";
import { queryClient } from "@/lib/query-client";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import React from "react";
import ReactDOM from "react-dom/client";
import { routeTree } from "./routeTree.gen";

initPostHog();

const router = createRouter({ routeTree, context: { queryClient } });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

// Render synchronously — the welcome card is static brand copy, no need to
// block the first paint on the auth roundtrip. `getStoredUser()` returns
// `null` until bootstrap completes; user-specific bits hydrate when it does.
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);

// Hydrate auth in the background; identify PostHog after it resolves so we
// don't lose the first event from a brand-new device.
bootstrapAuth()
  .then((user) => {
    posthog.identify(user.id);
  })
  .catch((err) => {
    console.error("[paper] bootstrapAuth failed", err);
  });

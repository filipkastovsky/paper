import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/onboarding")({
  component: OnboardingLayout,
});

function OnboardingLayout() {
  return (
    <main className="flex min-h-dvh items-start justify-center bg-paper px-6 py-10 sm:items-center">
      <div className="w-full max-w-md">
        <Outlet />
      </div>
    </main>
  );
}

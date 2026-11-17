import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useLocation, useRouter } from "@tanstack/react-router";
import { useUnreadCount } from "@/data/inbox";
import { useSession } from "@/data/session";
import { useOnboardingStage } from "@/features/onboarding/progress.ts";
import { useT } from "@/i18n/index.tsx";
import { showToast } from "@/ui/Toast.tsx";
import { AppLock } from "./lock/AppLock.tsx";
import { Shell } from "./Shell.tsx";
import { startServiceWorker, useIsComposing } from "./updates.ts";

const SignInScreen = lazy(() => import("./SignInScreen.tsx"));
const Onboarding = lazy(() => import("@/features/onboarding/Onboarding.tsx"));

function UpdatePrompt() {
  const t = useT();
  const composing = useIsComposing();
  const [apply, setApply] = useState<(() => void) | null>(null);
  const announced = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (import.meta.env.DEV) return;
    startServiceWorker((applyUpdate) => {
      setApply(() => applyUpdate);
    }).catch((error: unknown) => {
      console.error("Service worker registration failed", error);
    });
  }, []);

  useEffect(() => {
    if (!apply || composing || announced.current === apply) return;
    announced.current = apply;
    showToast(t("app.update.available"), {
      timeoutMs: null,
      action: {
        label: t("app.update.reload"),
        onAction: apply,
      },
    });
  }, [apply, composing, t]);

  return null;
}

function SignedIn() {
  const router = useRouter();
  const unreadCount = useUnreadCount();
  const pathname = useLocation({ select: (location) => location.pathname });
  useEffect(() => {
    if (pathname === "/welcome") router.history.replace("/");
  }, [pathname, router]);
  return (
    <AppLock>
      <Shell unreadCount={unreadCount} />
    </AppLock>
  );
}

export function AppRoot() {
  const session = useSession();
  const stage = useOnboardingStage();
  const pathname = useLocation({ select: (location) => location.pathname });

  let screen;
  if (session.status === "loading") screen = null;
  else if (pathname === "/signin") screen = <SignInScreen />;
  else if (session.status === "signedOut") {
    screen = stage === "done" ? <SignInScreen /> : <Onboarding mode="intro" />;
  } else if (stage !== "done") screen = <Onboarding mode="setup" />;
  else screen = <SignedIn />;

  return (
    <>
      <Suspense fallback={null}>{screen}</Suspense>
      <UpdatePrompt />
    </>
  );
}

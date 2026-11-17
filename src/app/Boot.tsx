import { Suspense, useLayoutEffect } from "react";
import { RouterProvider } from "@tanstack/react-router";
import { I18nProvider as AriaI18nProvider } from "react-aria-components/I18nProvider";
import { RouterProvider as AriaRouterProvider } from "react-aria-components";
import { usePreferences } from "@/data/preferences";
import { SessionProvider } from "@/data/session";
import { I18nProvider, resolveLanguage } from "@/i18n/index.tsx";
import { applyTheme } from "@/ui/theme.ts";
import { ToastRegion } from "@/ui/Toast.tsx";
import { NavigatorContext } from "./navigation/context.ts";
import { router, stackNavigator } from "./router.ts";

const SERVER_ROUTES = /^\/auth\//;

function navigate(href: string) {
  if (SERVER_ROUTES.test(href)) window.location.assign(href);
  else router.history.push(href);
}

export function Boot() {
  const preferences = usePreferences();
  const language = resolveLanguage(preferences.language, window.navigator.languages);

  useLayoutEffect(() => {
    applyTheme(preferences.theme);
  }, [preferences.theme]);

  return (
    <Suspense fallback={null}>
      <I18nProvider language={language}>
        <AriaI18nProvider locale={language}>
          <AriaRouterProvider navigate={navigate}>
            <NavigatorContext value={stackNavigator}>
              <SessionProvider>
                <RouterProvider router={router} />
              </SessionProvider>
            </NavigatorContext>
            <ToastRegion />
          </AriaRouterProvider>
        </AriaI18nProvider>
      </I18nProvider>
    </Suspense>
  );
}

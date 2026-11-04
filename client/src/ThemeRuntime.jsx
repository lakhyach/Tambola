import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { applyInstanceBranding, applyRuntimeTheme, clearRuntimeTheme } from "./theme-runtime.js";

export default function ThemeRuntime() {
  const location = useLocation();
  useEffect(() => {
    const abort = new AbortController();
    const params = new URLSearchParams(location.search);
    const routeInstance = location.pathname.match(/^\/games\/([^/]+)/)?.[1] || null;
    const instance = routeInstance || params.get("instance");
    const room = params.get("room");
    clearRuntimeTheme();
    const query = new URLSearchParams();
    if (instance) query.set("instance", instance);
    if (room) query.set("room", room);
    const json = (url) => fetch(url, { headers: { Accept: "application/json" }, cache: "no-store", signal: abort.signal })
      .then((response) => response.ok ? response.json() : null)
      .catch((error) => { if (error?.name !== "AbortError") return null; return null; });
    json(`/api/public/themes/active${query.size ? `?${query}` : ""}`)
      .then((themeData) => {
        if (abort.signal.aborted) return;
        if (themeData?.theme) {
          applyRuntimeTheme(themeData.theme);
          if (themeData.theme.instanceBranding) applyInstanceBranding(themeData.theme.instanceBranding, themeData.theme.instanceName || "");
        }
      });
    return () => abort.abort();
  }, [location.pathname, location.search]);
  return null;
}

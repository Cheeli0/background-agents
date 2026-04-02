"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "session-panel-preferences";
const CHANGE_EVENT = "session-panel-preferences-change";

export interface SessionPanelPreferences {
  autoArchiveClosedOrMergedPrSessions: boolean;
}

const DEFAULTS: SessionPanelPreferences = {
  autoArchiveClosedOrMergedPrSessions: true,
};

function read(): SessionPanelPreferences {
  if (typeof window === "undefined") {
    return DEFAULTS;
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return DEFAULTS;
    }

    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

export function useSessionPanelPreferences() {
  const [prefs, setPrefs] = useState<SessionPanelPreferences>(() => read());

  useEffect(() => {
    const onChange = () => setPrefs(read());
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => window.removeEventListener(CHANGE_EVENT, onChange);
  }, []);

  const update = useCallback((patch: Partial<SessionPanelPreferences>) => {
    setPrefs((prev) => ({ ...prev, ...patch }));
    const next = { ...read(), ...patch };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  }, []);

  return { ...prefs, update };
}

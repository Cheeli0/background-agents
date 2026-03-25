"use client";

import useSWR from "swr";

export interface SessionAssociatedPr {
  number: number;
  title: string;
  url: string;
  status: "open" | "merged" | "closed" | "draft";
}

interface SessionAssociatedPrResponse {
  pullRequest: SessionAssociatedPr | null;
}

const fetcher = async (url: string): Promise<SessionAssociatedPrResponse> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch associated PR: ${response.status}`);
  }
  return response.json();
};

export function useSessionAssociatedPr(sessionId: string | null) {
  const { data, error, isLoading } = useSWR<SessionAssociatedPrResponse>(
    sessionId ? `/api/sessions/${sessionId}/associated-pr` : null,
    fetcher,
    {
      refreshInterval: 10000,
      revalidateOnFocus: true,
    }
  );

  return {
    associatedPr: data?.pullRequest ?? null,
    error,
    isLoading,
  };
}

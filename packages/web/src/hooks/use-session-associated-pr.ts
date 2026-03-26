"use client";

import useSWR from "swr";

export interface SessionAssociatedPr {
  number: number;
  title: string;
  url: string;
  status: "open" | "merged" | "closed" | "draft";
  checks: SessionPullRequestChecks | null;
}

export interface SessionArtifactPr {
  number: number;
  url: string;
  status: "open" | "merged" | "closed" | "draft";
  checks: SessionPullRequestChecks | null;
}

export interface SessionPullRequestChecks {
  state: "success" | "failure" | "pending";
  totalCount: number;
  successfulCount: number;
  failedCount: number;
  pendingCount: number;
}

interface SessionAssociatedPrResponse {
  artifactPullRequest: SessionArtifactPr | null;
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
    artifactPr: data?.artifactPullRequest ?? null,
    associatedPr: data?.pullRequest ?? null,
    error,
    isLoading,
  };
}

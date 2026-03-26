"use client";

import useSWR from "swr";

export type SessionPrStatus = "open" | "merged" | "closed";

export function sessionPrStatusKey(sessionId: string) {
  return [`/api/sessions/${sessionId}/associated-pr`, "status-only"] as const;
}

export async function fetchSessionPrStatus([url]: ReturnType<
  typeof sessionPrStatusKey
>): Promise<SessionPrStatus | null> {
  try {
    const response = await fetch(url);
    if (response.ok) {
      const data = (await response.json()) as {
        pullRequest?: {
          status?: "open" | "merged" | "closed" | "draft";
        } | null;
        artifactPullRequest?: {
          status?: "open" | "merged" | "closed" | "draft";
        } | null;
      };

      const status = data.pullRequest?.status ?? data.artifactPullRequest?.status;
      if (status === "open" || status === "merged" || status === "closed") {
        return status;
      }
    } else {
      console.warn(`Failed to fetch associated PR: ${response.status}`);
    }
  } catch (error) {
    console.warn("Failed to fetch associated PR:", error);
  }

  const artifactsResponse = await fetch(url.replace("/associated-pr", "/artifacts"));
  if (!artifactsResponse.ok) {
    return null;
  }

  const artifactsData = (await artifactsResponse.json()) as {
    artifacts?: Array<{
      type?: string;
      createdAt?: number;
      metadata?: {
        prState?: "open" | "merged" | "closed" | "draft";
        state?: "open" | "merged" | "closed" | "draft";
      } | null;
    }>;
  };

  const prArtifacts = (artifactsData.artifacts ?? []).filter((artifact) => artifact.type === "pr");
  if (prArtifacts.length === 0) {
    return null;
  }

  const latestPrArtifact = prArtifacts.reduce((latest, artifact) => {
    const latestCreatedAt = latest.createdAt ?? 0;
    const artifactCreatedAt = artifact.createdAt ?? 0;
    return artifactCreatedAt > latestCreatedAt ? artifact : latest;
  });

  const artifactStatus = latestPrArtifact.metadata?.prState ?? latestPrArtifact.metadata?.state;
  if (artifactStatus === "open" || artifactStatus === "merged" || artifactStatus === "closed") {
    return artifactStatus;
  }

  if (artifactStatus === "draft") {
    return "open";
  }

  return "open";
}

export function useSessionPrStatus(sessionId: string | null) {
  const { data } = useSWR<SessionPrStatus | null>(
    sessionId ? sessionPrStatusKey(sessionId) : null,
    fetchSessionPrStatus,
    {
      refreshInterval: (latestStatus) => (latestStatus === "open" ? 10_000 : 0),
      revalidateOnFocus: true,
      dedupingInterval: 10_000,
    }
  );

  return data ?? null;
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { formatModelName, formatProviderName, truncateBranch, copyToClipboard } from "@/lib/format";
import { formatRelativeTime } from "@/lib/time";
import { getSafeExternalUrl } from "@/lib/urls";
import { getScmBranchUrl, getScmRepoUrl } from "@/lib/scm";
import type { Artifact } from "@/types/session";
import type {
  SessionArtifactPr,
  SessionAssociatedPr,
  SessionPullRequestChecks,
} from "@/hooks/use-session-associated-pr";
import { useSessionPrStatus } from "@/hooks/use-session-pr-status";
import { PullRequestStatusIcon } from "@/components/pull-request-status-icon";
import {
  ClockIcon,
  SparkleIcon,
  GitBranchWorkIcon,
  BranchIcon,
  RepoIcon,
  CopyIcon,
  CheckIcon,
  CheckCircleIcon,
  ErrorIcon,
  LinkIcon,
} from "@/components/ui/icons";

interface MetadataSectionProps {
  sessionId?: string;
  createdAt: number;
  model?: string;
  reasoningEffort?: string;
  baseBranch: string;
  branchName?: string;
  repoOwner?: string;
  repoName?: string;
  artifacts?: Artifact[];
  parentSessionId?: string | null;
  artifactPr?: SessionArtifactPr | null;
  associatedPr?: SessionAssociatedPr | null;
}

function getChecksLabel(checks: SessionPullRequestChecks): string {
  if (checks.state === "failure") {
    return `${checks.failedCount}/${checks.totalCount} checks failing`;
  }
  if (checks.state === "pending") {
    return `${checks.pendingCount}/${checks.totalCount} checks pending`;
  }
  return `${checks.successfulCount}/${checks.totalCount} checks passing`;
}

function PullRequestChecksIndicator({
  checks,
}: {
  checks: SessionPullRequestChecks | null | undefined;
}) {
  if (!checks) {
    return null;
  }

  const label = getChecksLabel(checks);
  const className = "w-4 h-4";

  return (
    <span className="inline-flex items-center" aria-label={label} title={label}>
      {checks.state === "success" ? (
        <CheckCircleIcon className={`${className} text-success`} />
      ) : checks.state === "failure" ? (
        <ErrorIcon className={`${className} text-red-600`} />
      ) : (
        <ClockIcon className={`${className} text-amber-500`} />
      )}
    </span>
  );
}

export function MetadataSection({
  sessionId,
  createdAt,
  model,
  reasoningEffort,
  baseBranch,
  branchName,
  repoOwner,
  repoName,
  artifacts = [],
  parentSessionId,
  artifactPr,
  associatedPr,
}: MetadataSectionProps) {
  const [copied, setCopied] = useState(false);
  const providerName = model ? formatProviderName(model) : null;

  const prArtifact = artifacts.find((a) => a.type === "pr");
  const manualPrArtifact = artifacts.find(
    (a) => a.type === "branch" && (a.metadata?.mode === "manual_pr" || a.metadata?.createPrUrl)
  );
  const prNumber = prArtifact?.metadata?.prNumber;
  const prState = prArtifact?.metadata?.prState;
  const prUrl = getSafeExternalUrl(
    prArtifact?.url || manualPrArtifact?.metadata?.createPrUrl || manualPrArtifact?.url
  );
  const associatedPrUrl = getSafeExternalUrl(associatedPr?.url);
  const hasMatchingArtifactPr = associatedPr
    ? artifacts.some(
        (artifact) =>
          artifact.type === "pr" &&
          (artifact.metadata?.prNumber === associatedPr.number ||
            getSafeExternalUrl(artifact.url) === associatedPrUrl)
      )
    : false;
  const associatedPrLink =
    associatedPr && associatedPrUrl && !hasMatchingArtifactPr && associatedPrUrl !== prUrl
      ? {
          ...associatedPr,
          url: associatedPrUrl,
        }
      : null;
  const sidebarPrStatus = useSessionPrStatus(sessionId ?? null);
  const branchUrl =
    branchName && repoOwner && repoName ? getScmBranchUrl(repoOwner, repoName, branchName) : null;

  const handleCopyBranch = async () => {
    if (branchName) {
      const success = await copyToClipboard(branchName);
      if (success) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    }
  };

  return (
    <div className="space-y-3">
      {/* Timestamp */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <ClockIcon className="w-4 h-4" />
        <span>{formatRelativeTime(createdAt)}</span>
      </div>

      {/* Parent session */}
      {parentSessionId && (
        <div className="flex items-center gap-2 text-sm">
          <LinkIcon className="w-4 h-4 text-muted-foreground" />
          <Link href={`/session/${parentSessionId}`} className="text-accent hover:underline">
            Parent session
          </Link>
        </div>
      )}

      {/* Model */}
      {model && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <SparkleIcon className="w-4 h-4" />
          <span className="flex flex-col leading-tight gap-0.5">
            <span>
              {formatModelName(model)}
              {reasoningEffort && <span> · {reasoningEffort}</span>}
            </span>
            <span className="text-xs">Provider: {providerName ?? "Unknown"}</span>
          </span>
        </div>
      )}

      {/* PR Badge */}
      {(prNumber || prUrl) && (
        <div className="flex items-center gap-2 text-sm">
          <PullRequestStatusIcon
            status={sidebarPrStatus ?? prState ?? "open"}
            className="w-4 h-4"
          />
          {prUrl ? (
            <a
              href={prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              {prNumber ? `#${prNumber}` : "Create PR"}
            </a>
          ) : (
            <span className="text-foreground">#{prNumber}</span>
          )}
          <PullRequestChecksIndicator checks={artifactPr?.checks} />
        </div>
      )}

      {associatedPrLink && (
        <div className="flex items-center gap-2 text-sm">
          <PullRequestStatusIcon
            status={sidebarPrStatus ?? associatedPrLink.status}
            className="w-4 h-4"
          />
          <a
            href={associatedPrLink.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
            title={associatedPrLink.title}
          >
            Associated PR #{associatedPrLink.number}
          </a>
          <PullRequestChecksIndicator checks={associatedPr?.checks} />
        </div>
      )}

      {/* Base Branch */}
      {baseBranch && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <BranchIcon className="w-4 h-4" />
          {repoOwner && repoName ? (
            <a
              href={getScmBranchUrl(repoOwner, repoName, baseBranch)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent truncate max-w-[180px] hover:underline"
              title={baseBranch}
            >
              {truncateBranch(baseBranch)}
            </a>
          ) : (
            <span className="truncate max-w-[180px]" title={baseBranch}>
              {truncateBranch(baseBranch)}
            </span>
          )}
        </div>
      )}

      {/* Working Branch */}
      {branchName && (
        <div className="flex items-center gap-2 text-sm">
          <GitBranchWorkIcon className="w-4 h-4 text-muted-foreground" />
          {branchUrl ? (
            <a
              href={branchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent truncate max-w-[180px] hover:underline"
              title={branchName}
            >
              {truncateBranch(branchName)}
            </a>
          ) : (
            <span className="text-foreground truncate max-w-[180px]" title={branchName}>
              {truncateBranch(branchName)}
            </span>
          )}
          <button
            onClick={handleCopyBranch}
            className="p-1 hover:bg-muted transition-colors"
            title={copied ? "Copied!" : "Copy branch name"}
          >
            {copied ? (
              <CheckIcon className="w-3.5 h-3.5 text-success" />
            ) : (
              <CopyIcon className="w-3.5 h-3.5 text-secondary-foreground" />
            )}
          </button>
        </div>
      )}

      {/* Repository tag */}
      {repoOwner && repoName && (
        <div className="flex items-center gap-2 text-sm">
          <RepoIcon className="w-4 h-4 text-muted-foreground" />
          <a
            href={getScmRepoUrl(repoOwner, repoName)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
          >
            {repoOwner}/{repoName}
          </a>
        </div>
      )}
    </div>
  );
}

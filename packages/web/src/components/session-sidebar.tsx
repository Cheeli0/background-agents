"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useMemo, useCallback, useEffect, useRef, type TouchEvent } from "react";
import { useSession, signOut } from "next-auth/react";
import useSWR, { useSWRConfig } from "swr";
import { formatRelativeTime, isInactiveSession } from "@/lib/time";
import {
  buildSessionsPageKey,
  mergeUniqueSessions,
  SIDEBAR_SESSIONS_KEY,
  type SidebarSession,
  type SessionListResponse,
} from "@/lib/session-list";
import { truncateBranchStart } from "@/lib/format";
import { SHORTCUT_LABELS } from "@/lib/keyboard-shortcuts";
import { useIsMobile } from "@/hooks/use-media-query";
import { useSessionPrStatus } from "@/hooks/use-session-pr-status";
import {
  MoreIcon,
  SidebarIcon,
  InspectIcon,
  PlusIcon,
  SettingsIcon,
  AutomationsIcon,
  BranchIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  FolderIcon,
  KeyboardIcon,
} from "@/components/ui/icons";
import { PullRequestStatusIcon } from "@/components/pull-request-status-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
export type SessionItem = SidebarSession;

type RepositoryInfo = {
  key: string;
  label: string;
};
type RepositorySessionGroup = {
  repository: RepositoryInfo;
  activeSessions: SessionItem[];
  inactiveSessions: SessionItem[];
};

const EXTERNAL_SESSION_CREATION_SOURCES = new Set([
  "slack",
  "linear",
  "github",
  "extension",
  "automation",
]);

export const MOBILE_LONG_PRESS_MS = 450;
const MOBILE_LONG_PRESS_MOVE_THRESHOLD_PX = 10;
const UNKNOWN_REPOSITORY_LABEL = "Unknown repository";
export const REPOSITORY_GROUP_COLLAPSE_STORAGE_KEY = "open-inspect-sidebar-collapsed-repositories";

function getSessionRepositoryInfo(
  session: Pick<SessionItem, "repoOwner" | "repoName">
): RepositoryInfo {
  const repoOwner = session.repoOwner?.trim() ?? "";
  const repoName = session.repoName?.trim() ?? "";

  if (repoOwner && repoName) {
    const fullName = `${repoOwner}/${repoName}`;
    return { key: fullName.toLowerCase(), label: fullName };
  }

  if (repoOwner) {
    return { key: `owner:${repoOwner.toLowerCase()}`, label: repoOwner };
  }

  if (repoName) {
    return { key: `repo:${repoName.toLowerCase()}`, label: repoName };
  }

  return { key: "unknown", label: UNKNOWN_REPOSITORY_LABEL };
}

function shouldAutoExpandRepositoryGroup(session: { creationSource?: string | null }) {
  return !!session.creationSource && EXTERNAL_SESSION_CREATION_SOURCES.has(session.creationSource);
}

function SessionPrStatusIndicator({ sessionId }: { sessionId: string }) {
  const prStatus = useSessionPrStatus(sessionId);

  if (!prStatus) {
    return null;
  }

  return <PullRequestStatusIcon status={prStatus} className="w-3 h-3" />;
}

export function buildSessionHref(session: SessionItem) {
  return {
    pathname: `/session/${session.id}`,
    query: {
      repoOwner: session.repoOwner,
      repoName: session.repoName,
      ...(session.title ? { title: session.title } : {}),
    },
  };
}

interface SessionSidebarProps {
  onNewSession?: () => void;
  onToggle?: () => void;
  onSessionSelect?: () => void;
}

export function SessionSidebar({ onNewSession, onToggle, onSessionSelect }: SessionSidebarProps) {
  const { data: authSession } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const [searchQuery, setSearchQuery] = useState("");
  const [extraSessions, setExtraSessions] = useState<SessionItem[]>([]);
  const [hasMorePages, setHasMorePages] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [collapsedRepositoryKeys, setCollapsedRepositoryKeys] = useState<Set<string>>(new Set());
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);
  const hasMoreRef = useRef(false);
  const loadingMoreRef = useRef(false);
  const isMobile = useIsMobile();
  const collapsedRepositoriesHydratedRef = useRef(false);
  const previousFirstPageSessionIdsRef = useRef<Set<string> | null>(null);
  const preservePaginationStateRef = useRef(false);
  const preservedOffsetRef = useRef<number | null>(null);

  useEffect(() => {
    try {
      const storedValue = localStorage.getItem(REPOSITORY_GROUP_COLLAPSE_STORAGE_KEY);
      if (!storedValue) {
        collapsedRepositoriesHydratedRef.current = true;
        return;
      }

      const parsed = JSON.parse(storedValue);
      if (!Array.isArray(parsed)) {
        collapsedRepositoriesHydratedRef.current = true;
        return;
      }

      const validRepositoryKeys = parsed.filter(
        (value): value is string => typeof value === "string"
      );
      setCollapsedRepositoryKeys(new Set(validRepositoryKeys));
    } catch {
      localStorage.removeItem(REPOSITORY_GROUP_COLLAPSE_STORAGE_KEY);
    } finally {
      collapsedRepositoriesHydratedRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (!collapsedRepositoriesHydratedRef.current) {
      return;
    }

    const serialized = JSON.stringify([...collapsedRepositoryKeys]);
    localStorage.setItem(REPOSITORY_GROUP_COLLAPSE_STORAGE_KEY, serialized);
  }, [collapsedRepositoryKeys]);

  const { data, isLoading: loading } = useSWR<SessionListResponse>(
    authSession ? SIDEBAR_SESSIONS_KEY : null
  );
  const firstPageSessions = useMemo(() => data?.sessions ?? [], [data?.sessions]);

  useEffect(() => {
    const previousFirstPageSessionIds = previousFirstPageSessionIdsRef.current;
    previousFirstPageSessionIdsRef.current = new Set(
      firstPageSessions.map((session) => session.id)
    );

    if (!collapsedRepositoriesHydratedRef.current || !previousFirstPageSessionIds) {
      return;
    }

    const repositoryKeysToExpand = new Set<string>();

    for (const session of firstPageSessions) {
      if (
        previousFirstPageSessionIds.has(session.id) ||
        !shouldAutoExpandRepositoryGroup(session)
      ) {
        continue;
      }

      repositoryKeysToExpand.add(getSessionRepositoryInfo(session).key);
    }

    if (repositoryKeysToExpand.size === 0) {
      return;
    }

    setCollapsedRepositoryKeys((previous) => {
      let changed = false;
      const next = new Set(previous);

      for (const repositoryKey of repositoryKeysToExpand) {
        if (next.delete(repositoryKey)) {
          changed = true;
        }
      }

      return changed ? next : previous;
    });
  }, [firstPageSessions]);

  // Track data reference to clear extraSessions synchronously during render,
  // preventing one frame of stale extra sessions after SWR revalidation.
  const prevDataRef = useRef(data);
  let effectiveExtraSessions = extraSessions;
  if (prevDataRef.current !== data) {
    prevDataRef.current = data;
    if (!preservePaginationStateRef.current) {
      effectiveExtraSessions = [];
    }
  }

  useEffect(() => {
    if (!data) return;

    if (preservePaginationStateRef.current) {
      preservePaginationStateRef.current = false;
      setLoadingMore(false);
      offsetRef.current = preservedOffsetRef.current ?? firstPageSessions.length;
      preservedOffsetRef.current = null;
      loadingMoreRef.current = false;
      return;
    }

    setExtraSessions([]);
    setHasMorePages(data.hasMore);
    setLoadingMore(false);
    offsetRef.current = firstPageSessions.length;
    preservedOffsetRef.current = null;
    hasMoreRef.current = data.hasMore;
    loadingMoreRef.current = false;
  }, [data, firstPageSessions.length]);

  const loadMoreSessions = useCallback(async () => {
    if (!authSession || loadingMoreRef.current || !hasMoreRef.current) return;

    loadingMoreRef.current = true;
    setLoadingMore(true);

    try {
      const response = await fetch(
        buildSessionsPageKey({ excludeStatus: "archived", offset: offsetRef.current })
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch additional sessions: ${response.status}`);
      }

      const page: SessionListResponse = await response.json();
      const fetched = page.sessions ?? [];

      setExtraSessions((prev) => mergeUniqueSessions(prev, fetched));
      setHasMorePages(page.hasMore);
      offsetRef.current += fetched.length;
      hasMoreRef.current = page.hasMore;
    } catch (error) {
      console.error("Failed to fetch additional sessions:", error);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [authSession]);

  const maybeLoadMoreSessions = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 96;
    if (nearBottom) {
      void loadMoreSessions();
    }
  }, [loadMoreSessions]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || loading || loadingMore || !hasMorePages) return;

    if (container.clientHeight > 0 && container.scrollHeight <= container.clientHeight) {
      void loadMoreSessions();
    }
  }, [
    hasMorePages,
    loading,
    loadingMore,
    loadMoreSessions,
    firstPageSessions.length,
    extraSessions.length,
  ]);

  const sessions = useMemo(
    () => mergeUniqueSessions(firstPageSessions, effectiveExtraSessions),
    [firstPageSessions, effectiveExtraSessions]
  );

  // Sort sessions by updatedAt (most recent first), filter by search query,
  // and group children under their parent sessions before grouping by repository.
  const { repositoryGroups, childrenMap } = useMemo(() => {
    const filtered = sessions
      .filter((session) => session.status !== "archived")
      .filter((session) => {
        if (!searchQuery) return true;
        const query = searchQuery.toLowerCase();
        const title = session.title?.toLowerCase() || "";
        const repo = getSessionRepositoryInfo(session).label.toLowerCase();
        return title.includes(query) || repo.includes(query);
      });

    // Sort by updatedAt descending
    const sorted = [...filtered].sort((a, b) => {
      const aTime = a.updatedAt || a.createdAt;
      const bTime = b.updatedAt || b.createdAt;
      return bTime - aTime;
    });

    // Build set of visible session IDs for orphan detection
    const visibleIds = new Set(sorted.map((s) => s.id));

    // Group children by parent ID
    const children = new Map<string, SessionItem[]>();
    const topLevel: SessionItem[] = [];

    for (const session of sorted) {
      const parentId = session.parentSessionId;
      if (parentId && visibleIds.has(parentId)) {
        // Parent is visible — nest under it
        const siblings = children.get(parentId) ?? [];
        siblings.push(session);
        children.set(parentId, siblings);
      } else {
        // Top-level session (or orphan child whose parent is filtered out)
        topLevel.push(session);
      }
    }

    const repositoryGroupsMap = new Map<string, RepositorySessionGroup>();

    for (const session of topLevel) {
      const repository = getSessionRepositoryInfo(session);
      const existingGroup = repositoryGroupsMap.get(repository.key) ?? {
        repository,
        activeSessions: [],
        inactiveSessions: [],
      };
      const timestamp = session.updatedAt || session.createdAt;
      if (isInactiveSession(timestamp)) {
        existingGroup.inactiveSessions.push(session);
      } else {
        existingGroup.activeSessions.push(session);
      }
      repositoryGroupsMap.set(repository.key, existingGroup);
    }

    return { repositoryGroups: [...repositoryGroupsMap.values()], childrenMap: children };
  }, [sessions, searchQuery]);

  const currentSessionId = pathname?.startsWith("/session/") ? pathname.split("/")[2] : null;

  const toggleRepositoryGroup = useCallback((repositoryKey: string) => {
    setCollapsedRepositoryKeys((previous) => {
      const next = new Set(previous);
      if (next.has(repositoryKey)) {
        next.delete(repositoryKey);
      } else {
        next.add(repositoryKey);
      }
      return next;
    });
  }, []);

  const handleSessionArchived = useCallback(
    (sessionId: string) => {
      preservePaginationStateRef.current = true;
      setExtraSessions((previous) => {
        const next = previous.filter((session) => session.id !== sessionId);
        preservedOffsetRef.current = mergeUniqueSessions(firstPageSessions, next).length;
        return next;
      });

      void mutate(
        SIDEBAR_SESSIONS_KEY,
        (currentData?: SessionListResponse) => {
          const baseData = currentData ?? data;
          return baseData
            ? {
                ...baseData,
                sessions: baseData.sessions.filter((session) => session.id !== sessionId),
              }
            : currentData;
        },
        {
          populateCache: true,
          revalidate: false,
        }
      );
    },
    [data, firstPageSessions, mutate]
  );

  const handleSidebarMutation = useCallback(() => {
    preservePaginationStateRef.current = true;
    preservedOffsetRef.current = mergeUniqueSessions(firstPageSessions, extraSessions).length;
  }, [extraSessions, firstPageSessions]);

  const handleSidebarMutationError = useCallback(() => {
    preservePaginationStateRef.current = false;
    preservedOffsetRef.current = null;
  }, []);

  return (
    <aside className="w-72 h-dvh flex flex-col border-r border-border-muted bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-muted">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggle}
            title={`Toggle sidebar (${SHORTCUT_LABELS.TOGGLE_SIDEBAR})`}
            aria-label={`Toggle sidebar (${SHORTCUT_LABELS.TOGGLE_SIDEBAR})`}
          >
            <SidebarIcon className="w-4 h-4" />
          </Button>
          <Link href="/" className="flex items-center gap-2">
            <InspectIcon className="w-5 h-5" />
            <span className="font-semibold text-foreground">Inspect</span>
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={onNewSession}
            title={`New session (${SHORTCUT_LABELS.NEW_SESSION})`}
            aria-label={`New session (${SHORTCUT_LABELS.NEW_SESSION})`}
          >
            <PlusIcon className="w-4 h-4" />
          </Button>
          <Link
            href="/settings"
            className={`p-1.5 transition ${
              pathname === "/settings"
                ? "text-foreground bg-muted"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
            title="Settings"
          >
            <SettingsIcon className="w-4 h-4" />
          </Link>
          <UserMenu user={authSession?.user} />
        </div>
      </div>

      {/* Nav links */}
      <div className="px-3 pt-2 pb-1 flex flex-col gap-0.5">
        <Link
          href="/automations"
          className={`flex items-center gap-2 px-3 py-1.5 text-sm rounded-md transition ${
            pathname?.startsWith("/automations")
              ? "text-foreground bg-muted"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          }`}
        >
          <AutomationsIcon className="w-4 h-4" />
          Automations
        </Link>
      </div>

      {/* Search */}
      <div className="px-3 py-2">
        <Input
          type="text"
          placeholder="Search sessions..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Session List */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto"
        onScroll={maybeLoadMoreSessions}
      >
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-muted-foreground" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">No sessions yet</div>
        ) : (
          <>
            {repositoryGroups.map((group) => (
              <section key={group.repository.key} className="py-1">
                <button
                  type="button"
                  onClick={() => toggleRepositoryGroup(group.repository.key)}
                  aria-expanded={!collapsedRepositoryKeys.has(group.repository.key)}
                  aria-label={`Repository ${group.repository.label}`}
                  className="group/repository mx-2 w-[calc(100%-1rem)] px-2.5 py-2 rounded-md border border-border-muted bg-muted/40 text-left transition hover:bg-muted"
                >
                  <div className="flex items-center gap-2">
                    <ChevronRightIcon
                      className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${
                        collapsedRepositoryKeys.has(group.repository.key) ? "rotate-0" : "rotate-90"
                      }`}
                    />
                    <FolderIcon className="h-3.5 w-3.5 text-secondary-foreground" />
                    <span className="truncate text-[11px] font-semibold text-secondary-foreground uppercase tracking-[0.08em]">
                      {group.repository.label}
                    </span>
                    <span className="ml-auto rounded-sm bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {group.activeSessions.length + group.inactiveSessions.length}
                    </span>
                  </div>
                </button>

                {!collapsedRepositoryKeys.has(group.repository.key) && (
                  <>
                    {group.activeSessions.map((session) => (
                      <SessionWithChildren
                        key={session.id}
                        session={session}
                        childSessions={childrenMap.get(session.id)}
                        currentSessionId={currentSessionId}
                        isMobile={isMobile}
                        onSessionSelect={onSessionSelect}
                        onBeforeSidebarMutation={handleSidebarMutation}
                        onSidebarMutationError={handleSidebarMutationError}
                        onArchiveCurrentSession={() => router.push("/")}
                        onArchiveSuccess={handleSessionArchived}
                      />
                    ))}

                    {group.inactiveSessions.length > 0 && (
                      <>
                        <div className="px-4 py-1.5">
                          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-[0.1em]">
                            Inactive
                          </span>
                        </div>
                        {group.inactiveSessions.map((session) => (
                          <SessionWithChildren
                            key={session.id}
                            session={session}
                            childSessions={childrenMap.get(session.id)}
                            currentSessionId={currentSessionId}
                            isMobile={isMobile}
                            onSessionSelect={onSessionSelect}
                            onBeforeSidebarMutation={handleSidebarMutation}
                            onSidebarMutationError={handleSidebarMutationError}
                            onArchiveCurrentSession={() => router.push("/")}
                            onArchiveSuccess={handleSessionArchived}
                          />
                        ))}
                      </>
                    )}
                  </>
                )}
              </section>
            ))}

            {loadingMore && (
              <div className="flex justify-center py-3">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-muted-foreground" />
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

function UserMenu({ user }: { user?: { name?: string | null; image?: string | null } | null }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="w-7 h-7 rounded-full overflow-hidden focus:outline-none focus:ring-2 focus:ring-primary"
          title={`Signed in as ${user?.name || "User"}`}
        >
          {user?.image ? (
            <img
              src={user.image}
              alt={user.name || "User"}
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="w-full h-full rounded-full bg-card flex items-center justify-center text-xs font-medium text-foreground">
              {user?.name?.charAt(0).toUpperCase() || "?"}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={4}>
        <DropdownMenuLabel className="font-medium truncate">
          {user?.name || "User"}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => signOut()}>
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3-3l3-3m0 0l-3-3m3 3H9"
            />
          </svg>
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SessionWithChildren({
  session,
  childSessions,
  currentSessionId,
  isMobile,
  onSessionSelect,
  onBeforeSidebarMutation,
  onSidebarMutationError,
  onArchiveCurrentSession,
  onArchiveSuccess,
}: {
  session: SessionItem;
  childSessions?: SessionItem[];
  currentSessionId: string | null;
  isMobile: boolean;
  onSessionSelect?: () => void;
  onBeforeSidebarMutation?: () => void;
  onSidebarMutationError?: () => void;
  onArchiveCurrentSession?: () => void;
  onArchiveSuccess?: (sessionId: string) => void;
}) {
  return (
    <>
      <SessionListItem
        session={session}
        isActive={session.id === currentSessionId}
        isMobile={isMobile}
        onSessionSelect={onSessionSelect}
        onBeforeSidebarMutation={onBeforeSidebarMutation}
        onSidebarMutationError={onSidebarMutationError}
        onArchiveCurrentSession={onArchiveCurrentSession}
        onArchiveSuccess={onArchiveSuccess}
      />
      {childSessions &&
        childSessions.map((child) => (
          <ChildSessionListItem
            key={child.id}
            session={child}
            isActive={child.id === currentSessionId}
            isMobile={isMobile}
            onSessionSelect={onSessionSelect}
          />
        ))}
    </>
  );
}

function SessionListItem({
  session,
  isActive,
  isMobile,
  onSessionSelect,
  onBeforeSidebarMutation,
  onSidebarMutationError,
  onArchiveCurrentSession,
  onArchiveSuccess,
}: {
  session: SessionItem;
  isActive: boolean;
  isMobile: boolean;
  onSessionSelect?: () => void;
  onBeforeSidebarMutation?: () => void;
  onSidebarMutationError?: () => void;
  onArchiveCurrentSession?: () => void;
  onArchiveSuccess?: (sessionId: string) => void;
}) {
  const { mutate } = useSWRConfig();
  const timestamp = session.updatedAt || session.createdAt;
  const relativeTime = formatRelativeTime(timestamp);
  const repository = getSessionRepositoryInfo(session);
  const displayTitle = session.title || repository.label;
  // Orphan child (parent filtered out) — show a subtle badge
  const isOrphanChild = session.parentSessionId && session.spawnSource === "agent";
  const branchLabel =
    session.branchName ||
    (session.baseBranch && session.baseBranch !== "main" ? session.baseBranch : null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [isActionsOpen, setIsActionsOpen] = useState(false);
  const [showArchiveDialog, setShowArchiveDialog] = useState(false);
  const [title, setTitle] = useState(displayTitle);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const showCompletedIndicator = session.status === "completed";
  const showWaitingForUserIndicator = session.status === "active" && session.isProcessing === false;

  useEffect(() => {
    if (!isRenaming) {
      setTitle(displayTitle);
    }
  }, [displayTitle, isRenaming]);

  const handleStartRename = () => {
    setIsActionsOpen(false);
    setTitle(displayTitle);
    setIsRenaming(true);
  };

  const handleCancelRename = () => {
    setTitle(displayTitle);
    setIsRenaming(false);
  };

  const handleArchive = async () => {
    setShowArchiveDialog(false);
    setIsActionsOpen(false);

    try {
      const response = await fetch(`/api/sessions/${session.id}/archive`, { method: "POST" });

      if (!response.ok) {
        throw new Error("Failed to archive session");
      }

      onArchiveSuccess?.(session.id);

      if (isActive) {
        onArchiveCurrentSession?.();
      }
    } catch {
      console.error("Failed to archive session");
    }
  };

  const handleRenameSubmit = async () => {
    const trimmed = title.trim();

    if (!trimmed || trimmed === displayTitle) {
      setIsRenaming(false);
      return;
    }

    const previousTitle = displayTitle;
    setIsRenaming(false);

    const updateSessionsTitle = (data?: SessionListResponse): SessionListResponse => ({
      sessions: (data?.sessions ?? []).map((currentSession) =>
        currentSession.id === session.id
          ? {
              ...currentSession,
              title: trimmed,
              updatedAt: Date.now(),
            }
          : currentSession
      ),
      hasMore: data?.hasMore ?? false,
    });

    try {
      onBeforeSidebarMutation?.();
      await mutate<SessionListResponse>(
        SIDEBAR_SESSIONS_KEY,
        async (currentData?: SessionListResponse) => {
          const response = await fetch(`/api/sessions/${session.id}/title`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: trimmed }),
          });
          if (!response.ok) {
            throw new Error("Failed to update session title");
          }
          return updateSessionsTitle(currentData);
        },
        {
          optimisticData: updateSessionsTitle,
          rollbackOnError: true,
          populateCache: true,
          revalidate: false,
        }
      );
    } catch {
      onSidebarMutationError?.();
      setTitle(previousTitle);
      setIsRenaming(true);
    }
  };

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handleTouchStart = useCallback(
    (event: TouchEvent<HTMLAnchorElement>) => {
      if (!isMobile) return;

      const touch = event.touches[0];
      if (!touch) return;

      longPressTriggeredRef.current = false;
      touchStartRef.current = { x: touch.clientX, y: touch.clientY };
      clearLongPressTimer();
      longPressTimerRef.current = window.setTimeout(() => {
        longPressTriggeredRef.current = true;
        setIsActionsOpen(true);
      }, MOBILE_LONG_PRESS_MS);
    },
    [clearLongPressTimer, isMobile]
  );

  const handleTouchMove = useCallback(
    (event: TouchEvent<HTMLAnchorElement>) => {
      if (!isMobile) return;

      const start = touchStartRef.current;
      const touch = event.touches[0];
      if (!start || !touch) return;

      const deltaX = touch.clientX - start.x;
      const deltaY = touch.clientY - start.y;
      if (Math.hypot(deltaX, deltaY) > MOBILE_LONG_PRESS_MOVE_THRESHOLD_PX) {
        clearLongPressTimer();
      }
    },
    [clearLongPressTimer, isMobile]
  );

  const handleTouchEnd = useCallback(() => {
    clearLongPressTimer();
    touchStartRef.current = null;
  }, [clearLongPressTimer]);

  useEffect(() => {
    return () => clearLongPressTimer();
  }, [clearLongPressTimer]);

  return (
    <div
      className={`group relative block px-4 py-2.5 border-l-2 transition ${
        isActive ? "border-l-accent bg-accent-muted" : "border-l-transparent hover:bg-muted"
      }`}
    >
      {isRenaming ? (
        <>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={handleRenameSubmit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                handleCancelRename();
              }
            }}
            className="w-full text-sm bg-transparent text-foreground outline-none focus:ring-inset focus:ring-ring font-medium pr-8"
          />
          <div className="flex items-center gap-1 mt-0.5 text-xs text-muted-foreground">
            <span>{relativeTime}</span>
            {isOrphanChild && (
              <>
                <span>·</span>
                <span className="text-accent">sub-task</span>
              </>
            )}
            {branchLabel && (
              <>
                <span>·</span>
                <BranchIcon className="w-3 h-3 flex-shrink-0" />
                <span className="truncate" title={branchLabel}>
                  {truncateBranchStart(branchLabel)}
                </span>
              </>
            )}
          </div>
        </>
      ) : (
        <Link
          href={buildSessionHref(session)}
          onClick={(event) => {
            if (longPressTriggeredRef.current) {
              event.preventDefault();
              longPressTriggeredRef.current = false;
              return;
            }
            if (isMobile) {
              onSessionSelect?.();
            }
          }}
          onContextMenu={(event) => {
            if (isMobile) {
              event.preventDefault();
            }
          }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
          className="block pr-8"
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <SessionPrStatusIndicator sessionId={session.id} />
            <div className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
              {displayTitle}
            </div>
            {showCompletedIndicator && (
              <span
                className="inline-flex items-center text-success"
                aria-label="Session completed"
                title="Session completed"
              >
                <CheckCircleIcon className="h-3.5 w-3.5" />
              </span>
            )}
            {showWaitingForUserIndicator && (
              <span
                className="inline-flex items-center text-accent"
                aria-label="Waiting for your input"
                title="Waiting for your input"
              >
                <KeyboardIcon className="h-3.5 w-3.5" />
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 mt-0.5 text-xs text-muted-foreground">
            <span>{relativeTime}</span>
            {isOrphanChild && (
              <>
                <span>·</span>
                <span className="text-accent">sub-task</span>
              </>
            )}
            {branchLabel && (
              <>
                <span>·</span>
                <BranchIcon className="w-3 h-3 flex-shrink-0" />
                <span className="truncate" title={branchLabel}>
                  {truncateBranchStart(branchLabel)}
                </span>
              </>
            )}
          </div>
        </Link>
      )}

      <div className="absolute inset-y-0 right-2 flex items-start pt-2">
        <DropdownMenu open={isActionsOpen} onOpenChange={setIsActionsOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Session actions"
              className={`h-6 w-6 items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition data-[state=open]:opacity-100 ${
                isMobile
                  ? "pointer-events-none flex opacity-0"
                  : "flex opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
              }`}
            >
              <MoreIcon className="w-4 h-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handleStartRename}>Rename</DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                setIsActionsOpen(false);
                setShowArchiveDialog(true);
              }}
            >
              Archive
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <AlertDialog open={showArchiveDialog} onOpenChange={setShowArchiveDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive session</AlertDialogTitle>
            <AlertDialogDescription>
              Archive this session? You can restore archived sessions from Settings &gt; Data
              Controls.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleArchive}>Archive</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ChildSessionListItem({
  session,
  isActive,
  isMobile,
  onSessionSelect,
}: {
  session: SessionItem;
  isActive: boolean;
  isMobile: boolean;
  onSessionSelect?: () => void;
}) {
  const timestamp = session.updatedAt || session.createdAt;
  const relativeTime = formatRelativeTime(timestamp);
  const displayTitle = session.title || "Sub-task";
  return (
    <Link
      href={buildSessionHref(session)}
      onClick={() => {
        if (isMobile) {
          onSessionSelect?.();
        }
      }}
      className={`block pl-7 pr-4 py-1.5 border-l-2 transition ${
        isActive ? "border-l-accent bg-accent-muted" : "border-l-transparent hover:bg-muted"
      }`}
    >
      <div className="flex items-center gap-1.5 text-xs">
        <SessionPrStatusIndicator sessionId={session.id} />
        <span className="shrink-0 text-muted-foreground">{relativeTime}</span>
        <span className="truncate font-medium text-foreground">{displayTitle}</span>
      </div>
    </Link>
  );
}

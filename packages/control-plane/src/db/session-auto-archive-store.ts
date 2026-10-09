import { WORKSPACE_ADMIN_ROLE_KEYS } from "@open-inspect/shared/rbac";
import type { TeamsEnforcementMode } from "../authorization/teams-enforcement";
import {
  COMPLETED_SESSION_AUTO_ARCHIVE_AGE_MS,
  FAILED_SESSION_AUTO_ARCHIVE_AGE_MS,
} from "../session/auto-archive-policy";
import { unreadSql } from "./session-read-state";
import type { SqlDatabase } from "./sql-database";

/** Retention reads only; lifecycle changes belong to the session runtime. */
export class SessionAutoArchiveStore {
  constructor(
    private readonly db: SqlDatabase,
    private readonly mode: TeamsEnforcementMode
  ) {}

  async listCandidates(nowMs: number, limit: number): Promise<string[]> {
    const result = await this.db
      .prepare(
        `WITH protected_roots AS MATERIALIZED (
         SELECT DISTINCT COALESCE(member.root_session_id, member.id) AS root_id
         FROM sessions member
         WHERE member.status != 'archived' AND ${this.memberProtectionSql()}
       )
       SELECT s.id FROM sessions s
       WHERE ${this.ageSql()}
         AND NOT EXISTS (
           SELECT 1 FROM protected_roots
           WHERE protected_roots.root_id = COALESCE(s.root_session_id, s.id)
         )
       ORDER BY s.updated_at ASC, s.id ASC LIMIT ?`
      )
      .bind(...this.cutoffs(nowMs), limit)
      .all<{ id: string }>();
    return result.results.map((row) => row.id);
  }

  /** Rechecked inside the runtime because selection and execution may be separated by work. */
  async isEligible(id: string, nowMs: number): Promise<boolean> {
    return (
      (await this.db
        .prepare(`SELECT s.id FROM sessions s WHERE s.id = ? AND ${this.eligibilitySql()}`)
        .bind(id, ...this.cutoffs(nowMs))
        .first()) !== null
    );
  }

  private cutoffs(nowMs: number): number[] {
    return [
      nowMs - COMPLETED_SESSION_AUTO_ARCHIVE_AGE_MS,
      nowMs - FAILED_SESSION_AUTO_ARCHIVE_AGE_MS,
    ];
  }

  private ageSql(): string {
    return `((s.status = 'completed' AND s.updated_at <= ?)
         OR (s.status IN ('failed', 'cancelled') AND s.updated_at <= ?))`;
  }

  private eligibilitySql(): string {
    return `${this.ageSql()} AND NOT EXISTS (
        SELECT 1 FROM sessions member
        WHERE (member.root_session_id = COALESCE(s.root_session_id, s.id)
               OR member.id = COALESCE(s.root_session_id, s.id))
          AND member.status != 'archived' AND ${this.memberProtectionSql()}
      )`;
  }

  private memberProtectionSql(): string {
    return `(
      member.status NOT IN ('completed', 'failed', 'cancelled')
      OR EXISTS (
        SELECT 1 FROM users viewer
        LEFT JOIN session_read_states read_state
          ON read_state.user_id = viewer.id AND read_state.session_id = member.id
        WHERE ${unreadSql("member")} = 1 AND ${this.viewerInvolvementSql()}
          AND ${this.viewerVisibilitySql()}
      )
    )`;
  }

  /**
   * Only viewers tied to the session can hold it open. A visible session that a
   * viewer never opened would otherwise stay unread for them forever, blocking
   * retention workspace-wide for every account that never reads.
   */
  private viewerInvolvementSql(): string {
    return `(
      member.user_id = viewer.id
      OR read_state.user_id IS NOT NULL
      OR EXISTS (
        SELECT 1 FROM session_collaborators involved
        WHERE involved.session_id = member.id AND involved.user_id = viewer.id
      )
    )`;
  }

  /** Mirrors inbox visibility: private collaborators require membership on team-owned sessions. */
  private viewerVisibilitySql(): string {
    const teamVisibility =
      this.mode === "on"
        ? `member.visibility = 'workspace' OR (
          member.visibility = 'team' AND (
            EXISTS (SELECT 1 FROM team_memberships tm
                    WHERE tm.team_id = member.owner_team_id AND tm.user_id = viewer.id)
            OR EXISTS (SELECT 1 FROM user_role_assignments ura
                       JOIN roles r ON r.id = ura.role_id
                       WHERE ura.user_id = viewer.id AND r.key IN (
                         ${WORKSPACE_ADMIN_ROLE_KEYS.map((key) => `'${key}'`).join(", ")}
                       ))
          )
        )`
        : "member.visibility != 'private'";
    return `(${teamVisibility} OR (
      member.visibility = 'private' AND (
        member.user_id = viewer.id OR EXISTS (
          SELECT 1 FROM session_collaborators sc
          WHERE sc.session_id = member.id AND sc.user_id = viewer.id
            AND (member.owner_team_id IS NULL OR EXISTS (
              SELECT 1 FROM team_memberships tm
              WHERE tm.team_id = member.owner_team_id AND tm.user_id = sc.user_id
            ))
        )
      )
    ))`;
  }
}

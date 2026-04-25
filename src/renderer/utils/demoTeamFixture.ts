/**
 * Demo team fixture — pure builders that produce a fully populated TeamData
 * + TeamSummary + per-member MemberFullStats without any IPC.
 *
 * Used by `seedDemoTeam()` so the Aurora dashboard can be presented end-to-end
 * during the hackathon demo without a paid Claude account.
 *
 * All identifiers are deterministic so re-seeding produces stable IDs.
 */

import type {
  InboxMessage,
  KanbanState,
  MemberFullStats,
  ResolvedTeamMember,
  TeamData,
  TeamSummary,
  TeamTaskWithKanban,
} from '@shared/types/team';

export const DEMO_TEAM_NAME = 'demo-engineering';
export const DEMO_TEAM_DISPLAY = 'Demo · Engineering';

interface DemoMemberSeed {
  name: string;
  role: 'reviewer' | 'developer' | 'designer';
  agentType: string;
  color: string;
}

const MEMBERS: DemoMemberSeed[] = [
  { name: 'alice', role: 'reviewer', agentType: 'reviewer', color: 'violet' },
  { name: 'tom', role: 'developer', agentType: 'developer', color: 'cyan' },
  { name: 'bob', role: 'developer', agentType: 'developer', color: 'green' },
  { name: 'jack', role: 'developer', agentType: 'developer', color: 'orange' },
];

interface TaskSeed {
  id: string;
  subject: string;
  description: string;
  owner: string;
  status: 'pending' | 'in_progress' | 'completed';
  column: 'todo' | 'in_progress' | 'review' | 'done';
  blockedBy?: string[];
  ageMinutes: number;
}

const TASKS: TaskSeed[] = [
  {
    id: 'demo-task-001',
    subject: 'Wire onboarding flow to /api/auth/signup',
    description:
      'Move the signup form from the design system into the onboarding route and POST to /api/auth/signup. Persist the JWT in secure storage.',
    owner: 'tom',
    status: 'in_progress',
    column: 'in_progress',
    ageMinutes: 12,
  },
  {
    id: 'demo-task-002',
    subject: 'Refactor billing webhook to handle subscription_updated',
    description:
      'Stripe sends subscription_updated alongside customer_subscription_updated. Consolidate handling and idempotency keys.',
    owner: 'bob',
    status: 'in_progress',
    column: 'in_progress',
    ageMinutes: 27,
  },
  {
    id: 'demo-task-003',
    subject: 'Migrate sessions table to UUID v7',
    description:
      'Old sessions table uses bigserial. Generate a back-compat migration that adds a uuid column, backfills, and renames.',
    owner: 'jack',
    status: 'pending',
    column: 'todo',
    ageMinutes: 41,
  },
  {
    id: 'demo-task-004',
    subject: 'Add rate-limit middleware for /api/share',
    description:
      'Apply a 60req/min ip-keyed limiter. Return RateLimit-* headers and 429 with retry-after.',
    owner: 'jack',
    status: 'pending',
    column: 'todo',
    ageMinutes: 58,
  },
  {
    id: 'demo-task-005',
    subject: 'Audit unused feature flags',
    description: 'Sweep growthbook for flags 100% rolled out for >30d. Open removal PRs.',
    owner: 'tom',
    status: 'pending',
    column: 'todo',
    blockedBy: ['demo-task-002'],
    ageMinutes: 65,
  },
  {
    id: 'demo-task-006',
    subject: 'Replace deprecated Image component in Settings',
    description: 'next/image migration for the Settings tabs. Verify with Lighthouse.',
    owner: 'bob',
    status: 'completed',
    column: 'review',
    ageMinutes: 78,
  },
  {
    id: 'demo-task-007',
    subject: 'Document new onboarding telemetry events',
    description:
      'Once the new flow ships we need an entry in docs/telemetry/onboarding.md and Linear-team awareness.',
    owner: 'alice',
    status: 'completed',
    column: 'review',
    ageMinutes: 92,
  },
  {
    id: 'demo-task-008',
    subject: 'Fix flaky e2e: signup → first-task',
    description: 'Cypress run #4827 — locator race on the celebration confetti.',
    owner: 'tom',
    status: 'completed',
    column: 'done',
    ageMinutes: 130,
  },
  {
    id: 'demo-task-009',
    subject: 'Bump postgres client to 8.13',
    description: 'CVE-2025-XXXX. Patch + release-notes ping in #eng-releases.',
    owner: 'bob',
    status: 'completed',
    column: 'done',
    ageMinutes: 165,
  },
  {
    id: 'demo-task-010',
    subject: 'Add CTA tracking on the new pricing page',
    description: 'Two events: pricing_cta_clicked (with plan slug) and pricing_view.',
    owner: 'jack',
    status: 'completed',
    column: 'done',
    ageMinutes: 220,
  },
];

const TEAMMATE_MESSAGES: { from: string; to: string; text: string; ageMinutes: number }[] = [
  {
    from: 'tom',
    to: 'bob',
    text: 'I need /api/auth/signup to return the JWT in the body, not just a cookie. OK?',
    ageMinutes: 18,
  },
  {
    from: 'bob',
    to: 'tom',
    text: 'Done — the response now has { token, user }. Cookie still set for legacy.',
    ageMinutes: 16,
  },
  {
    from: 'jack',
    to: 'alice',
    text: 'Pushed the migration. Marked task-003 ready for review when you have a sec.',
    ageMinutes: 9,
  },
  {
    from: 'alice',
    to: 'tom',
    text: 'Telemetry doc reads great. Approving.',
    ageMinutes: 4,
  },
];

const USER_MESSAGES: { text: string; ageMinutes: number }[] = [
  {
    text: 'Welcome to the team! Build me a TODO app with auth, billing, and a kanban for the team to dogfood.',
    ageMinutes: 240,
  },
  {
    text: 'Use Postgres, not SQLite. Stripe for billing.',
    ageMinutes: 235,
  },
  {
    text: 'Quick check-in — how are we doing on the onboarding flow?',
    ageMinutes: 22,
  },
];

function isoMinutesAgo(now: number, minutes: number): string {
  return new Date(now - minutes * 60_000).toISOString();
}

function buildMembers(now: number): ResolvedTeamMember[] {
  return MEMBERS.map((seed, idx) => {
    const owned = TASKS.filter((t) => t.owner === seed.name);
    const inProgress = owned.find((t) => t.status === 'in_progress');
    return {
      name: seed.name,
      agentId: `demo-agent-${seed.name}`,
      status: 'active',
      currentTaskId: inProgress?.id ?? null,
      taskCount: owned.length,
      lastActiveAt: isoMinutesAgo(now, 1 + idx * 2),
      messageCount: TEAMMATE_MESSAGES.filter((m) => m.from === seed.name || m.to === seed.name)
        .length,
      color: seed.color,
      agentType: seed.agentType,
      role: seed.role,
      workflow:
        seed.role === 'reviewer'
          ? 'Review every completed task. Approve or request changes with clear feedback.'
          : 'Pick up tasks from the backlog. Implement, test, and hand off to review.',
    };
  });
}

function buildTasks(now: number): TeamTaskWithKanban[] {
  return TASKS.map((seed) => {
    const createdAt = isoMinutesAgo(now, seed.ageMinutes + 30);
    const updatedAt = isoMinutesAgo(now, seed.ageMinutes);
    const kanbanColumn: 'review' | 'approved' | undefined =
      seed.column === 'review' ? 'review' : seed.column === 'done' ? 'approved' : undefined;
    return {
      id: seed.id,
      displayId: seed.id.replace('demo-task-0', 'T-'),
      subject: seed.subject,
      description: seed.description,
      owner: seed.owner,
      createdBy: seed.owner,
      status: seed.status,
      blockedBy: seed.blockedBy,
      createdAt,
      updatedAt,
      kanbanColumn,
      reviewer: kanbanColumn === 'review' ? 'alice' : null,
    };
  });
}

function buildKanbanState(): KanbanState {
  const tasks: KanbanState['tasks'] = {};
  const reviewIds: string[] = [];
  const approvedIds: string[] = [];
  for (const seed of TASKS) {
    if (seed.column === 'review') {
      tasks[seed.id] = {
        column: 'review',
        reviewer: 'alice',
        movedAt: isoMinutesAgo(Date.now(), seed.ageMinutes),
      };
      reviewIds.push(seed.id);
    } else if (seed.column === 'done') {
      tasks[seed.id] = {
        column: 'approved',
        reviewer: 'alice',
        movedAt: isoMinutesAgo(Date.now(), seed.ageMinutes),
      };
      approvedIds.push(seed.id);
    }
  }
  return {
    teamName: DEMO_TEAM_NAME,
    reviewers: ['alice'],
    tasks,
    columnOrder: { review: reviewIds, approved: approvedIds },
  };
}

function buildMessages(now: number): InboxMessage[] {
  const fromUser: InboxMessage[] = USER_MESSAGES.map((m, idx) => ({
    from: 'user',
    to: 'lead',
    text: m.text,
    timestamp: isoMinutesAgo(now, m.ageMinutes),
    read: true,
    source: 'user_sent',
    messageId: `demo-msg-user-${idx}`,
  }));

  const fromTeammates: InboxMessage[] = TEAMMATE_MESSAGES.map((m, idx) => ({
    from: m.from,
    to: m.to,
    text: m.text,
    timestamp: isoMinutesAgo(now, m.ageMinutes),
    read: m.ageMinutes > 8,
    source: 'inbox',
    messageId: `demo-msg-tm-${idx}`,
    summary: `${m.from} → ${m.to}`,
    color: MEMBERS.find((mm) => mm.name === m.from)?.color,
  }));

  return [...fromUser, ...fromTeammates].sort((a, b) =>
    a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0
  );
}

export function buildDemoTeamData(): TeamData {
  const now = Date.now();
  const members = buildMembers(now);
  const tasks = buildTasks(now);
  const messages = buildMessages(now);
  const kanbanState = buildKanbanState();

  return {
    teamName: DEMO_TEAM_NAME,
    config: {
      name: DEMO_TEAM_NAME,
      description:
        'Pre-seeded demo team. No live agents — used to walk through the kanban, chat, and review flows without a Claude session.',
      color: 'violet',
      members: members.map((m) => ({
        name: m.name,
        role: m.role,
        workflow: m.workflow,
      })),
    },
    tasks,
    members,
    messages,
    kanbanState,
    processes: [],
    isAlive: true,
    isDemo: true,
  };
}

export function buildDemoTeamSummary(): TeamSummary {
  return {
    teamName: DEMO_TEAM_NAME,
    displayName: DEMO_TEAM_DISPLAY,
    description: 'Pre-seeded demo team for the hackathon walkthrough.',
    color: 'violet',
    memberCount: MEMBERS.length,
    members: MEMBERS.map((m) => ({ name: m.name, role: m.role })),
    taskCount: TASKS.length,
    lastActivity: new Date(Date.now() - 2 * 60_000).toISOString(),
    teamLaunchState: 'clean_success',
    confirmedCount: MEMBERS.length,
    pendingCount: 0,
    failedCount: 0,
    isDemo: true,
  };
}

const DEMO_STATS_BY_NAME: Record<string, MemberFullStats> = {
  alice: {
    linesAdded: 312,
    linesRemoved: 84,
    filesTouched: ['docs/telemetry/onboarding.md', 'src/review/checklist.ts'],
    fileStats: {
      'docs/telemetry/onboarding.md': { added: 110, removed: 6 },
      'src/review/checklist.ts': { added: 202, removed: 78 },
    },
    toolUsage: { Read: 42, Edit: 8, SendMessage: 6, TaskUpdate: 4 },
    inputTokens: 28_400,
    outputTokens: 6_900,
    cacheReadTokens: 12_800,
    costUsd: 0.42,
    tasksCompleted: 2,
    messageCount: 7,
    totalDurationMs: 18 * 60_000,
    sessionCount: 1,
    computedAt: new Date().toISOString(),
  },
  tom: {
    linesAdded: 1_240,
    linesRemoved: 322,
    filesTouched: ['src/onboarding/SignupForm.tsx', 'src/api/auth.ts', 'src/lib/secure-storage.ts'],
    fileStats: {
      'src/onboarding/SignupForm.tsx': { added: 480, removed: 110 },
      'src/api/auth.ts': { added: 520, removed: 180 },
      'src/lib/secure-storage.ts': { added: 240, removed: 32 },
    },
    toolUsage: { Read: 86, Edit: 24, Write: 4, Bash: 11, SendMessage: 5, TaskUpdate: 3 },
    inputTokens: 92_500,
    outputTokens: 22_400,
    cacheReadTokens: 38_900,
    costUsd: 1.46,
    tasksCompleted: 2,
    messageCount: 9,
    totalDurationMs: 47 * 60_000,
    sessionCount: 1,
    computedAt: new Date().toISOString(),
  },
  bob: {
    linesAdded: 980,
    linesRemoved: 412,
    filesTouched: ['src/billing/webhook.ts', 'src/billing/idempotency.ts'],
    fileStats: {
      'src/billing/webhook.ts': { added: 720, removed: 280 },
      'src/billing/idempotency.ts': { added: 260, removed: 132 },
    },
    toolUsage: { Read: 64, Edit: 18, Bash: 9, SendMessage: 4, TaskUpdate: 2 },
    inputTokens: 71_200,
    outputTokens: 17_800,
    cacheReadTokens: 29_400,
    costUsd: 1.08,
    tasksCompleted: 2,
    messageCount: 6,
    totalDurationMs: 36 * 60_000,
    sessionCount: 1,
    computedAt: new Date().toISOString(),
  },
  jack: {
    linesAdded: 614,
    linesRemoved: 92,
    filesTouched: ['migrations/2026_uuid_v7.sql', 'src/middleware/rate-limit.ts'],
    fileStats: {
      'migrations/2026_uuid_v7.sql': { added: 240, removed: 12 },
      'src/middleware/rate-limit.ts': { added: 374, removed: 80 },
    },
    toolUsage: { Read: 38, Edit: 12, Write: 2, SendMessage: 3, TaskUpdate: 2 },
    inputTokens: 44_800,
    outputTokens: 10_200,
    cacheReadTokens: 19_300,
    costUsd: 0.71,
    tasksCompleted: 1,
    messageCount: 5,
    totalDurationMs: 24 * 60_000,
    sessionCount: 1,
    computedAt: new Date().toISOString(),
  },
};

export function getDemoMemberStats(memberName: string): MemberFullStats | null {
  return DEMO_STATS_BY_NAME[memberName] ?? null;
}

export function isDemoTeamName(name: string | null | undefined): boolean {
  return name === DEMO_TEAM_NAME;
}

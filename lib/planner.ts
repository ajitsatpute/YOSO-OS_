import type { PlannerPerson, WorkItem } from "./types";

export type PlanRow = WorkItem & {
  assignedTo?: string;
  reason: string;
  overCapacity?: boolean;
  missesDate?: boolean;
  suggestedFix: string;
  assignedToName?: string;
};

export type Overrides = {
  awayPersonId?: string;
  awayWeek?: number;
  leavePersonId?: string;
  volumeMultiplier?: number;
  newClient?: boolean;
  dueDateShiftDays?: number;
  podLeadAwayId?: string;
  targetPodId?: string;
};

const tierFactor: Record<string, number> = {
  intern: 1.35,
  junior: 1.2,
  standard: 1,
  senior: 0.85,
  lead: 0.9,
};

const DAY = 86400000;

function mondayStart() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d;
}

function topoSortByDueDate(items: WorkItem[]): WorkItem[] {
  const byId = new Map(items.map((t) => [t.id, t]));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const ordered: WorkItem[] = [];

  const sortedInput = [...items].sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  function visit(task: WorkItem) {
    if (visited.has(task.id)) return;
    if (visiting.has(task.id)) return; // guard cycle
    visiting.add(task.id);
    for (const depId of task.dependsOn || []) {
      const dep = byId.get(depId);
      if (dep) visit(dep);
    }
    visiting.delete(task.id);
    visited.add(task.id);
    ordered.push(task);
  }

  for (const t of sortedInput) visit(t);
  return ordered;
}

export function buildPlan(
  people: PlannerPerson[],
  items: WorkItem[],
  overrides: Overrides = {}
) {
  const start = mondayStart();
  const hours = new Map<string, number>();
  const result: PlanRow[] = [];
  const assignedWeeks = new Map<string, number>();

  items.filter((x) => x.status === "done").forEach((x) => assignedWeeks.set(x.id, 0));

  const activeItems = overrides.targetPodId
    ? items.filter((x) => x.podId === overrides.targetPodId)
    : items;

  const expanded = activeItems
    .filter((x) => x.status !== "done")
    .flatMap((task) => {
      const copies: WorkItem[] = [task];
      if ((overrides.volumeMultiplier || 1) > 1) {
        const mult = Math.min(4, Math.floor(overrides.volumeMultiplier || 1));
        for (let n = 1; n < mult; n++) {
          copies.push({
            ...task,
            id: `${task.id}-extra-${n}`,
            title: `${task.title} (additional ${n})`,
            assignedTo: undefined,
            status: "open",
          });
        }
      }
      return copies;
    });

  if (overrides.newClient && activeItems.length) {
    for (const t of activeItems.slice(0, Math.min(4, activeItems.length))) {
      expanded.push({
        ...t,
        id: `new-client-${t.id}`,
        clientId: "scenario-new-client",
        title: `New client · ${t.title}`,
        assignedTo: undefined,
        status: "open",
      });
    }
  }

  const shifted = expanded.map((t) =>
    overrides.dueDateShiftDays
      ? {
          ...t,
          dueDate: new Date(
            new Date(`${t.dueDate}T00:00:00Z`).getTime() +
              overrides.dueDateShiftDays * DAY
          )
            .toISOString()
            .slice(0, 10),
        }
      : t
  );

  const sorted = topoSortByDueDate(shifted);

  for (const task of sorted) {
    const dueMs = new Date(`${task.dueDate}T00:00:00Z`).getTime();
    const dueWeek = Math.min(
      4,
      Math.max(0, Math.ceil((dueMs - start.getTime() + 1) / (7 * DAY)))
    );

    const candidateWeeks = [
      task.week,
      ...Array.from({ length: task.week - 1 }, (_, i) => task.week - 1 - i),
      ...Array.from({ length: Math.max(0, dueWeek - task.week) }, (_, i) => task.week + 1 + i),
    ].filter((w, i, a) => w >= 1 && w <= dueWeek && a.indexOf(w) === i);

    let best: PlannerPerson | undefined;
    let bestWeek: number | undefined;
    let bestLoad = Infinity;

    const blockedDependency = (week: number) =>
      (task.dependsOn || []).some(
        (dep) => !assignedWeeks.has(dep) || assignedWeeks.get(dep)! > week
      );

    // Keep existing assignee first to minimize reshuffle
    const candidates = [...people].sort(
      (a, b) => Number(b.id === task.assignedTo) - Number(a.id === task.assignedTo)
    );

    for (const week of candidateWeeks) {
      if (blockedDependency(week)) continue;

      for (const p of candidates) {
        if (p.craft !== task.craft || p.podId !== task.podId) continue;
        if (overrides.leavePersonId === p.id) continue;
        if (overrides.awayPersonId === p.id && overrides.awayWeek === week) continue;
        if (overrides.podLeadAwayId === p.id && p.tier === "lead") continue;

        const key = `${p.id}:${week}`;
        const used = hours.get(key) || 0;
        const capacity = p.leaveWeeks.includes(week) ? 0 : p.weeklyHours;
        const estimate = task.estimatedHours * tierFactor[p.tier];

        if (used + estimate <= capacity) {
          if (p.id === task.assignedTo && week === task.week) {
            best = p;
            bestWeek = week;
            bestLoad = used;
            break;
          }
          if (used < bestLoad) {
            best = p;
            bestWeek = week;
            bestLoad = used;
          }
        }
      }

      if (best && best.id === task.assignedTo && bestWeek === task.week) break;
    }

    if (best && bestWeek) {
      const key = `${best.id}:${bestWeek}`;
      hours.set(key, (hours.get(key) || 0) + task.estimatedHours * tierFactor[best.tier]);
      assignedWeeks.set(task.id, bestWeek);
    }

    const selectedWeek = bestWeek || task.week;
    const weekStart = new Date(start.getTime() + (selectedWeek - 1) * 7 * DAY);
    const missesDate = dueWeek === 0 || dueMs < weekStart.getTime();
    const dependencyMissing = (task.dependsOn || []).some(
      (dep) => !assignedWeeks.has(dep)
    );

    const reason = best
      ? best.id === task.assignedTo && bestWeek === task.week
        ? `Kept existing assignee ${best.name} (${best.tier}) in week ${selectedWeek}; ${Math.round(bestLoad)}h prior load.`
        : `Assigned to ${best.name} (${best.tier}) in pod ${best.podId} for week ${selectedWeek}; ${Math.round(bestLoad)}h prior load.`
      : dependencyMissing
        ? `Blocked because prerequisite deliverable (${(task.dependsOn || []).join(", ")}) is unscheduled.`
        : `No eligible ${task.craft} capacity in pod ${task.podId} before due date ${task.dueDate}.`;

    const suggestedFix = missesDate
      ? `Move due date to ${weekStart.toISOString().slice(0, 10)} (4+ days later) or pull prerequisite work earlier.`
      : dependencyMissing
        ? "Schedule the prerequisite deliverable in an earlier week first."
        : !best
          ? `Pod ${task.podId} is short ~${task.estimatedHours}h of ${task.craft} capacity in week ${selectedWeek}; move due date by 7 days or raise a cross-pod request (request only, no direct cross-pod assignment).`
          : "No change required.";

    result.push({
      ...task,
      week: selectedWeek,
      assignedTo: best?.id,
      assignedToName: best?.name,
      missesDate,
      reason,
      suggestedFix,
      overCapacity: !best,
    });
  }

  const scopedPeople = overrides.targetPodId
    ? people.filter((p) => p.podId === overrides.targetPodId)
    : people;

  const personUsage = scopedPeople.map((p) => {
    const planned = [1, 2, 3, 4].reduce(
      (sum, w) => sum + (hours.get(`${p.id}:${w}`) || 0),
      0
    );
    const activeWeeks = [1, 2, 3, 4].filter((w) => {
      if (overrides.leavePersonId === p.id) return false;
      if (overrides.awayPersonId === p.id && overrides.awayWeek === w) return false;
      if (overrides.podLeadAwayId === p.id && p.tier === "lead") return false;
      return !p.leaveWeeks.includes(w);
    }).length;
    const capacity = p.weeklyHours * activeWeeks;
    const utilisation = capacity ? Math.round((planned / capacity) * 100) : planned > 0 ? 100 : 0;

    return {
      id: p.id,
      name: p.name,
      podId: p.podId,
      podName: p.podName || p.podId,
      tier: p.tier,
      planned: Number(planned.toFixed(1)),
      capacity,
      utilisation,
      fragile: utilisation >= 90 && utilisation <= 100,
      overCapacity: planned > capacity,
    };
  });

  const podUsage = scopedPeople.reduce<
    Record<string, { name: string; planned: number; capacity: number; utilisation: number; fragile: boolean }>
  >((acc, p) => {
    const usage = personUsage.find((x) => x.id === p.id)!;
    const row = acc[p.podId] || { name: p.podName || p.podId, planned: 0, capacity: 0, utilisation: 0, fragile: false };
    row.planned = Number((row.planned + usage.planned).toFixed(1));
    row.capacity += usage.capacity;
    row.utilisation = row.capacity ? Math.round((row.planned / row.capacity) * 100) : 0;
    row.fragile = row.utilisation >= 90;
    acc[p.podId] = row;
    return acc;
  }, {});

  const impossible = result.filter((x) => !x.assignedTo || x.missesDate);

  return {
    assignments: result,
    podUsage,
    personUsage,
    impossible,
    feasible: impossible.length === 0,
    summary: impossible.length
      ? `${impossible.length} deliverable(s) cannot be scheduled cleanly due to capacity, dependencies, or due dates.`
      : "All deliverables fit within modeled pod capacity and due dates.",
  };
}

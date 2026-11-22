
import { describe, it, expect } from "vitest";
import { buildPlan } from "../lib/planner";
import type { PlannerPerson, WorkItem } from "../lib/types";

function mondayStart() {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date;
}

function dueInWeek(week: number) {
  const date = mondayStart();
  date.setUTCDate(date.getUTCDate() + week * 7 - 1);
  return date.toISOString().slice(0, 10);
}

function daysAgo(days: number) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

const people: PlannerPerson[] = [
  {
    id: "e1",
    name: "Editor One",
    craft: "editor",
    tier: "standard",
    podId: "video-a",
    weeklyHours: 10,
    leaveWeeks: [],
  },
  {
    id: "e2",
    name: "Editor Two",
    craft: "editor",
    tier: "standard",
    podId: "video-a",
    weeklyHours: 10,
    leaveWeeks: [],
  },
  {
    id: "lead1",
    name: "Video Lead",
    craft: "editor",
    tier: "lead",
    podId: "video-a",
    weeklyHours: 10,
    leaveWeeks: [],
  },
  {
    id: "w1",
    name: "Writer One",
    craft: "writer",
    tier: "standard",
    podId: "writing",
    weeklyHours: 10,
    leaveWeeks: [],
  },
  {
    id: "d1",
    name: "Designer One",
    craft: "designer",
    tier: "standard",
    podId: "design",
    weeklyHours: 10,
    leaveWeeks: [],
  },
  {
    id: "a1",
    name: "Account Manager",
    craft: "account_manager",
    tier: "standard",
    podId: "accounts",
    weeklyHours: 10,
    leaveWeeks: [],
  },
];

function task(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "t1",
    title: "Edit campaign video",
    clientId: "client-1",
    craft: "editor",
    podId: "video-a",
    dueDate: dueInWeek(1),
    estimatedHours: 6,
    week: 1,
    status: "open",
    dependsOn: [],
    ...overrides,
  };
}

describe("YOSO OS four-week capacity planner", () => {
  it("1. assigns an eligible deliverable", () => {
    const plan = buildPlan(people, [task()]);
    expect(plan.assignments[0].assignedTo).toBeTruthy();
    expect(plan.feasible).toBe(true);
  });

  it("2. assigns work only to the required craft", () => {
    const plan = buildPlan(people, [task()]);
    const assigned = people.find(
      (person) => person.id === plan.assignments[0].assignedTo
    );
    expect(assigned?.craft).toBe("editor");
  });

  it("3. does not assign work across pod boundaries", () => {
    const plan = buildPlan(
      people,
      [task({ podId: "video-b" })]
    );
    expect(plan.assignments[0].assignedTo).toBeUndefined();
    expect(plan.feasible).toBe(false);
  });

  it("4. does not exceed a person's weekly capacity", () => {
    const work = [
  task({ id: "t1", estimatedHours: 8 }),
  task({ id: "t2", estimatedHours: 8 }),
  task({ id: "t3", estimatedHours: 8 }),
  task({ id: "t4", estimatedHours: 8 }),
];
    const plan = buildPlan(people, work);

    for (const usage of plan.personUsage) {
      expect(usage.planned).toBeLessThanOrEqual(
        usage.capacity
      );
    }
    expect(plan.impossible.length).toBeGreaterThan(0);
  });

  it("5. respects planned leave", () => {
    const peopleOnLeave = people.map((person) =>
      person.id === "e1"
        ? { ...person, leaveWeeks: [1] }
        : person
    );

    const plan = buildPlan(peopleOnLeave, [task()]);
    expect(plan.assignments[0].assignedTo).not.toBe("e1");
  });

  it("6. handles a person being away for one week", () => {
    const plan = buildPlan(people, [task()], {
      awayPersonId: "e1",
      awayWeek: 1,
    });

    expect(plan.assignments[0].assignedTo).not.toBe("e1");
  });

  it("7. handles a person leaving the planning horizon", () => {
    const plan = buildPlan(people, [task()], {
      leavePersonId: "e1",
    });

    expect(plan.assignments[0].assignedTo).not.toBe("e1");
  });

  it("8. preserves an existing eligible assignment", () => {
    const plan = buildPlan(
      people,
      [task({ assignedTo: "e2" })]
    );

    expect(plan.assignments[0].assignedTo).toBe("e2");
  });

  it("9. schedules a prerequisite before its dependent task", () => {
    const work = [
  task({ id: "t1", estimatedHours: 8 }),
  task({ id: "t2", estimatedHours: 8 }),
  task({ id: "t3", estimatedHours: 8 }),
  task({ id: "t4", estimatedHours: 8 }),
];

    const plan = buildPlan(people, work);
    const script = plan.assignments.find((x) => x.id === "script");
    const edit = plan.assignments.find((x) => x.id === "edit");

    expect(script?.assignedTo).toBeTruthy();
    expect(edit?.assignedTo).toBeTruthy();
    expect(edit!.week).toBeGreaterThanOrEqual(script!.week);
  });

  it("10. marks a task with a missing prerequisite impossible", () => {
    const plan = buildPlan(
      people,
      [task({ dependsOn: ["missing-task"] })]
    );

    expect(plan.feasible).toBe(false);
    expect(plan.impossible.some((x) => x.id === "t1")).toBe(true);
  });

  it("11. handles circular dependencies without crashing", () => {
    const work = [
  task({ id: "t1", estimatedHours: 8 }),
  task({ id: "t2", estimatedHours: 8 }),
  task({ id: "t3", estimatedHours: 8 }),
  task({ id: "t4", estimatedHours: 8 }),
];

    const plan = buildPlan(people, work);

    expect(plan.feasible).toBe(false);
    expect(plan.impossible.length).toBeGreaterThan(0);
  });

  it("12. marks overdue work as impossible", () => {
    const plan = buildPlan(
      people,
      [task({ dueDate: daysAgo(2) })]
    );

    expect(plan.feasible).toBe(false);
    expect(plan.assignments[0].missesDate).toBe(true);
  });

  it("13. doubles work in a volume what-if scenario", () => {
    const plan = buildPlan(people, [task()], {
      volumeMultiplier: 2,
    });

    expect(plan.assignments.length).toBe(2);
  });

  it("14. adds work for a new-client what-if scenario", () => {
    const plan = buildPlan(people, [task()], {
      newClient: true,
    });

    expect(plan.assignments.length).toBe(2);
    expect(
      plan.assignments.some(
        (x) => x.clientId === "scenario-new-client"
      )
    ).toBe(true);
  });

  it("15. limits a pod-scoped plan to that pod", () => {
    const work = [
      task({ id: "video-task", podId: "video-a" }),
      task({
        id: "writing-task",
        craft: "writer",
        podId: "writing",
      }),
    ];

    const plan = buildPlan(people, work, {
      targetPodId: "video-a",
    });

    expect(plan.assignments.every(
      (x) => x.podId === "video-a"
    )).toBe(true);
  });

  it("16. reduces modeled capacity when the pod lead is away", () => {
    const baseline = buildPlan(people, [task()]);
    const away = buildPlan(people, [task()], {
      podLeadAwayId: "lead1",
    });

    const before = baseline.personUsage.find(
      (x) => x.id === "lead1"
    )!;
    const after = away.personUsage.find(
      (x) => x.id === "lead1"
    )!;

    expect(after.capacity).toBeLessThan(before.capacity);
  });

  it("17. reports an impossible task when no eligible person exists", () => {
    const plan = buildPlan(
      [],
      [task()]
    );

    expect(plan.feasible).toBe(false);
    expect(plan.impossible.length).toBe(1);
    expect(plan.assignments[0].suggestedFix).toBeTruthy();
  });

  it("18. completes an 80-deliverable sample quickly", () => {
    const samplePeople: PlannerPerson[] = Array.from(
      { length: 30 },
      (_, i) => ({
        id: `person-${i}`,
        name: `Person ${i}`,
        craft: (["editor", "writer", "designer", "account_manager"] as const)[i % 4],
        tier: "standard",
        podId: (
          ["video-a", "writing", "design", "accounts"] as const
        )[i % 4],
        weeklyHours: 36,
        leaveWeeks: [],
      })
    );

    const sampleTasks = Array.from(
      { length: 80 },
      (_, i) =>
        task({
          id: `sample-${i}`,
          estimatedHours: 4,
          week: (i % 4) + 1,
          dueDate: dueInWeek((i % 4) + 1),
          craft: (
            ["editor", "writer", "designer", "account_manager"] as const
          )[i % 4],
          podId: (
            ["video-a", "writing", "design", "accounts"] as const
          )[i % 4],
        })
    );

    const started = performance.now();
    const plan = buildPlan(samplePeople, sampleTasks);
    const elapsed = performance.now() - started;

    expect(plan.assignments).toHaveLength(80);
    expect(elapsed).toBeLessThan(2000);
  });
});

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildPlan } from "@/lib/planner";

async function getData() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) {
    return { error: "Unauthorized" as const, status: 401 as const };
  }

  const { data: profile } = await sb
    .from("profiles")
    .select("role, pod_id")
    .eq("id", user.id)
    .single();

  if (!profile || !(profile.role === "founder" || profile.role === "pod_lead")) {
    return {
      error: "Only founders and pod leads can access capacity planning." as const,
      status: 403 as const,
    };
  }

  const [{ data: people }, { data: items }, { data: pods }] = await Promise.all([
    sb
      .from("employees")
      .select("id,name,craft,tier,pod_id,weekly_hours,leave_weeks"),
    sb
      .from("deliverables")
      .select(
        "id,title,client_id,pod_id,craft,due_date,estimated_hours,week,assigned_to,status,depends_on"
      ),
    sb.from("pods").select("id,name"),
  ]);
  const podNames = new Map((pods || []).map((pod: any) => [pod.id, pod.name]));

  return {
    role: profile.role as "founder" | "pod_lead",
    podId: profile.pod_id as string | null,
    people: (people || []).map((p: any) => ({
      id: p.id,
      name: p.name,
      craft: p.craft,
      tier: p.tier,
      podId: p.pod_id,
      podName: podNames.get(p.pod_id) || p.pod_id,
      weeklyHours: Number(p.weekly_hours),
      leaveWeeks: p.leave_weeks || [],
    })),
    items: (items || []).map((x: any) => ({
      id: x.id,
      title: x.title,
      clientId: x.client_id,
      podId: x.pod_id,
      craft: x.craft,
      dueDate: x.due_date,
      estimatedHours: Number(x.estimated_hours),
      week: x.week,
      assignedTo: x.assigned_to || undefined,
      status: x.status,
      dependsOn: x.depends_on || [],
    })),
  };
}

export async function GET() {
  const d = await getData();
  if ("error" in d) {
    return NextResponse.json({ error: d.error }, { status: d.status });
  }
  return NextResponse.json({ plan: buildPlan(d.people, d.items) });
}

export async function POST(req: NextRequest) {
  const d = await getData();
  if ("error" in d) {
    return NextResponse.json({ error: d.error }, { status: d.status });
  }

  const raw = await req.json();
  const overrides = {
    awayPersonId: typeof raw.awayPersonId === "string" ? raw.awayPersonId : undefined,
    awayWeek: typeof raw.awayWeek === "number" ? raw.awayWeek : undefined,
    leavePersonId: typeof raw.leavePersonId === "string" ? raw.leavePersonId : undefined,
    volumeMultiplier:
      typeof raw.volumeMultiplier === "number" ? raw.volumeMultiplier : undefined,
    newClient: typeof raw.newClient === "boolean" ? raw.newClient : undefined,
    dueDateShiftDays:
      typeof raw.dueDateShiftDays === "number" ? raw.dueDateShiftDays : undefined,
    podLeadAwayId:
      typeof raw.podLeadAwayId === "string" ? raw.podLeadAwayId : undefined,
    targetPodId: d.role === "pod_lead" ? d.podId || undefined : undefined,
  };

  return NextResponse.json({
    plan: buildPlan(d.people, d.items, overrides),
    persisted: false,
  });
}

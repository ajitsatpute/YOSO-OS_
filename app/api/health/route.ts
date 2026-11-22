import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { scoreClient, type ChatMessage } from "@/lib/health";

const RULE_VERSION = 1;

function mondayUTC(d: Date) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = x.getUTCDay();
  x.setUTCDate(x.getUTCDate() - (day === 0 ? 6 : day - 1));
  return x.toISOString().slice(0, 10);
}

const rank: Record<string, number> = { Healthy: 0, Watch: 1, "At risk": 2 };

export async function GET() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await sb
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const { data: clients, error } = await sb
    .from("clients")
    .select("id,name,account_manager_id")
    .order("name");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const admin = process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createSupabaseClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
        { auth: { persistSession: false, autoRefreshToken: false } }
      )
    : sb;

  const weekStart = mondayUTC(new Date());
  const out: any[] = [];

  for (const c of clients || []) {
    const { data, error: msgError } = await admin
      .from("chat_messages")
      .select(
        "id,client_id,sent_at,sender_role,sender_name,type,text,edited_at,deleted_at"
      )
      .eq("client_id", c.id)
      .gte("sent_at", new Date(Date.now() - 90 * 86400000).toISOString());

    if (msgError) continue;

    const { data: current } = await admin
      .from("client_health_scores")
      .select("score,label,signals,rule_version")
      .eq("client_id", c.id)
      .eq("week_start", weekStart)
      .eq("rule_version", RULE_VERSION)
      .maybeSingle();

    const mappedMessages: ChatMessage[] = (data || []).map((m: any) => ({
      id: m.id,
      clientId: m.client_id,
      sentAt: m.sent_at,
      senderRole: m.sender_role,
      senderName: m.sender_name,
      type: m.type,
      text: m.text,
      editedAt: m.edited_at,
      deletedAt: m.deleted_at,
    }));

    const scored = current
      ? {
          score: current.score,
          label: current.label,
          signals: current.signals,
          windowStart: weekStart,
          messageCount: mappedMessages.filter((m) => !m.deletedAt).length,
        }
      : scoreClient(mappedMessages);

    if (!current) {
      const { data: previous } = await admin
        .from("client_health_scores")
        .select("label,score,week_start")
        .eq("client_id", c.id)
        .lt("week_start", weekStart)
        .order("week_start", { ascending: false })
        .limit(1)
        .maybeSingle();

      await admin.from("client_health_scores").insert({
        client_id: c.id,
        week_start: weekStart,
        score: scored.score,
        label: scored.label,
        rule_version: RULE_VERSION,
        signals: scored.signals,
      });

      if (
        previous &&
        rank[scored.label] > rank[previous.label] &&
        c.account_manager_id
      ) {
        await admin.from("health_alerts").upsert(
          {
            client_id: c.id,
            account_manager_id: c.account_manager_id,
            from_label: previous.label,
            to_label: scored.label,
            week_start: weekStart,
            rule_version: RULE_VERSION,
          },
          {
            onConflict: "client_id,from_label,to_label,week_start,rule_version",
            ignoreDuplicates: true,
          }
        );
      }
    }

    const citedIds = new Set(
      (scored.signals || []).flatMap((s: any) => s.messageIds || [])
    );
    const evidence = (data || [])
      .filter((m: any) => !m.deleted_at && citedIds.has(m.id))
      .map((m: any) => ({
        id: m.id,
        text: m.text,
        sender_name: m.sender_name,
        sender_role: m.sender_role,
        sent_at: m.sent_at,
      }));

    out.push({
      client_id: c.id,
      client_name: c.name,
      rule_version: current?.rule_version ?? RULE_VERSION,
      ...scored,
      evidence: profile?.role === "founder" ? [] : evidence,
    });
  }

  // Sort by urgency first (At risk -> Watch -> Healthy), then ascending score
  out.sort((a, b) => {
    const urgencyDiff = (rank[b.label] ?? 0) - (rank[a.label] ?? 0);
    if (urgencyDiff !== 0) return urgencyDiff;
    return a.score - b.score;
  });

  const { data: alerts } = await sb
    .from("health_alerts")
    .select("id,client_id,from_label,to_label,week_start,rule_version,created_at")
    .order("created_at", { ascending: false })
    .limit(20);

  return NextResponse.json({
    clients: out,
    alerts: alerts || [],
    weekStart,
    ruleVersion: RULE_VERSION,
  });
}

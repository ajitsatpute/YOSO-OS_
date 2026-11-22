import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") || "").trim();
  if (q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const safeFts = q.replace(/[,%()'"\\]/g, " ").trim();
  const selectCols =
    "id,text,sender_name,channel_id,type,voice_path,duration_seconds,channels(name),message_reactions(emoji,user_id),sent_at";

  const { data: ftsData, error: ftsError } = await sb
    .from("chat_messages")
    .select(selectCols)
    .textSearch("search_vector", safeFts, { type: "websearch", config: "simple" })
    .order("sent_at", { ascending: false })
    .limit(100);

  if (ftsError) {
    return NextResponse.json({ error: ftsError.message }, { status: 500 });
  }

  let rows = ftsData || [];

  // Fallback for prefix/partial matches when FTS returns fewer than 20 rows
  if (rows.length < 20) {
    const escapedLike = q.replace(/[\%_,()]/g, (ch) => `\\${ch}`);
    const { data: likeData } = await sb
      .from("chat_messages")
      .select(selectCols)
      .or(`text.ilike.%${escapedLike}%,sender_name.ilike.%${escapedLike}%`)
      .order("sent_at", { ascending: false })
      .limit(50);

    if (likeData?.length) {
      const seen = new Set(rows.map((r: any) => r.id));
      for (const item of likeData) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          rows.push(item);
        }
      }
    }
  }

  const needle = q.toLowerCase();
  const ranked = rows
    .map((m: any) => {
      const textLower = (m.text || "").toLowerCase();
      const senderLower = (m.sender_name || "").toLowerCase();
      const reactionCounts = Object.fromEntries(
        (m.message_reactions || []).reduce((acc: Map<string, number>, r: any) => {
          acc.set(r.emoji, (acc.get(r.emoji) || 0) + 1);
          return acc;
        }, new Map<string, number>())
      );
      const rank =
        (textLower === needle ? 5 : 0) +
        (textLower.includes(needle) ? 3 : 0) +
        (senderLower.includes(needle) ? 2 : 0);

      return {
        ...m,
        channel_name: m.channels?.name || "Channel",
        reaction_counts: reactionCounts,
        rank,
      };
    })
    .sort((a: any, b: any) => {
      if (b.rank !== a.rank) return b.rank - a.rank;
      return new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime();
    });

  return NextResponse.json({ results: ranked.slice(0, 50) });
}

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const fields =
  "id,text,sender_name,sender_id,type,voice_path,duration_seconds,sent_at,message_reactions(emoji,user_id)";

export async function GET(req: NextRequest) {
  const channelId = req.nextUrl.searchParams.get("channelId");
  const messageId = req.nextUrl.searchParams.get("messageId");
  if (!channelId) {
    return NextResponse.json({ error: "channelId is required" }, { status: 400 });
  }

  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (messageId) {
    const { data: target, error: targetError } = await sb
      .from("chat_messages")
      .select(fields)
      .eq("id", messageId)
      .eq("channel_id", channelId)
      .single();

    if (targetError || !target) {
      return NextResponse.json(
        { error: "Message not found or access denied" },
        { status: 404 }
      );
    }

    const before = await sb
      .from("chat_messages")
      .select(fields)
      .eq("channel_id", channelId)
      .lt("sent_at", target.sent_at)
      .order("sent_at", { ascending: false })
      .limit(50);

    const after = await sb
      .from("chat_messages")
      .select(fields)
      .eq("channel_id", channelId)
      .gt("sent_at", target.sent_at)
      .order("sent_at", { ascending: true })
      .limit(49);

    if (before.error || after.error) {
      return NextResponse.json(
        { error: "Could not load thread context" },
        { status: 403 }
      );
    }

    return NextResponse.json({
      messages: [...(before.data || []).reverse(), target, ...(after.data || [])],
      focusMessageId: messageId,
    });
  }

  const { data, error } = await sb
    .from("chat_messages")
    .select(fields)
    .eq("channel_id", channelId)
    .order("sent_at", { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }

  return NextResponse.json({ messages: (data || []).reverse() });
}

export async function POST(req: NextRequest) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { channelId, text } = await req.json();
  if (
    typeof channelId !== "string" ||
    !channelId ||
    typeof text !== "string" ||
    !text.trim() ||
    text.length > 5000
  ) {
    return NextResponse.json({ error: "Invalid message" }, { status: 400 });
  }

  const [{ data: profile }, { data: channel }] = await Promise.all([
    sb.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
    sb.from("channels").select("id, client_id").eq("id", channelId).maybeSingle(),
  ]);

  if (!channel) {
    return NextResponse.json(
      { error: "Channel not found or access denied" },
      { status: 403 }
    );
  }

  const { data, error } = await sb
    .from("chat_messages")
    .insert({
      channel_id: channelId,
      client_id: channel.client_id ?? null,
      sender_id: user.id,
      sender_name: profile?.full_name || "Team Member",
      sender_role: "yoso",
      type: "text",
      text: text.trim(),
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }

  return NextResponse.json({ message: data });
}

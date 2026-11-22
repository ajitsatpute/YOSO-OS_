"use client";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/browser";

type PendingVoice = {
  blob: Blob;
  duration: number;
  channelId: string;
  key: string;
  ext: string;
};

type Channel = {
  id: string;
  name: string;
  client_id: string | null;
};

function highlightedSnippet(text: string, query: string) {
  const lower = text.toLowerCase();
  const needle = query.trim().toLowerCase();
  const idx = needle ? lower.indexOf(needle) : -1;
  const start = idx < 0 ? 0 : Math.max(0, idx - 55);
  const snippet = text.slice(start, start + 180);
  if (idx < 0) {
    return (
      <>
        {start > 0 ? "…" : ""}
        {snippet}
        {text.length > start + 180 ? "…" : ""}
      </>
    );
  }
  const local = idx - start;
  return (
    <>
      {start > 0 ? "…" : ""}
      {snippet.slice(0, local)}
      <mark>{snippet.slice(local, local + needle.length)}</mark>
      {snippet.slice(local + needle.length)}
      {text.length > start + 180 ? "…" : ""}
    </>
  );
}

function pickSupportedMime(): { mimeType: string; ext: string } {
  if (typeof MediaRecorder === "undefined") return { mimeType: "", ext: "webm" };
  const candidates = [
    { mimeType: "audio/webm;codecs=opus", ext: "webm" },
    { mimeType: "audio/webm", ext: "webm" },
    { mimeType: "audio/mp4", ext: "m4a" },
    { mimeType: "audio/ogg;codecs=opus", ext: "ogg" },
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c.mimeType)) return c;
  }
  return { mimeType: "", ext: "webm" };
}

export default function ChatPanel() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null);
  const [focusMessageId, setFocusMessageId] = useState<string | null>(null);
  const [thread, setThread] = useState<any[]>([]);
  const [draft, setDraft] = useState("");

  const [q, setQ] = useState("");
  const [rows, setRows] = useState<any[]>([]);
  const [recording, setRecording] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [status, setStatus] = useState("");
  const [playing, setPlaying] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<PendingVoice | null>(null);
  const timerRef = useRef<number | null>(null);

  async function loadChannels() {
    const r = await fetch("/api/chat/channels");
    if (!r.ok) return;
    const j = await r.json();
    const list: Channel[] = j.channels || [];
    setChannels(list);
    if (list.length && !activeChannel) {
      void openChannel(list[0]);
    }
  }

  async function openChannel(ch: Channel, messageId?: string) {
    setActiveChannel(ch);
    setFocusMessageId(messageId || null);
    const qs = messageId
      ? `channelId=${encodeURIComponent(ch.id)}&messageId=${encodeURIComponent(messageId)}`
      : `channelId=${encodeURIComponent(ch.id)}`;
    const r = await fetch(`/api/chat/messages?${qs}`);
    const j = await r.json();
    if (!r.ok) {
      setStatus(j.error || "Could not load channel messages.");
      setThread([]);
      return;
    }
    setThread(j.messages || []);
  }

  async function search() {
    if (q.trim().length < 2) {
      setRows([]);
      return;
    }
    const r = await fetch(`/api/chat/search?q=${encodeURIComponent(q)}`);
    const j = await r.json();
    setRows(j.results || []);
    if (j.error) setStatus(j.error);
  }

  async function sendMessage() {
    if (!activeChannel || !draft.trim()) return;
    const r = await fetch("/api/chat/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channelId: activeChannel.id, text: draft }),
    });
    const j = await r.json();
    if (!r.ok) {
      setStatus(j.error || "Message failed");
      return;
    }
    setDraft("");
    await openChannel(activeChannel);
  }

  useEffect(() => {
    void loadChannels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const sb = createClient();
    const ch = sb
      .channel("chat-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_messages" },
        () => {
          if (q.trim().length >= 2) void search();
          if (activeChannel) void openChannel(activeChannel, focusMessageId || undefined);
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "message_reactions" },
        () => {
          if (q.trim().length >= 2) void search();
          if (activeChannel) void openChannel(activeChannel, focusMessageId || undefined);
        }
      )
      .subscribe();

    return () => {
      void sb.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, activeChannel, focusMessageId]);

  async function react(id: string, emoji: string) {
    const r = await fetch("/api/chat/reactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId: id, emoji }),
    });
    if (!r.ok) {
      setStatus("Could not react: check channel access.");
      return;
    }
    const j = await r.json();
    setStatus(`Reaction ${emoji} ${j.action}.`);
    if (activeChannel) await openChannel(activeChannel, focusMessageId || undefined);
    if (q.trim().length >= 2) await search();
  }

  async function play(id: string) {
    const r = await fetch(`/api/chat/voice/${id}`);
    const j = await r.json();
    if (!r.ok) {
      setStatus(j.error || "Could not access voice note");
      return;
    }
    setPlaying((old) => ({ ...old, [id]: j.url }));
  }

  async function uploadVoice(item: PendingVoice | null = pending) {
    if (!item) return;
    try {
      const form = new FormData();
      form.append("file", item.blob, `voice-note.${item.ext}`);
      form.append("channelId", item.channelId);
      form.append("duration", String(item.duration));
      form.append("idempotencyKey", item.key);
      const response = await fetch("/api/chat/voice", {
        method: "POST",
        body: form,
      });
      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        setStatus(
          errJson.error ||
            "Upload failed. Retry is safe; the same idempotency key will be reused."
        );
        return;
      }
      setStatus("Voice note uploaded.");
      setPending(null);
      if (activeChannel) await openChannel(activeChannel);
    } catch {
      setStatus(
        "Connection lost during upload. Retry will reuse the same idempotency key."
      );
    }
  }

  async function record(channelId: string) {
    if (recording) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("Audio recording is unavailable in this browser context (requires HTTPS).");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const { mimeType, ext } = pickSupportedMime();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      const started = Date.now();
      setElapsedSec(0);

      timerRef.current = window.setInterval(() => {
        setElapsedSec(Math.min(120, Math.floor((Date.now() - started) / 1000)));
      }, 500);

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = async () => {
        if (timerRef.current) {
          window.clearInterval(timerRef.current);
          timerRef.current = null;
        }
        stream.getTracks().forEach((t) => t.stop());
        const duration = Math.max(1, Math.round((Date.now() - started) / 1000));
        setRecording(false);
        setElapsedSec(0);

        if (duration > 120) {
          setStatus("Voice note exceeded two minutes and was discarded.");
          return;
        }

        const item: PendingVoice = {
          blob: new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" }),
          channelId,
          duration,
          key: crypto.randomUUID(),
          ext,
        };
        setPending(item);
        await uploadVoice(item);
      };

      recorder.start();
      setRecording(true);
      setStatus("Recording… automatically stops at 2:00.");
      (window as any).__yosoRecorder = recorder;

      window.setTimeout(() => {
        if (recorder.state !== "inactive") recorder.stop();
      }, 120000);
    } catch {
      setStatus("Microphone permission was denied or unavailable.");
    }
  }

  function stop() {
    const r = (window as any).__yosoRecorder as MediaRecorder | undefined;
    if (r && r.state !== "inactive") r.stop();
    setRecording(false);
  }

  return (
    <section className="card">
      <h2>Messages</h2>

      {/* Search bar across accessible channels */}
      <div className="row">
        <input
          className="field"
          style={{ flex: 1 }}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="Search message text or sender across your channels"
        />
        <button className="btn primary" onClick={search}>
          Search
        </button>
      </div>

      {status && <p className="muted">{status}</p>}

      {/* Search Results */}
      {rows.length > 0 && (
        <div className="section">
          <div className="row">
            <strong>Search results ({rows.length})</strong>
            <button
              className="btn"
              onClick={() => {
                setRows([]);
                setQ("");
              }}
            >
              Clear search
            </button>
          </div>
          <div className="chat section">
            {rows.map((m) => (
              <article className="bubble" key={m.id}>
                <small>
                  {m.sender_name} · {m.channel_name} ·{" "}
                  {new Date(m.sent_at).toLocaleString()}
                </small>
                <div>{highlightedSnippet(m.text, q)}</div>
                <div className="actions">
                  <button
                    className="btn"
                    onClick={() =>
                      openChannel(
                        { id: m.channel_id, name: m.channel_name, client_id: null },
                        m.id
                      )
                    }
                  >
                    Open in thread
                  </button>
                  {Object.entries(m.reaction_counts || {}).map(([emoji, count]) => (
                    <span className="pill" key={emoji}>
                      {emoji} {count as number}
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      {/* Channel selector */}
      <div className="actions section">
        {channels.map((ch) => (
          <button
            key={ch.id}
            className={`btn ${activeChannel?.id === ch.id ? "active" : ""}`}
            style={
              activeChannel?.id === ch.id
                ? { background: "#233b68", color: "#fff", borderColor: "#233b68" }
                : undefined
            }
            onClick={() => openChannel(ch)}
          >
            {ch.name}
          </button>
        ))}
      </div>

      {/* Active Channel Thread */}
      {activeChannel ? (
        <section className="section card">
          <div className="row">
            <h3>{activeChannel.name}</h3>
            <div className="actions" style={{ marginTop: 0 }}>
              {!recording ? (
                <button className="btn" onClick={() => record(activeChannel.id)}>
                  Record voice note (max 2m)
                </button>
              ) : (
                <button className="btn primary" onClick={stop}>
                  Stop recording ({elapsedSec}s / 120s)
                </button>
              )}
              {pending && (
                <button className="btn" onClick={() => uploadVoice()}>
                  Retry voice upload
                </button>
              )}
            </div>
          </div>

          <div className="chat section">
            {thread.length === 0 ? (
              <p className="muted">No messages in this channel yet.</p>
            ) : (
              thread.map((m) => (
                <div
                  className="bubble"
                  key={m.id}
                  style={
                    m.id === focusMessageId ? { border: "2px solid #5477b8" } : {}
                  }
                >
                  <small>
                    {m.sender_name} · {new Date(m.sent_at).toLocaleString()}
                  </small>
                  <div>{m.text}</div>

                  {m.type === "voice" && (
                    <div className="section">
                      <button className="btn" onClick={() => play(m.id)}>
                        Play voice note ({m.duration_seconds || "?"}s)
                      </button>
                      {playing[m.id] && (
                        <audio
                          controls
                          autoPlay
                          src={playing[m.id]}
                          style={{ display: "block", marginTop: 8, width: "100%" }}
                        />
                      )}
                    </div>
                  )}

                  <div className="actions">
                    {["👍", "❤️", "😂"].map((e) => (
                      <button className="btn" key={e} onClick={() => react(m.id, e)}>
                        {e}
                      </button>
                    ))}
                    {Object.entries(
                      (m.message_reactions || []).reduce(
                        (acc: Record<string, number>, r: any) => {
                          acc[r.emoji] = (acc[r.emoji] || 0) + 1;
                          return acc;
                        },
                        {}
                      )
                    ).map(([emoji, count]) => (
                      <span className="pill" key={emoji}>
                        {emoji} {count as number}
                      </span>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="row section">
            <input
              className="field"
              style={{ flex: 1 }}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={`Message ${activeChannel.name}…`}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            />
            <button className="btn primary" onClick={sendMessage}>
              Send
            </button>
          </div>
        </section>
      ) : (
        <p className="muted section">
          No channels visible for your account. Add your user to{" "}
          <code>channel_members</code> or assign a client in Supabase.
        </p>
      )}

      <p className="muted section">
        Search and playback are enforced by database channel/client access policies.
      </p>
    </section>
  );
}

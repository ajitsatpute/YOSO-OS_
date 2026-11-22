import type {SupabaseClient} from "@supabase/supabase-js";
import type {ChatAdapter} from "./chat-adapter";
import type {ChatMessage} from "./health";
import {createHash} from "node:crypto";
function stableUuid(value:string){const h=createHash("sha256").update(value).digest("hex").slice(0,32);return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`}
export function mapImportedMessages(rows:ChatMessage[],clientId:string,channelId:string){return rows.map(m=>({id:stableUuid(`${clientId}:${m.id}`),channel_id:channelId,client_id:clientId,sender_name:m.senderName,sender_role:m.senderRole,type:m.type,text:m.text,sent_at:m.sentAt,edited_at:m.editedAt||null,deleted_at:m.deletedAt||null}))}
/** Idempotent import: provider message ID is the stable identity; edits overwrite the same row and deletions become tombstones. */
export async function importChatWindow(db:SupabaseClient,adapter:ChatAdapter,clientId:string,channelId:string,from:Date,to:Date){const rows=await adapter.fetchMessages(clientId,from,to);const payload=mapImportedMessages(rows,clientId,channelId);if(!payload.length)return{read:0,upserted:0};const {error}=await db.from("chat_messages").upsert(payload,{onConflict:"id"});if(error)throw error;return{read:rows.length,upserted:payload.length}}

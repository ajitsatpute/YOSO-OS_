import type {ChatMessage} from "./health";
/** Single boundary for external chat imports. Replace this adapter when a real provider is approved. */
export interface ChatAdapter{fetchMessages(clientId:string,from:Date,to:Date):Promise<ChatMessage[]>}
export class DemoChatAdapter implements ChatAdapter{constructor(private readonly rows:ChatMessage[]){}async fetchMessages(clientId:string,from:Date,to:Date){return this.rows.filter(m=>m.clientId===clientId&&new Date(m.sentAt)>=from&&new Date(m.sentAt)<=to)}}

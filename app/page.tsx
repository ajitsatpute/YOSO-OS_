import {createClient} from "@/lib/supabase/server";
import Dashboard from "./components/dashboard";
export default async function Home(){let user=null,profile=null;try{const sb=await createClient();const {data}=await sb.auth.getUser();user=data.user;if(user){const p=await sb.from("profiles").select("full_name,role,pod_id").eq("id",user.id).single();profile=p.data}}catch{}return <Dashboard signedIn={!!user} userName={profile?.full_name||user?.email||"Sign in to your workspace"} role={profile?.role||"guest"}/>}

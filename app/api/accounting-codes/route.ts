import { NextRequest,NextResponse } from "next/server";
import { requireIdentity } from "@/lib/auth";
import { codesForAllSites,codesForSite } from "@/lib/accounting";

export const runtime="nodejs";

// Fixed-window limiter keyed on identity. The workbook is parsed once and cached, so this exists to stop a
// runaway client loop (a broken auto-save, a stuck retry) from pinning the process, not to price the read.
const WINDOW_MS=60_000, MAX_PER_WINDOW=60;
const hits=new Map<string,{count:number;resetAt:number}>();
function overLimit(key:string){
  const now=Date.now(); const entry=hits.get(key);
  if(!entry||now>=entry.resetAt){hits.set(key,{count:1,resetAt:now+WINDOW_MS});return null}
  entry.count+=1;
  if(hits.size>5000) for(const [k,v] of hits) if(now>=v.resetAt) hits.delete(k);
  return entry.count>MAX_PER_WINDOW?Math.ceil((entry.resetAt-now)/1000):null;
}

export async function GET(request:NextRequest){
  try{
    const identity=await requireIdentity();
    const retryAfter=overLimit(identity.email.toLowerCase());
    if(retryAfter) return NextResponse.json({error:"Too many requests"},{status:429,headers:{"Retry-After":String(retryAfter)}});
    // Site coding is master data, not a permission boundary: unless the caller asks for one specific site,
    // return every active site so the PRF dropdown is never scoped to the requester's own department.
    const requestedSite=(request.nextUrl.searchParams.get("site")||"").slice(0,200);
    const allSites=request.nextUrl.searchParams.get("scope")==="all"||!requestedSite;
    if(!allSites&&process.env.NODE_ENV!=="development"&&requestedSite.toLowerCase()!==identity.school.toLowerCase()) return NextResponse.json({error:"Site access denied"},{status:403});
    const options=allSites?await codesForAllSites():await codesForSite(requestedSite);
    return NextResponse.json({site:requestedSite||identity.school,scope:allSites?"all":"site",options},{headers:{"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"same-origin"}});
  }catch(error){
    const unauthorized=error instanceof Error&&error.message==="UNAUTHORIZED";
    if(!unauthorized) console.error("accounting-codes failed:",error);   // detail stays server-side
    return NextResponse.json({error:unauthorized?"Authentication required":"Unable to load accounting codes"},{status:unauthorized?401:500});
  }
}

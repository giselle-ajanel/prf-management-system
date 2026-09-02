import "server-only";
import { headers } from "next/headers";

export type ServerIdentity = { email:string; name:string; school:string; district:string };

// Identity arrives from the SSO reverse proxy as a request header. A header is only trustworthy if the proxy
// both sets it and strips any client-supplied copy, so this module refuses to accept one that is malformed,
// and — when PRF_PROXY_SHARED_SECRET is configured — refuses any request that cannot prove it came from the
// proxy. Without that secret a misrouted deployment would let a caller assert any identity it likes.
const EMAIL=/^[^\s@<>"';,]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const HEADER_SAFE=/^[\x20-\x7E]{1,320}$/;                    // printable ASCII only: blocks CR/LF and smuggling
const clean=(value:string|null)=>{const text=(value||"").trim();return HEADER_SAFE.test(text)?text:""};

// The same validation as requireIdentity, minus the development fallback: returns an identity only when
// the proxy actually asserted one. Session auth uses this, because a fallback identity in development
// would sign every visitor in as Giselle and there would be no login screen left to test.
export async function optionalIdentity():Promise<ServerIdentity|null>{
  const headerName=process.env.PRF_IDENTITY_HEADER||"x-authenticated-user-email";
  const incoming=await headers();
  const email=clean(incoming.get(headerName));
  if(!email) return null;
  const secret=process.env.PRF_PROXY_SHARED_SECRET||"";
  if(secret&&clean(incoming.get("x-prf-proxy-secret"))!==secret) return null;
  const domains=(process.env.PRF_ALLOWED_EMAIL_DOMAINS||"").split(",").map(x=>x.trim().toLowerCase()).filter(Boolean);
  if(!EMAIL.test(email)) return null;
  if(domains.length&&!domains.some(domain=>email.toLowerCase().endsWith(`@${domain}`))) return null;
  return {email,name:clean(incoming.get("x-authenticated-user-name"))||email.split("@")[0],school:clean(incoming.get("x-authenticated-user-school")),district:clean(incoming.get("x-authenticated-user-district"))};
}

export async function requireIdentity():Promise<ServerIdentity>{
  const headerName=process.env.PRF_IDENTITY_HEADER||"x-authenticated-user-email";
  const incoming=await headers();
  const email=clean(incoming.get(headerName));
  if(process.env.NODE_ENV==="development"&&!email){
    return {email:"giselle.ajanel@woodcraftrangers.org",name:"Giselle Ajanel",school:"Finance",district:"Woodcraft"};
  }
  const secret=process.env.PRF_PROXY_SHARED_SECRET||"";
  if(secret&&clean(incoming.get("x-prf-proxy-secret"))!==secret) throw new Error("UNAUTHORIZED");
  const domains=(process.env.PRF_ALLOWED_EMAIL_DOMAINS||"").split(",").map(x=>x.trim().toLowerCase()).filter(Boolean);
  if(!email||!EMAIL.test(email)||!domains.some(domain=>email.toLowerCase().endsWith(`@${domain}`))) throw new Error("UNAUTHORIZED");
  return {email,name:clean(incoming.get("x-authenticated-user-name"))||email.split("@")[0],school:clean(incoming.get("x-authenticated-user-school")),district:clean(incoming.get("x-authenticated-user-district"))};
}

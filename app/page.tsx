"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActionRow, AppFooter, AppHeader, Finance, Hero, LoginScreen, MonthFilter, NotificationBell, PageHead,
  QueueItem, RequestForm, RequestModal, RequestTrail, ReviewPanel, SessionDialog, Summary, SupervisorReview,
  TipPanel, SCHOOL_TAB,
  amountOf, markAllRead, money, monthLabel, notify, siteKeyOf, vague,
  type AccountingCode, type Credentials, type PrfFormState, type PrfLineDraft, type PrfNotification,
  type Request, type View,
} from "@ds";
import {
  SessionEndedError, createRequest, decideRequest as decidePrf, deleteRequest as deletePrf, fetchRequests,
  getSession, login, logout, submitRequest as submitPrf, toViewRequest, updateRequest,
  type SessionInfo,
} from "@/lib/prf-client";

// The Hub's single page. State, persistence and permissions all funnel through here; every piece of markup
// comes from the design system.
//
// What this file no longer does is decide anything. Which PRFs exist, who may see them, whether a draft can
// still be edited, whether a signature is acceptable — all of that is answered by the API and enforced in
// lib/store.ts. The role below hides navigation a person cannot use, which is a courtesy to them rather
// than a security boundary: hiding the Approvals tab from a requester and refusing their approval request
// are two different mechanisms, and only the second one matters.

const blankLine=():PrfLineDraft=>({description:"",expenseType:"Program Supplies",club:"",splitSite:"",amount:""});
const freshForm=(requestorName=""):PrfFormState=>({vendor:"",vendorAddress:"",vendorCity:"",vendorEmail:"",description:"",amount:"",district:"Woodcraft",school:"",siteKey:"",siteName:"",siteCode:"",fundingCode:"",region:"",expenseType:"Program Supplies",paymentType:"",lineItems:Array.from({length:10},blankLine),requestorName,requestorSignature:"",signatureMode:"type",requestorDate:new Date().toISOString().slice(0,10),supervisorName:"",supervisorSignature:"",supervisorDate:"",manualSite:"",manualFunding:"",justification:"",customSite:false,customFunding:false});

const districts: Record<string,string[]> = {
  "Woodcraft":["Finance","Marketing","Development","Operations"],
  "District 1":["Roosevelt Elementary","Lincoln Middle School"],
  "District 4":["Central High School","Jefferson Academy"],
  "District 7":["Harbor STEM Academy","Westview Elementary"],
};

// localStorage throws QuotaExceededError (~5 MB; drawn signatures are base64 PNGs) and is unavailable in
// private mode. An unguarded setItem inside an effect takes the whole app down, so all access is wrapped.
let storageWarned=false;
const safeStorage={
  get(key:string):string|null{try{return window.localStorage.getItem(key)}catch{return null}},
  set(key:string,value:string):boolean{try{window.localStorage.setItem(key,value);return true}catch{if(!storageWarned){storageWarned=true;console.warn(`Browser storage is full or unavailable; "${key}" was not saved.`)}return false}},
  remove(key:string):void{try{window.localStorage.removeItem(key)}catch{}},
};
const downloadPrfPdf=(request:Request)=>{const stored=safeStorage.get(`prf-editor-${request.id}`);let editor:any={};if(stored)try{editor=JSON.parse(stored)}catch{}const clean=(value:unknown)=>String(value??"").normalize("NFKD").replace(/[^\x20-\x7E]/g,"").replace(/\\/g,"\\\\").replace(/\(/g,"\\(").replace(/\)/g,"\\)");const payment:{[key:string]:string}={divvy:"Divvy Card",systems:"Systems Dept",direct:"Direct Vendor (Check Request or ePay)"};const lines=["WOODCRAFT RANGERS - PURCHASE REQUEST FORM",`PRF: ${request.id}`,`Status: ${request.status}`,`Site / Department: ${request.siteCode} - ${request.school}`,`Funding Source: ${request.fundingCode}`,`Payment Type: ${payment[editor.paymentType]||""}`,"",`Vendor / Payee / Cardholder: ${editor.vendor||request.vendor}`,`Address: ${editor.vendorAddress||""}`,`City, State, Zip: ${editor.vendorCity||""}`,`Email: ${editor.vendorEmail||""}`,"","LINE ITEMS"] as string[];const savedLines=(editor.lineItems||[]).filter((line:any)=>line.description||line.amount);(savedLines.length?savedLines:request.lineItems.map(line=>({description:line.description,quantity:line.quantity,expenseType:"",club:"",splitSite:"",amount:line.quantity*line.unitPrice}))).forEach((line:any,index:number)=>lines.push(`${index+1}. ${line.description} | ${line.expenseType||""} | Club ${line.club||""} | Site ${line.splitSite||""} | $${Number(line.amount||0).toFixed(2)}`));lines.push("",`GRAND TOTAL: ${money(request.amount)}`,"",`Requestor: ${editor.requestorName||request.requester}`,`Requestor Signature: ${request.requesterSigned?"Electronically signed":"Not signed"}`,`Requestor Date: ${editor.requestorDate||""}`,`Supervisor / Finance: ${request.approverSigned?"Electronically signed":"Pending"}`,`Approval Date: ${editor.supervisorDate||request.approvedAt||""}`);const content=lines.slice(0,46).map((line,index)=>`BT /F1 ${index===0?16:9} Tf 40 ${752-index*15} Td (${clean(line)}) Tj ET`).join("\n");const objects=["1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n","2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n","3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >> endobj\n",`4 0 obj << /Length ${content.length} >> stream\n${content}\nendstream endobj\n`,"5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n"];let pdf="%PDF-1.4\n",offsets=[0];for(const object of objects){offsets.push(pdf.length);pdf+=object}const xref=pdf.length;pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(offset=>String(offset).padStart(10,"0")+" 00000 n \n").join("")}trailer << /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;const url=URL.createObjectURL(new Blob([pdf],{type:"application/pdf"})),anchor=document.createElement("a");anchor.href=url;anchor.download=`${request.id}-Purchase-Request.pdf`;anchor.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000)};
const downloadFormattedPrfPdf=(request:Request)=>{let editor:any={};const stored=safeStorage.get(`prf-editor-${request.id}`);if(stored)try{editor=JSON.parse(stored)}catch{}const esc=(value:unknown)=>String(value??"").normalize("NFKD").replace(/[^\x20-\x7E]/g,"").replace(/\\/g,"\\\\").replace(/\(/g,"\\(").replace(/\)/g,"\\)");const commands:string[]=[];const text=(x:number,y:number,value:unknown,size=8,bold=false)=>commands.push(`BT /${bold?"F2":"F1"} ${size} Tf ${x} ${y} Td (${esc(value)}) Tj ET`);const box=(x:number,y:number,w:number,h:number,fill="0.91 0.91 0.98")=>commands.push(`q ${fill} rg ${x} ${y} ${w} ${h} re f Q 0 G ${x} ${y} ${w} ${h} re S`);const line=(x1:number,y1:number,x2:number,y2:number)=>commands.push(`${x1} ${y1} m ${x2} ${y2} l S`);const fit=(value:unknown,max:number)=>{const string=String(value??"");return string.length>max?string.slice(0,max-1)+"...":string};text(42,748,"WOODCRAFT",20,true);text(42,728,"RANGERS",20,true);text(185,733,"PURCHASE REQUEST FORM",12,true);text(42,704,`PRF: ${request.id}`,8,true);box(315,686,255,70,"0.82 0.87 0.86");text(325,741,"REQUIREMENTS:",9,true);text(325,727,"All PRFs require 2 signatures",7);text(325,715,"Up to $5,000: Manager | $5,001-$15,000: Director",6.5);text(325,704,"$15,001-$25,000: Senior Director | $25,001-$75,000: Chief",6.5);text(325,693,"$75,001-$250,000: CFO + CEO | Over $250,000: CEO",6.5);text(42,674,"SITE:",9,true);box(105,662,175,22);text(111,670,fit(`${editor.siteName||request.school} (${request.siteCode})`,34),8);text(42,641,"FUNDING SOURCE:",9,true);box(150,629,130,22);text(156,637,fit(request.fundingCode,24),8);text(42,604,"PAYMENT TYPE (SELECT ONE):",9,true);const payments=[['divvy','Divvy Card'],['systems','Systems Dept'],['direct','Direct Vendor (Check Request or ePay)']];payments.forEach(([value,label],index)=>{const y=584-index*20;box(45,y,11,11,"1 1 1");if(editor.paymentType===value)text(47,y+2,"X",9,true);text(64,y+2,label,8)});text(315,604,"Vendor*/Payee/Cardholder:",11,true);line(315,601,502,601);const vendorRows=[["Name:",editor.vendor||request.vendor],["Address:",editor.vendorAddress],["City, State, Zip:",editor.vendorCity],["Email:",editor.vendorEmail]];vendorRows.forEach(([label,value],index)=>{const y=578-index*28;text(315,y+7,label,9,true);box(405,y,165,21);text(411,y+7,fit(value,31),8)});const tableX=30,tableTop=460,widths=[260,95,62,57,78],headers=["Item Description and Quantity","Expense Type","Club","Site/Dept #","Amount"];let x=tableX;headers.forEach((header,index)=>{box(x,tableTop,widths[index],30,"0.80 0.80 0.80");text(x+4,tableTop+17,header,index===0?8:7,true);x+=widths[index]});const saved=(editor.lineItems||[]).filter((entry:any)=>entry.description||entry.amount),fallback=request.lineItems.map(entry=>({description:entry.description,quantity:entry.quantity,expenseType:"",club:"",splitSite:"",amount:entry.quantity*entry.unitPrice})),items=saved.length?saved:fallback;for(let row=0;row<10;row++){const y=tableTop-22*(row+1);x=tableX;const item=items[row]||{};const values=[item.description||"",item.expenseType||"",item.club||"",item.splitSite||"",item.amount?`$${Number(item.amount).toFixed(2)}`:""];values.forEach((value,index)=>{box(x,y,widths[index],22);text(x+3,y+8,fit(value,[48,16,10,9,12][index]),index===0?6.5:7);x+=widths[index]})}const totalY=tableTop-22*10-32;box(tableX,totalY,474,26,"0.80 0.80 0.80");box(tableX+474,totalY,78,26);text(tableX+390,totalY+9,"GRAND TOTAL:",10,true);text(tableX+482,totalY+9,money(request.amount),9,true);const sigY=95;text(42,sigY+54,"Requestor Print Name",8,true);box(42,sigY+28,190,22);text(48,sigY+36,editor.requestorName||request.requester,9);text(42,sigY+15,"Digital Signature",8,true);line(120,sigY+13,232,sigY+13);text(124,sigY+16,request.requesterSigned?"Electronically signed":"Not signed",8);text(245,sigY+54,"Date",8,true);box(245,sigY+28,75,22);text(251,sigY+36,editor.requestorDate||"",8);text(350,sigY+54,"Supervisor Approval",8,true);box(350,sigY+28,160,22);text(356,sigY+36,request.approverSigned?"Finance / Approver":"Pending",8);text(350,sigY+15,"Signature",8,true);line(402,sigY+13,510,sigY+13);text(406,sigY+16,request.approverSigned?"Electronically signed":"Pending",8);text(520,sigY+54,"Date",8,true);text(520,sigY+36,request.approvedAt?request.approvedAt.slice(0,10):"",7);text(42,34,`Status: ${request.status}`,7,true);const content=commands.join("\n"),objects=["1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n","2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n","3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >> endobj\n",`4 0 obj << /Length ${content.length} >> stream\n${content}\nendstream endobj\n`,"5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n","6 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> endobj\n"];let pdf="%PDF-1.4\n";const offsets=[0];objects.forEach(object=>{offsets.push(pdf.length);pdf+=object});const xref=pdf.length;pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(offset=>`${String(offset).padStart(10,"0")} 00000 n \n`).join("")}trailer << /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;const url=URL.createObjectURL(new Blob([pdf],{type:"application/pdf"})),anchor=document.createElement("a");anchor.href=url;anchor.download=`${request.id}-Purchase-Request-Form.pdf`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
const draftDb=()=>new Promise<IDBDatabase>((resolve,reject)=>{if(typeof indexedDB==="undefined")return reject(new Error("IndexedDB unavailable"));const request=indexedDB.open("purchase-request-hub",1);request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains("drafts"))request.result.createObjectStore("drafts",{keyPath:"id"})};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
// Drafts always persist to localStorage; IndexedDB is a best-effort mirror and is blocked outright on
// file:// pages and in private browsing, so neither helper is allowed to reject.
const saveIndexedDraft=async(payload:unknown,owner:string)=>{try{const db=await draftDb();const tx=db.transaction("drafts","readwrite");tx.objectStore("drafts").put({id:"active-prf",owner,payload,updatedAt:new Date().toISOString()});await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)})}catch{}};
const deleteIndexedDraft=async()=>{try{const db=await draftDb();const tx=db.transaction("drafts","readwrite");tx.objectStore("drafts").delete("active-prf");await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)})}catch{}};

const PORTAL_LABEL = { REQUESTER: "Requester", APPROVER: "Approver / Finance" } as const;

const initialsOf = (name: string) =>
  name.split(" ").filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase() || "").join("") || "PRF";

/** True once a draft holds anything worth writing to the server. */
const hasContent = (form: PrfFormState) =>
  Boolean(form.vendor || form.description || form.lineItems.some(line => line.description || line.amount));

/**
 * The subset of the editor a draft write sends.
 *
 * Named explicitly rather than spreading the form: the editor carries signature images, dates and UI state
 * that have no business being posted, and the server would reject them anyway.
 */
const draftPayload = (form: PrfFormState) => ({
  vendor: form.vendor,
  description: form.description,
  district: form.district,
  school: form.siteName || form.school,
  siteCode: form.siteCode,
  fundingCode: form.fundingCode,
  paymentType: form.paymentType,
  expenseType: form.expenseType,
  customSite: form.customSite,
  customFunding: form.customFunding,
  lineItems: form.lineItems
    .filter(line => line.description || line.amount)
    .map(line => ({ description: line.description || "Line item", quantity: 1, unitPrice: amountOf(line.amount) })),
});

export default function PurchaseRequestHub() {
  const [session,setSession] = useState<SessionInfo|null>(null);
  const [authBusy,setAuthBusy] = useState(false); const [authError,setAuthError] = useState(""); const [authNotice,setAuthNotice] = useState("");
  const user = session?.user; const isApprover = user?.role === "APPROVER";

  const [view,setView] = useState<View>("overview"); const [requests,setRequests] = useState<Request[]>([]);
  const [selected,setSelected] = useState<Request|null>(null); const [creating,setCreating] = useState(false); const [auditOpen,setAuditOpen] = useState(false);
  const [notice,setNotice] = useState("");
  const [editingId,setEditingId] = useState<string|null>(null); const [accounting,setAccounting] = useState<AccountingCode[]>([]); const [accountingStatus,setAccountingStatus] = useState("Loading every active FY27 site…"); const [lastSaved,setLastSaved] = useState("");
  const [monthFilter,setMonthFilter] = useState("");
  const [notifications,setNotifications] = useState<PrfNotification[]>([]);
  const announce = (kind:Parameters<typeof notify>[0], request:Request, note="") => setNotifications(previous=>[notify(kind,request,note),...previous].slice(0,50));
  const lastActivity = useRef(Date.now()); const [sessionExpired,setSessionExpired] = useState(false);
  const [filters,setFilters] = useState({query:"",month:"",district:"",school:"",status:"",funding:""});
  const [form,setForm] = useState<PrfFormState>(() => freshForm());
  const editingIdRef = useRef<string|null>(null); useEffect(()=>{editingIdRef.current=editingId},[editingId]);
  const formRef = useRef(form); useEffect(()=>{formRef.current=form},[form]);
  const dirtyRef = useRef(false); const [dirty,setDirty] = useState(false);
  const baselineRef = useRef("");

  // ---- session ---------------------------------------------------------------------------------------

  // Sign-out has to leave nothing behind on a shared computer: the cookie is cleared by the server, and
  // every draft, editor buffer and mirrored copy this app has written locally goes with it.
  const clearLocalCaches = () => {
    try {
      for(const key of Object.keys(window.localStorage)) if(key.startsWith("prf-")) window.localStorage.removeItem(key);
      window.sessionStorage.clear();
    } catch {}
    void deleteIndexedDraft();
  };

  const endLocalSession = (message:string) => {
    clearLocalCaches();
    setSession(previous=>({authenticated:false,passwordLoginEnabled:previous?.passwordLoginEnabled!==false}));
    setRequests([]); setSelected(null); setCreating(false); setEditingId(null); editingIdRef.current=null;
    setNotifications([]); setSessionExpired(false); setNotice(""); setForm(freshForm()); setAuthNotice(message);
  };

  /**
   * Runs an API call and routes its failure to the right place.
   *
   * A session that has ended is not an error the page can recover from, so it drops straight back to the
   * login screen with the server's own wording. Anything else is a message for the surface in front of the
   * user, not a thrown exception that unmounts the editor they were typing in.
   */
  const guard = async <T,>(work:()=>Promise<T>):Promise<T|null> => {
    try { return await work(); }
    catch(error) {
      if(error instanceof SessionEndedError) { endLocalSession(error.message); return null; }
      setNotice(error instanceof Error ? error.message : "Something went wrong");
      return null;
    }
  };

  const refresh = async () => {
    const rows = await guard(fetchRequests);
    if(rows) setRequests(rows.map(toViewRequest));
  };

  const adopt = (info:SessionInfo) => {
    setSession(info); setAuthNotice(""); setAuthError("");
    if(info.user) { setView(info.user.role==="APPROVER"?"approvals":"overview"); setForm(freshForm(info.user.name)); }
  };

  useEffect(()=>{ void (async()=>{
    const info = await getSession();
    if(info.authenticated&&info.user) { adopt(info); await refresh(); }
    else setSession(info);
  })() },[]);

  const signIn = async (credentials:Credentials) => {
    setAuthBusy(true); setAuthError("");
    try { adopt(await login(credentials.email,credentials.password)); await refresh(); }
    catch(error) { setAuthError(error instanceof Error?error.message:"Unable to sign in"); }
    finally { setAuthBusy(false); }
  };

  const signOut = async () => {
    setAuthBusy(true);
    await logout();
    endLocalSession("You have been signed out.");
    setAuthBusy(false);
  };

  // The browser's copy of the idle rule. The server enforces the same hour independently — this exists so
  // an inactive signer sees an explanation instead of a request that suddenly fails.
  useEffect(()=>{
    const active = () => { if(!sessionExpired) lastActivity.current=Date.now() };
    const events = ["keydown","mousedown","mousemove","touchstart","scroll"] as const;
    events.forEach(event=>window.addEventListener(event,active,{passive:true}));
    const timer = setInterval(()=>{ if(Date.now()-lastActivity.current>=3600000){ safeStorage.set("prf-active-draft-v1",JSON.stringify(formRef.current)); void saveIndexedDraft(formRef.current,user?.email||""); setSessionExpired(true) } },60000);
    return()=>{ events.forEach(event=>window.removeEventListener(event,active)); clearInterval(timer) };
  },[sessionExpired]);

  const resumeSession = async () => {
    const info = await getSession();
    if(info.authenticated&&info.user) { lastActivity.current=Date.now(); setSessionExpired(false); setSession(info); await refresh(); }
    else endLocalSession(info.message||"Your session ended after an hour of inactivity. Please sign in again.");
  };

  // ---- editor ----------------------------------------------------------------------------------------

  useEffect(()=>{ if(!creating) return; const previous=document.body.style.overflow; document.body.style.overflow="hidden"; return()=>{document.body.style.overflow=previous} },[creating]);
  useEffect(()=>{ if(!creating){dirtyRef.current=false;setDirty(false);return} baselineRef.current=JSON.stringify(form); dirtyRef.current=false; setDirty(false) },[creating]);
  useEffect(()=>{ if(!creating) return; const changed=JSON.stringify(form)!==baselineRef.current; if(changed!==dirtyRef.current){dirtyRef.current=changed;setDirty(changed)} },[form,creating]);
  useEffect(()=>{ if(creating&&editingId) safeStorage.set(`prf-editor-${editingId}`,JSON.stringify(form)) },[creating,editingId,form]);

  useEffect(()=>{ if(!creating) return; let active=true;
    setAccountingStatus("Loading every active FY27 site…");
    fetch("/api/accounting-codes?scope=all").then(async response=>{
      const data=await response.json();
      if(!response.ok) throw new Error(data.error||"Unable to load accounting codes");
      if(!active) return;
      const options=(data.options||[]) as AccountingCode[]; setAccounting(options);
      const count=(match:(option:AccountingCode)=>boolean)=>new Set(options.filter(match).map(option=>option.siteKey)).size;
      const sites=count(()=>true),schools=count(option=>option.source===SCHOOL_TAB),grants=count(option=>option.source==="Grants"),added=count(option=>option.source==="Finance overrides");
      const departments=sites-schools-grants-added;
      setAccountingStatus(options.length?`${sites} active FY27 sites loaded — ${schools} school sites, ${departments} departments / overhead, ${grants} grants & programs${added?`, ${added} added by Finance`:""}. Type to search by site name or code; the funding source fills in automatically.`:"No active accounting options found in the FY27 workbook");
    }).catch(error=>{ if(active) setAccountingStatus(error.message) });
    return()=>{active=false};
  },[creating]);

  const saveNativeDraft = async (silent=false) => {
    const snapshot=formRef.current; const payload=draftPayload(snapshot); const activeId=editingIdRef.current;
    const saved = activeId ? await guard(()=>updateRequest(activeId,payload)) : await guard(()=>createRequest(payload));
    if(!saved) return null;
    const row = toViewRequest(saved);
    setRequests(previous=>previous.some(entry=>entry.id===row.id)?previous.map(entry=>entry.id===row.id?row:entry):[row,...previous]);
    editingIdRef.current=row.id; setEditingId(row.id);
    safeStorage.set(`prf-editor-${row.id}`,JSON.stringify(snapshot));
    setLastSaved("Saved just now");
    if(!silent) setNotice("Open Draft saved. You can close and resume it at any time.");
    return row;
  };

  // Auto-save: the local copy every 30 seconds so a closed tab loses nothing, and the server copy whenever
  // the draft has content worth keeping.
  useEffect(()=>{ if(!creating) return;
    const persist=()=>{ const snapshot=formRef.current; safeStorage.set("prf-active-draft-v1",JSON.stringify(snapshot)); safeStorage.set("prf-active-draft-saved-at",new Date().toISOString()); void saveIndexedDraft(snapshot,user?.email||""); if(editingIdRef.current) safeStorage.set(`prf-editor-${editingIdRef.current}`,JSON.stringify(snapshot)); setLastSaved(`Saved ${new Date().toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})}`) };
    persist();
    const timer=setInterval(()=>{ persist(); if(hasContent(formRef.current)) void saveNativeDraft(true) },30000);
    const unload=(event:BeforeUnloadEvent)=>{ persist(); if(dirtyRef.current){event.preventDefault();event.returnValue=""} };
    window.addEventListener("beforeunload",unload);
    return()=>{ clearInterval(timer); window.removeEventListener("beforeunload",unload); persist() };
  },[creating]);

  const submitNative = async () => {
    if(!form.requestorSignature||!form.requestorName||!form.requestorDate){ setNotice("Add the requester name, signature, and date before submitting."); return }
    if(vague(form.description)){ setNotice("Please detail specific items, quantities, and educational purpose."); return }
    const saved = await saveNativeDraft(true); if(!saved) return;
    const submitted = await guard(()=>submitPrf(saved.id,form.requestorSignature)); if(!submitted) return;
    const row = toViewRequest(submitted);
    setRequests(previous=>previous.map(entry=>entry.id===row.id?row:entry));
    announce("submitted",row);
    safeStorage.remove("prf-active-draft-v1"); safeStorage.remove("prf-active-draft-saved-at");
    setEditingId(null); editingIdRef.current=null; setCreating(false); setNotice("");
  };

  const closeEditor = () => {
    if(dirtyRef.current&&!window.confirm("This PRF has unsaved changes.\n\nOK — save it as an Open Draft and close.\nCancel — keep editing.")) return;
    if(dirtyRef.current) void saveNativeDraft(true);
    setCreating(false); setNotice("");
  };

  const startNew = () => { editingIdRef.current=null; setEditingId(null); setForm(freshForm(user?.name||"")); setAccounting([]); setAccountingStatus("Loading every active FY27 site…"); setLastSaved(""); setNotice(""); safeStorage.remove("prf-active-draft-v1"); safeStorage.remove("prf-active-draft-saved-at"); void deleteIndexedDraft(); setCreating(true) };

  const resume = (request:Request) => {
    setEditingId(request.id); editingIdRef.current=request.id;
    const stored=safeStorage.get(`prf-editor-${request.id}`);
    if(stored) try { const saved=JSON.parse(stored); setForm({...freshForm(user?.name||""),...saved,siteKey:saved.siteKey||siteKeyOf(saved.siteCode,saved.school),siteName:saved.siteName||saved.school||""}); setCreating(true); return } catch {}
    const base=freshForm(user?.name||"");
    setForm({...base,vendor:request.vendor,description:request.description,amount:String(request.amount),district:request.district,school:request.school,siteKey:siteKeyOf(request.siteCode,request.school),siteName:request.school,siteCode:request.siteCode,fundingCode:request.fundingCode,
      lineItems:Array.from({length:10},(_,index)=>{const line=request.lineItems[index];return line?{description:line.description,quantity:String(line.quantity),expenseType:"Program Supplies",club:"",splitSite:"",amount:String(line.quantity*line.unitPrice)}:blankLine()}),
      requestorName:request.requester,requestorSignature:request.requesterSigned?request.requester:""});
    setCreating(true);
  };

  const deleteDraft = async (request:Request) => {
    if(request.status!=="Draft") return;
    if(!window.confirm("Are you sure you want to delete this draft? This action cannot be undone.")) return;
    const done = await guard(()=>deletePrf(request.id)); if(!done) return;
    setRequests(previous=>previous.filter(entry=>entry.id!==request.id));
    safeStorage.remove(`prf-editor-${request.id}`);
    if(editingIdRef.current===request.id){ editingIdRef.current=null; setEditingId(null); setCreating(false); setForm(freshForm(user?.name||"")); safeStorage.remove("prf-active-draft-v1"); safeStorage.remove("prf-active-draft-saved-at"); void deleteIndexedDraft() }
  };

  // ---- approvals -------------------------------------------------------------------------------------

  const decide = async (request:Request, action:"approve"|"reject", comment="") => {
    const updated = await guard(()=>decidePrf(request.id,action,comment,action==="approve"?(user?.name||""):""));
    if(!updated) return;
    const row = toViewRequest(updated);
    setRequests(previous=>previous.map(entry=>entry.id===row.id?row:entry));
    setSelected(null); setAuditOpen(false);
    announce(action==="approve"?"approved":"returned",row,comment);
  };

  // ---- derived ---------------------------------------------------------------------------------------

  const filtered = useMemo(()=>requests.filter(request=>
    (!filters.query||`${request.id} ${request.vendor} ${request.description}`.toLowerCase().includes(filters.query.toLowerCase()))&&
    (!filters.month||request.approvedAt?.startsWith(filters.month))&&
    (!filters.district||request.district===filters.district)&&
    (!filters.school||request.school===filters.school)&&
    (!filters.status||request.status===filters.status)&&
    (!filters.funding||request.fundingCode===filters.funding)),[requests,filters]);

  const navigate = (next:View) => { setView(next); window.scrollTo({top:0,behavior:"smooth"}) };

  // ---- render ----------------------------------------------------------------------------------------

  if(!session) return <main className="loginPage"><section className="loginCard"><h1>Purchase Request Hub</h1><p className="loginLead">Checking your session…</p></section></main>;
  if(!session.authenticated||!user) return <LoginScreen onSubmit={signIn} busy={authBusy} error={authError} notice={authNotice} passwordLoginEnabled={session.passwordLoginEnabled!==false}/>;

  // Navigation is built from the role rather than disabled by it: an area a person can never enter is
  // clutter, not a locked door, and the door itself is on the server.
  const navItems = isApprover
    ? [{id:"overview",label:"Overview"},{id:"approvals",label:"Approvals"},{id:"finance",label:"Finance"}]
    : [{id:"overview",label:"Overview"},{id:"requests",label:"My Requests"}];
  const current:View = navItems.some(item=>item.id===view) ? view : "overview";
  const queue = requests.filter(request=>monthFilter?request.approvedAt?.startsWith(monthFilter):request.status==="Awaiting Approval");
  const reviewing = Boolean(selected&&isApprover&&current==="approvals"&&selected.status==="Awaiting Approval");

  return <main>
    <AppHeader
      items={navItems}
      active={current} onNavigate={id=>navigate(id as View)} onBrandClick={()=>navigate("overview")}
      initials={initialsOf(user.name)} userName={user.name} userRole={PORTAL_LABEL[user.role]} userOrg={`${user.district}${user.school?` — ${user.school}`:""}`}
      actions={<>
        <NotificationBell notifications={notifications} onMarkAllRead={()=>setNotifications(markAllRead)} onOpen={id=>{const found=requests.find(entry=>entry.id===id);if(found)setSelected(found)}}/>
        <button type="button" className="signOut" onClick={()=>void signOut()} disabled={authBusy}>Sign out</button>
      </>}
    />

    {current==="overview"&&<>
      <Hero
        eyebrow="FY 2027 · SPENDING CYCLE 01"
        title={isApprover?"Every request,":"Purchasing made"} titleAccent={isApprover?"one clear queue.":"clear & connected."}
        copy={isApprover
          ?"Review what is waiting on your signature, approve or send it back with a comment, and export the register for reporting."
          :"Create, route, and track every purchase request in one friendly workspace—without chasing forms or email threads."}
        primaryLabel={isApprover?"Open review queue":"Start a new request"} onPrimary={()=>isApprover?navigate("approvals"):startNew()}
        secondaryLabel={isApprover?"Finance register":"View my requests"} onSecondary={()=>navigate(isApprover?"finance":"requests")}
        trailCard={requests[0]?{id:requests[0].id,status:requests[0].status,note:`${requests[0].requester} · ${requests[0].school||requests[0].district}`}:undefined}
      />
      <Summary requests={requests}/>
      {!isApprover&&<RequestTrail requests={requests.slice(0,3)} onOpen={setSelected} onResume={resume} onDelete={deleteDraft} title="Your request trail"/>}
      <ActionRow>
        {isApprover
          ? <ReviewPanel eyebrow="YOUR QUEUE" title={queue.length?`${queue.length} request${queue.length===1?" is":"s are"} ready for your review.`:"Nothing is waiting on you."}
              copy={queue.length?"Each one has been signed by its requester and routed to you by the approved dollar thresholds.":"Approved and returned requests stay searchable in the Finance register."}
              amount={queue.length?money(queue.reduce((sum,request)=>sum+request.amount,0)):""} actionLabel="Open the queue →" onAction={()=>navigate("approvals")}/>
          : <TipPanel title="Help requests move faster" copy="Brief descriptions are flagged before submission. Include specific items, quantities, intended users, and educational purpose." actionLabel="Create a clear request →" onAction={startNew}/>}
      </ActionRow>
    </>}

    {current==="requests"&&!isApprover&&<section className="page">
      <PageHead eyebrow="Requester workspace" title="My Requests" copy="Resume drafts, track approvals, and retrieve your completed requests." action={<div className="headActions"><MonthFilter value={monthFilter} onChange={setMonthFilter}/><button onClick={startNew}>＋ New request</button></div>}/>
      <Summary requests={requests}/>
      <RequestTrail requests={monthFilter?requests.filter(request=>request.approvedAt?.startsWith(monthFilter)):requests} onOpen={setSelected} onResume={resume} onDelete={deleteDraft} title={monthFilter?`Approved in ${monthLabel(monthFilter)}`:"All requests"}/>
    </section>}

    {current==="approvals"&&isApprover&&<section className="page">
      <PageHead eyebrow="Approval center" title="Review Queue" copy="Requests are automatically routed according to the approved dollar thresholds." action={<MonthFilter value={monthFilter} onChange={setMonthFilter}/>}/>
      <div className="queueList">{queue.map(request=><QueueItem key={request.id} request={request} onOpen={setSelected}/>)}</div>
    </section>}

    {current==="finance"&&isApprover&&<Finance requests={filtered} all={requests} filters={filters} setFilters={setFilters} onOpen={setSelected} districts={districts}/>}

    <AppFooter/>

    {creating&&!isApprover&&<RequestForm form={form} setForm={setForm} notice={notice} accounting={accounting} accountingStatus={accountingStatus} lastSaved={lastSaved} dirty={dirty} onClose={closeEditor} onSave={()=>void saveNativeDraft()} onProceed={()=>void submitNative()}/>}
    {creating&&!isApprover&&editingId&&<button className="modalDeleteDraft" onClick={()=>{const draft=requests.find(request=>request.id===editingId);if(draft)void deleteDraft(draft)}}>Delete Draft</button>}

    {selected&&(reviewing
      ? <SupervisorReview request={selected} onClose={()=>setSelected(null)} onApprove={request=>void decide(request,"approve")} onReject={(request,note)=>void decide(request,"reject",note)}/>
      : <RequestModal request={selected} onClose={()=>{setSelected(null);setAuditOpen(false)}} auditOpen={auditOpen} setAuditOpen={setAuditOpen} canApprove={false} onAction={()=>undefined}/>)}
    {selected&&isApprover&&<button className="financeDownload" onClick={()=>downloadFormattedPrfPdf(selected)}>Download PRF PDF ↓</button>}

    {sessionExpired&&<SessionDialog onRefresh={()=>void resumeSession()}/>}
  </main>;
}

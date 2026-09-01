import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import readXlsxFile from "read-excel-file/node";

export type AccountingCode={source:string;fundingSource:string;fundingSourceId:string;siteCode:string;siteName:string;siteKey:string;region:string;expenseType:string;status:string;notes:string;availability:"active"|"expiring";custom?:boolean};

// Each workbook tab uses its own column names, so a single header lookup cannot read them all. The Grants
// tab in particular has no Site Name column at all, and its "Site Code" column holds labels rather than
// numbers ("Residential Camp", "CNRA") — none of them resolve against the All Sites directory.
type TabSpec={
  sheet:string;
  fundingSource:string;
  siteCode?:string;
  /** Column holding the site's display name. Grants has none, so its site label doubles as the name. */
  siteName?:string;
  fundingSourceId?:string;
  status?:string;
  region?:string;
  /** Fixed region when the tab has no column for it. */
  regionDefault?:string;
  expenseType?:string;
  /** Unnamed trailing columns that each hold one permitted expense type (Dept Codes). */
  expenseTypeSpan?:[number,number];
  notes?:string;
  /** A row is usable when it has a site code AND name, or just a name. */
  requires:"code-and-name"|"name";
};

const TAB_SPECS:TabSpec[]=[
  {sheet:"FY27",fundingSource:"Funding Source Name",siteCode:"Site Code",siteName:"Site Name",notes:"Notes",regionDefault:"Woodcraft",requires:"code-and-name"},
  {sheet:"School Site Codes FY27",fundingSource:"Funding Source Name",siteCode:"Site Code",siteName:"Site Name",status:"Status",region:"Region",expenseType:"Expense Type",notes:"Notes",requires:"code-and-name"},
  // Grants carry the period-specific funding names the PRF form is meant to show ("TUPE 25-26").
  {sheet:"Grants",fundingSource:"Funding Source Name",fundingSourceId:"Funding Source ID",siteName:"Site Code",status:"Status",region:"Region",notes:"Notes",requires:"name"},
  // Dept Codes adds 18 department-level funding sources that appear on no other tab (its site codes overlap
  // the FY27 tab by exactly one). Its "Active?" column is deliberately NOT mapped to `status`: every
  // populated row reads "No", which the inactive-word test would match, silently discarding the whole tab.
  // Until that column's meaning is confirmed, these rows are treated as available.
  {sheet:"Dept Codes",fundingSource:"Funding Source",siteCode:"Site Code",siteName:"Site Name",region:"Region",expenseTypeSpan:[5,9],requires:"code-and-name"},
];

export const SITE_TABS=TAB_SPECS.map(spec=>spec.sheet);
/** Tabs whose rows are department / overhead sites rather than school sites. */
export const DEPARTMENT_TABS=["FY27","Dept Codes"];

let cached:Promise<AccountingCode[]>|undefined;
const clean=(v:unknown)=>v==null?"":String(v).trim();
const code=(v:unknown)=>{const value=clean(v);return value.endsWith(".0")?value.slice(0,-2):value};
export const siteKeyOf=(siteCode:unknown,siteName:unknown)=>{const code=clean(siteCode),name=clean(siteName);return code||name?`${code}|${name}`:""};

/**
 * Finance-editable additions, layered on top of the workbook.
 *
 * The master file lags real life: a new partnership lands mid-year, or a partner's funding needs to be
 * split by period ("Camino Nuevo 26-27" vs "Camino Nuevo Summer 26") before the workbook is reissued.
 * Rows listed here are merged in as ordinary options so the dropdown can offer them immediately.
 */
type FundingOverrides={additions?:{site:string;fundingSource:string;fundingSourceId?:string;expenseType?:string;notes?:string;region?:string}[]};
const OVERRIDES_PATH=process.env.FUNDING_OVERRIDES_PATH||"config/funding-overrides.json";
let overridesCache:Promise<FundingOverrides>|undefined;
function loadOverrides(){
  if(!overridesCache) overridesCache=(async()=>{
    try{
      const raw=await fs.readFile(path.resolve(process.cwd(),OVERRIDES_PATH),"utf8");
      const parsed=JSON.parse(raw) as FundingOverrides;
      return parsed&&Array.isArray(parsed.additions)?parsed:{additions:[]};
    }catch(error){
      // Absent or unreadable overrides must never take the accounting dropdown down with them.
      if((error as NodeJS.ErrnoException)?.code!=="ENOENT") console.warn("funding overrides ignored:",(error as Error).message);
      return {additions:[]};
    }
  })();
  return overridesCache;
}

export function loadAccountingCodes(){
  if(!cached) cached=(async()=>{
    const workbook=process.env.ACCOUNTING_WORKBOOK_PATH||".secure-data/Accounting Codes FY27.xlsx";
    const sheets=await readXlsxFile(path.resolve(process.cwd(),workbook));
    const rows:AccountingCode[]=[];
    for(const {sheet,data} of sheets){
      const spec=TAB_SPECS.find(entry=>entry.sheet===sheet);
      if(!spec) continue;
      const header=(data[0]||[]).map(clean);
      const at=(row:unknown[],name?:string)=>{if(!name) return "";const column=header.indexOf(name);return column<0?"":clean(row[column])};
      for(const row of data.slice(1) as unknown[][]){
        const siteCode=code(at(row,spec.siteCode)),siteName=at(row,spec.siteName);
        if(spec.requires==="code-and-name"?!(siteCode&&siteName):!siteName) continue;
        // Dept Codes spreads its permitted expense types across several unnamed trailing columns.
        const spanned=spec.expenseTypeSpan?row.slice(spec.expenseTypeSpan[0],spec.expenseTypeSpan[1]+1).map(clean).filter(Boolean).join(", "):"";
        rows.push({
          source:sheet,
          fundingSource:at(row,spec.fundingSource),
          fundingSourceId:at(row,spec.fundingSourceId),
          siteCode,siteName,siteKey:siteKeyOf(siteCode,siteName),
          region:at(row,spec.region)||spec.regionDefault||"",
          expenseType:at(row,spec.expenseType)||spanned,
          status:at(row,spec.status)||"Active",
          notes:at(row,spec.notes),
          availability:"active",
        });
      }
    }
    for(const addition of (await loadOverrides()).additions||[]){
      const site=clean(addition.site);
      if(!site||!clean(addition.fundingSource)) continue;
      // `site` may be given as "code|name", a bare code, or a bare name.
      const [left,right]=site.includes("|")?site.split("|"):[/^\d+$/.test(site)?site:"",site.includes("|")?"":site];
      const match=rows.find(row=>row.siteKey===site||row.siteCode===site||row.siteName===site);
      const siteCode=match?.siteCode??code(left),siteName=match?.siteName??(clean(right)||site);
      rows.push({
        source:"Finance overrides",
        fundingSource:clean(addition.fundingSource),
        fundingSourceId:clean(addition.fundingSourceId),
        siteCode,siteName,siteKey:siteKeyOf(siteCode,siteName),
        region:clean(addition.region)||match?.region||"",
        expenseType:clean(addition.expenseType),
        status:"Active",
        notes:clean(addition.notes)||"Added by Finance override",
        availability:"active",
      });
    }
    return rows.filter(r=>r.siteName||r.siteCode||r.fundingSource);
  })();
  return cached;
}

const normalized=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]/g,"");
const inactiveWord=(value:string)=>/^(in-?active|not\s*active|no|n)$/i.test(value.trim());
const inactive=(row:AccountingCode)=>inactiveWord(row.status)||/\b(in-?active|not\s+active)\b/i.test(row.notes);
const summerExpired=(row:AccountingCode,now:Date)=>/deactivate|desactivate/i.test(row.notes)&&/summer\s*2026/i.test(row.notes)&&now>=new Date("2026-09-01T00:00:00-07:00");
const available=(row:AccountingCode,now:Date)=>!inactive(row)&&!summerExpired(row,now)&&Boolean(row.siteName);
const withAvailability=(row:AccountingCode)=>({...row,availability:/deactivate|desactivate/i.test(row.notes)&&/summer\s*2026/i.test(row.notes)?"expiring" as const:"active" as const});
const bySiteThenFunding=(a:AccountingCode,b:AccountingCode)=>a.siteName.localeCompare(b.siteName)||a.siteCode.localeCompare(b.siteCode)||a.fundingSource.localeCompare(b.fundingSource);
// Site identity is Site Code + Site Name: the workbook reuses a few codes across genuinely different sites
// (2324 is both "Lennox Middle School- LX" and "McKinley ES"), and keying on the code alone hides one of them.
const rowKey=(row:AccountingCode)=>`${row.source}|${row.siteKey}|${row.fundingSource}`;

export async function codesForAllSites(){
  const now=new Date();
  const eligible=(await loadAccountingCodes()).filter(row=>available(row,now)).map(withAvailability).sort(bySiteThenFunding);
  return [...new Map(eligible.map(row=>[rowKey(row),row])).values()];
}
export async function codesForSite(site:string){
  const target=normalized(site); const all=await loadAccountingCodes();
  const now=new Date();
  const eligible=all.filter(row=>available(row,now));
  const matches=eligible.filter(r=>{const name=normalized(r.siteName);return target&&name&&(name.includes(target)||target.includes(name))});
  const siteNumbers=new Set(matches.map(r=>r.siteCode).filter(Boolean));
  const related=eligible.filter(r=>matches.includes(r)||(r.siteCode&&siteNumbers.has(r.siteCode))).map(withAvailability).sort(bySiteThenFunding);
  return [...new Map(related.map(r=>[rowKey(r),r])).values()];
}

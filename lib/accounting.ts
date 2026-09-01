import "server-only";
import path from "node:path";
import readXlsxFile from "read-excel-file/node";

export type AccountingCode={source:string;fundingSource:string;fundingSourceId:string;siteCode:string;siteName:string;siteKey:string;region:string;expenseType:string;status:string;notes:string;availability:"active"|"expiring"};
export const SITE_TABS=["FY27","School Site Codes FY27"] as const;
let cached:Promise<AccountingCode[]>|undefined;
const clean=(v:unknown)=>v==null?"":String(v).trim();
const code=(v:unknown)=>{const value=clean(v);return value.endsWith(".0")?value.slice(0,-2):value};
export const siteKeyOf=(siteCode:unknown,siteName:unknown)=>{const code=clean(siteCode),name=clean(siteName);return code||name?`${code}|${name}`:""};

export function loadAccountingCodes(){
  if(!cached) cached=(async()=>{
    const workbook=process.env.ACCOUNTING_WORKBOOK_PATH||".secure-data/Accounting Codes FY27.xlsx";
    const sheets=await readXlsxFile(path.resolve(process.cwd(),workbook));
    const rows:AccountingCode[]=[];
    for(const {sheet,data} of sheets){
      if(!(SITE_TABS as readonly string[]).includes(sheet)) continue;
      const header=(data[0]||[]).map(clean); const at=(row:unknown[],name:string)=>{const column=header.indexOf(name);return column<0?"":clean(row[column])};
      for(const row of data.slice(1) as unknown[][]){
        const siteCode=code(at(row,"Site Code")),siteName=at(row,"Site Name");
        // The FY27 department tab carries no Status/Region/Expense Type columns; every row on it is an active Woodcraft overhead site.
        rows.push({source:sheet,fundingSource:at(row,"Funding Source Name"),fundingSourceId:"",siteCode,siteName,siteKey:siteKeyOf(siteCode,siteName),region:sheet==="FY27"?"Woodcraft":at(row,"Region"),expenseType:at(row,"Expense Type"),status:at(row,"Status")||"Active",notes:at(row,"Notes"),availability:"active"});
      }
    }
    return rows.filter(r=>r.siteName||r.siteCode||r.fundingSource);
  })();
  return cached;
}

const normalized=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]/g,"");
const inactiveWord=(value:string)=>/^(in-?active|not\s*active|no|n)$/i.test(value.trim());
const inactive=(row:AccountingCode)=>inactiveWord(row.status)||/\b(in-?active|not\s+active)\b/i.test(row.notes);
const summerExpired=(row:AccountingCode,now:Date)=>/deactivate|desactivate/i.test(row.notes)&&/summer\s*2026/i.test(row.notes)&&now>=new Date("2026-09-01T00:00:00-07:00");
const available=(row:AccountingCode,now:Date)=>!inactive(row)&&!summerExpired(row,now)&&Boolean(row.siteCode&&row.siteName);
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
  const related=eligible.filter(r=>matches.includes(r)||siteNumbers.has(r.siteCode)).map(withAvailability).sort(bySiteThenFunding);
  return [...new Map(related.map(r=>[rowKey(r),r])).values()];
}

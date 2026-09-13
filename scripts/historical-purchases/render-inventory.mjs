import{readFileSync,writeFileSync}from'node:fs';import{createHash}from'node:crypto';import{pathToFileURL}from'node:url';
import{buildSourceCohort}from'./cohort.mjs';
export function renderInventory(source,catalog){
 const rows=buildSourceCohort(source,catalog).map(r=>({...r,titles_source_only:r.refs.map(ref=>source.rows.find(x=>x.ref===ref).title)}));
 const marker="/* SOURCE */ '[]'::jsonb",sql=readFileSync(new URL('./inventory.sql',import.meta.url),'utf8');
 if(sql.split(marker).length!==2)throw new Error('Inventory source marker changed');
 // Plain SQL SELECT, no DO dollar quote or mutation. Escape quotes for literal JSON.
 return sql.replace(marker,`'${JSON.stringify(rows).replaceAll("'","''")}'::jsonb`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const[,,manifest,catalog,out]=process.argv;if(!out)throw new Error('Usage: render-inventory.mjs source.json catalog.json output.sql');
 const sql=renderInventory(JSON.parse(readFileSync(manifest,'utf8')),JSON.parse(readFileSync(catalog,'utf8')));
 writeFileSync(out,sql,{mode:0o600});console.log(JSON.stringify({sha256:createHash('sha256').update(sql).digest('hex')}));
}

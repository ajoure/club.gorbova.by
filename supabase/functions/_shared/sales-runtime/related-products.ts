import {compileRelatedProduct,relatedProductIds} from './related-products.mjs';
export async function loadRelatedProducts(knowledge:any,currentProductId:string) {
 const snapshots=await Promise.all(relatedProductIds(knowledge,currentProductId).map(async(id:string)=>{
  try {
  const url=new URL('/functions/v1/public-product',Deno.env.get('SUPABASE_URL'));
  url.searchParams.set('product_id',id);
  const response=await fetch(url,{headers:{apikey:Deno.env.get('SUPABASE_ANON_KEY')??''},signal:AbortSignal.timeout(15000)});
  if(!response.ok) throw Error('related_catalog_unavailable');
  const data=await response.json();
  return {id,facts:compileRelatedProduct(data,id),available:true};
  } catch {return {id,facts:[],available:false};}
 }));
 return {facts:snapshots.flatMap(s=>s.facts),fingerprint:JSON.stringify(snapshots)};
}

import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// Actual migration executed in isolated PostgreSQL; no hosted credentials or calls.
const migration = readFileSync(new URL('../../supabase/migrations/20261027175329_bkb_custdev_workshop.sql',import.meta.url),'utf8');
export const serviceAclMigration = readFileSync(new URL('../../supabase/migrations/20261027203832_bkb_custdev_service_acl.sql',import.meta.url),'utf8');
export const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const a=id(1),b=id(2),admin=id(3),noAccess=id(4),lesson=id(10),block=id(11);
export const blank={version:1,segments:[],interviews:[],analyses:{},company:{userText:'',aiText:'',approvedText:'',task:'',specialization:'',difference:'',needIds:[]},positioning:{},usps:[]};
export async function fixture({applyServiceAcl=true}={}){
 const db=new PGlite();
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
 CREATE SCHEMA auth; GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT current_user::text$$;
 CREATE TABLE auth.users(id uuid PRIMARY KEY);
 CREATE TABLE public.training_lessons(id uuid PRIMARY KEY);
 CREATE TABLE public.lesson_blocks(id uuid PRIMARY KEY,lesson_id uuid,block_type text CONSTRAINT lesson_blocks_block_type_check CHECK(block_type IN ('video','paragraph')));
 CREATE TABLE public.user_lesson_progress(user_id uuid,lesson_id uuid,block_id uuid,response jsonb,is_correct boolean,score integer,max_score integer,completed_at timestamptz,updated_at timestamptz,UNIQUE(user_id,lesson_id,block_id));
 CREATE TABLE public.lesson_progress_state(user_id uuid,lesson_id uuid,state_json jsonb,updated_at timestamptz,UNIQUE(user_id,lesson_id));
 CREATE FUNCTION public.has_role_v2(_user_id uuid,_role_code text) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT _user_id='${admin}' AND _role_code='admin'$$;
 CREATE FUNCTION public.user_has_training_lesson_access(_user_id uuid,_lesson_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT _user_id IN ('${a}','${b}') AND _lesson_id='${lesson}'$$;
 GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
 GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public,auth TO authenticated,service_role;
 INSERT INTO auth.users VALUES('${a}'),('${b}'),('${admin}'),('${noAccess}');
 INSERT INTO public.training_lessons VALUES('${lesson}');
 INSERT INTO public.lesson_blocks VALUES('${id(12)}','${lesson}','video');
 ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;`);
 await db.exec(migration);
 if(applyServiceAcl) await db.exec(serviceAclMigration);
 await db.query('INSERT INTO public.lesson_blocks VALUES($1,$2,$3)',[block,lesson,'custdev_workshop']);
 const as=async(role,user,fn)=>{await db.exec(`SET ROLE ${role}`);await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[user]);try{return await fn();}finally{await db.exec('RESET ROLE');}};
 const save=(actor,owner,expected,state=blank,submit=false,review=null)=>as('service_role',actor,async()=> (await db.query('SELECT public.custdev_save_workspace($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9) AS w',[actor,owner,lesson,block,expected,JSON.stringify(state),submit,review,'Комментарий проверки'])).rows[0].w);
 return {db,as,save};
}


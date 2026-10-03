CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$$;
CREATE SCHEMA realtime;
CREATE TABLE realtime.messages (id bigint, extension text);
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION realtime.topic() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT current_setting('realtime.topic',true);
$$;
CREATE PUBLICATION supabase_realtime;
GRANT USAGE ON SCHEMA public,auth,realtime TO authenticated,anon;
GRANT EXECUTE ON FUNCTION auth.uid(),realtime.topic() TO authenticated,anon;

-- 藝述互評｜Supabase 資料庫及儲存設定
-- 在 Supabase SQL Editor 整份執行一次。重複執行可更新函式，不會刪除已有資料。
create extension if not exists pgcrypto;

create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  join_code text not null unique,
  teacher_pin_hash text not null,
  duration_minutes integer not null default 15 check (duration_minutes between 1 and 120),
  current_round_id uuid,
  created_at timestamptz not null default now()
);
create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  student_no text not null,
  display_name text not null,
  token text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique(class_id, student_no)
);
create table if not exists public.rounds (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  round_no integer not null,
  status text not null default 'collecting' check (status in ('collecting','reviewing','complete')),
  submission_starts_at timestamptz not null default now(),
  submission_ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique(class_id, round_no)
);
create table if not exists public.artworks (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  title text not null default '我的作品',
  image_path text not null,
  created_at timestamptz not null default now(),
  unique(round_id, student_id)
);
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds(id) on delete cascade,
  artwork_id uuid not null unique references public.artworks(id) on delete cascade,
  reviewer_id uuid not null references public.students(id) on delete cascade,
  appreciation text not null default '',
  improvement text not null default '',
  submitted_at timestamptz,
  unique(round_id, reviewer_id)
);
create index if not exists idx_students_class on public.students(class_id);
create index if not exists idx_artworks_round on public.artworks(round_id);
create index if not exists idx_reviews_reviewer on public.reviews(round_id, reviewer_id);

alter table public.classes enable row level security;
alter table public.students enable row level security;
alter table public.rounds enable row level security;
alter table public.artworks enable row level security;
alter table public.reviews enable row level security;
revoke all on public.classes, public.students, public.rounds, public.artworks, public.reviews from anon, authenticated;

-- 原子化截止及分配：鎖定班別，避免多名學生同時重新整理造成重複分配。
create or replace function public._advance_round(p_class_id uuid, p_force boolean default false)
returns void language plpgsql security definer set search_path = public, pg_temp, extensions as $$
declare
  v_round public.rounds%rowtype;
  v_count integer;
  v_submitted integer;
begin
  select r.* into v_round
  from public.classes c join public.rounds r on r.id = c.current_round_id
  where c.id = p_class_id
  for update of c, r;
  if not found then return; end if;

  if v_round.status = 'collecting' and (p_force or now() >= v_round.submission_ends_at) then
    select count(*) into v_count from public.artworks where round_id = v_round.id;
    if v_count >= 2 then
      with shuffled as (
        select a.id, a.student_id,
          row_number() over (order by random()) as rn,
          count(*) over () as n
        from public.artworks a where a.round_id = v_round.id
      ), pairs as (
        select s.id as artwork_id,
          (select s2.student_id from shuffled s2
           where s2.rn = case when s.rn = s.n then 1 else s.rn + 1 end) as reviewer_id
        from shuffled s
      )
      insert into public.reviews(round_id, artwork_id, reviewer_id)
      select v_round.id, p.artwork_id, p.reviewer_id from pairs p
      on conflict (artwork_id) do nothing;
      update public.rounds set status = 'reviewing' where id = v_round.id;
      v_round.status := 'reviewing';
    else
      -- 少於兩份作品時無法互評，直接完結並保留原作品。
      update public.rounds set status = 'complete' where id = v_round.id;
      v_round.status := 'complete';
    end if;
  end if;

  if v_round.status = 'reviewing' then
    select count(*), count(submitted_at) into v_count, v_submitted
    from public.reviews where round_id = v_round.id;
    if v_count > 0 and v_count = v_submitted then
      update public.rounds set status = 'complete' where id = v_round.id;
    end if;
  end if;
end $$;
revoke all on function public._advance_round(uuid, boolean) from public, anon, authenticated;

create or replace function public.create_class(
  p_class_name text, p_join_code text, p_pin text, p_duration integer default 15
) returns json language plpgsql security definer set search_path = public, pg_temp, extensions as $$
declare v_code text := upper(trim(p_join_code));
begin
  if length(trim(p_class_name)) < 1 or length(trim(p_class_name)) > 60 then raise exception '班別名稱長度不正確'; end if;
  if v_code !~ '^[A-Z0-9-]{4,12}$' then raise exception '班別代碼須為 4–12 位英文、數字或連字號'; end if;
  if length(p_pin) < 4 or length(p_pin) > 64 then raise exception '老師 PIN 須為 4–64 位'; end if;
  if p_duration not between 1 and 120 then raise exception '時限須為 1–120 分鐘'; end if;
  insert into public.classes(name, join_code, teacher_pin_hash, duration_minutes)
  values(trim(p_class_name), v_code, extensions.crypt(p_pin, extensions.gen_salt('bf')), p_duration);
  return json_build_object('join_code', v_code);
end $$;

create or replace function public.join_class(
  p_join_code text, p_student_no text, p_display_name text
) returns json language plpgsql security definer set search_path = public, pg_temp, extensions as $$
declare v_class public.classes%rowtype; v_student public.students%rowtype;
begin
  select * into v_class from public.classes where join_code = upper(trim(p_join_code));
  if not found then raise exception '找不到這個班別代碼'; end if;
  if length(trim(p_student_no)) < 1 or length(trim(p_student_no)) > 20 then raise exception '學生編號長度不正確'; end if;
  if length(trim(p_display_name)) < 1 or length(trim(p_display_name)) > 40 then raise exception '姓名長度不正確'; end if;
  insert into public.students(class_id, student_no, display_name)
  values(v_class.id, trim(p_student_no), trim(p_display_name))
  on conflict(class_id, student_no) do update set display_name = excluded.display_name, last_seen_at = now()
  returning * into v_student;
  return json_build_object('token', v_student.token, 'display_name', v_student.display_name);
end $$;

create or replace function public.get_student_state(p_token text)
returns json language plpgsql security definer set search_path = public, pg_temp, extensions as $$
declare
  v_student public.students%rowtype; v_class public.classes%rowtype; v_round public.rounds%rowtype;
  v_art json; v_assignment json; v_received json;
begin
  select * into v_student from public.students where token = p_token;
  if not found then raise exception '登入紀錄已失效，請重新進入'; end if;
  update public.students set last_seen_at = now() where id = v_student.id;
  select * into v_class from public.classes where id = v_student.class_id;
  perform public._advance_round(v_class.id, false);
  if v_class.current_round_id is not null then select * into v_round from public.rounds where id = v_class.current_round_id; end if;

  if v_round.id is not null then
    select json_build_object('id',a.id,'title',a.title,'image_path',a.image_path,'created_at',a.created_at)
    into v_art from public.artworks a where a.round_id=v_round.id and a.student_id=v_student.id;
    select json_build_object(
      'id',rv.id,'submitted_at',rv.submitted_at,'appreciation',rv.appreciation,'improvement',rv.improvement,
      'artwork',json_build_object('id',a.id,'title',a.title,'image_path',a.image_path,'created_at',a.created_at)
    ) into v_assignment
    from public.reviews rv join public.artworks a on a.id=rv.artwork_id
    where rv.round_id=v_round.id and rv.reviewer_id=v_student.id;
    select json_build_object('appreciation',rv.appreciation,'improvement',rv.improvement,'submitted_at',rv.submitted_at)
    into v_received
    from public.reviews rv join public.artworks a on a.id=rv.artwork_id
    where a.round_id=v_round.id and a.student_id=v_student.id and rv.submitted_at is not null;
  end if;
  return json_build_object(
    'class',json_build_object('id',v_class.id,'name',v_class.name,'join_code',v_class.join_code,'duration_minutes',v_class.duration_minutes),
    'student',json_build_object('id',v_student.id,'student_no',v_student.student_no,'display_name',v_student.display_name),
    'round',case when v_round.id is null then null else json_build_object('id',v_round.id,'round_no',v_round.round_no,'status',v_round.status,'submission_starts_at',v_round.submission_starts_at,'submission_ends_at',v_round.submission_ends_at) end,
    'my_artwork',v_art,'assignment',v_assignment,'received',v_received,'server_now',now()
  );
end $$;

create or replace function public.submit_artwork(
  p_token text, p_title text, p_image_path text
) returns json language plpgsql security definer set search_path = public, pg_temp, extensions as $$
declare v_student public.students%rowtype; v_class public.classes%rowtype; v_round public.rounds%rowtype; v_art public.artworks%rowtype;
begin
  select * into v_student from public.students where token=p_token;
  if not found then raise exception '登入紀錄已失效'; end if;
  select * into v_class from public.classes where id=v_student.class_id;
  select * into v_round from public.rounds where id=v_class.current_round_id for update;
  if not found or v_round.status<>'collecting' or now()>=v_round.submission_ends_at then raise exception '上載時間已完結'; end if;
  if p_image_path not like (v_class.join_code||'/'||v_student.id::text||'/%') or length(p_image_path)>500 then raise exception '圖片路徑不正確'; end if;
  insert into public.artworks(round_id,student_id,title,image_path)
  values(v_round.id,v_student.id,coalesce(nullif(trim(p_title),''),'我的作品'),p_image_path)
  on conflict(round_id,student_id) do update set title=excluded.title,image_path=excluded.image_path,created_at=now()
  returning * into v_art;
  return json_build_object('id',v_art.id,'created_at',v_art.created_at);
end $$;

create or replace function public.submit_review(
  p_token text, p_appreciation text, p_improvement text
) returns json language plpgsql security definer set search_path = public, pg_temp, extensions as $$
declare v_student public.students%rowtype; v_class public.classes%rowtype; v_round public.rounds%rowtype; v_review public.reviews%rowtype;
begin
  select * into v_student from public.students where token=p_token;
  if not found then raise exception '登入紀錄已失效'; end if;
  select * into v_class from public.classes where id=v_student.class_id;
  select * into v_round from public.rounds where id=v_class.current_round_id;
  if v_round.status<>'reviewing' then raise exception '目前不是互評階段'; end if;
  if length(trim(p_appreciation))<2 or length(trim(p_improvement))<2 then raise exception '請完成兩部分意見'; end if;
  if length(p_appreciation)>2000 or length(p_improvement)>2000 then raise exception '每部分意見不可超過 2000 字'; end if;
  update public.reviews set appreciation=trim(p_appreciation),improvement=trim(p_improvement),submitted_at=now()
  where round_id=v_round.id and reviewer_id=v_student.id and submitted_at is null
  returning * into v_review;
  if not found then raise exception '找不到待遞交的互評，或意見已經遞交'; end if;
  perform public._advance_round(v_class.id,false);
  return json_build_object('submitted_at',v_review.submitted_at);
end $$;

create or replace function public.get_teacher_state(p_join_code text, p_pin text)
returns json language plpgsql security definer set search_path = public, pg_temp, extensions as $$
declare v_class public.classes%rowtype; v_round public.rounds%rowtype; v_students json;
begin
  select * into v_class from public.classes where join_code=upper(trim(p_join_code));
  if not found or v_class.teacher_pin_hash<>extensions.crypt(p_pin,v_class.teacher_pin_hash) then raise exception '班別代碼或老師 PIN 不正確'; end if;
  perform public._advance_round(v_class.id,false);
  if v_class.current_round_id is not null then select * into v_round from public.rounds where id=v_class.current_round_id; end if;
  select coalesce(json_agg(json_build_object(
    'id',s.id,'student_no',s.student_no,'display_name',s.display_name,
    'has_artwork',(a.id is not null),
    'review_status',case when rv.submitted_at is not null then 'submitted' when rv.id is not null then 'assigned' else 'none' end
  ) order by s.student_no),'[]'::json) into v_students
  from public.students s
  left join public.artworks a on a.student_id=s.id and a.round_id=v_round.id
  left join public.reviews rv on rv.reviewer_id=s.id and rv.round_id=v_round.id
  where s.class_id=v_class.id;
  return json_build_object(
    'class',json_build_object('id',v_class.id,'name',v_class.name,'join_code',v_class.join_code,'duration_minutes',v_class.duration_minutes),
    'round',case when v_round.id is null then null else json_build_object('id',v_round.id,'round_no',v_round.round_no,'status',v_round.status,'submission_starts_at',v_round.submission_starts_at,'submission_ends_at',v_round.submission_ends_at) end,
    'students',v_students,'server_now',now()
  );
end $$;

create or replace function public.start_round(p_join_code text, p_pin text, p_duration integer default 15)
returns json language plpgsql security definer set search_path = public, pg_temp, extensions as $$
declare v_class public.classes%rowtype; v_round public.rounds%rowtype; v_no integer;
begin
  select * into v_class from public.classes where join_code=upper(trim(p_join_code)) for update;
  if not found or v_class.teacher_pin_hash<>extensions.crypt(p_pin,v_class.teacher_pin_hash) then raise exception '班別代碼或老師 PIN 不正確'; end if;
  if p_duration not between 1 and 120 then raise exception '時限須為 1–120 分鐘'; end if;
  if v_class.current_round_id is not null then
    select * into v_round from public.rounds where id=v_class.current_round_id;
    if v_round.status in ('collecting','reviewing') then raise exception '本輪活動尚未完結'; end if;
  end if;
  select coalesce(max(round_no),0)+1 into v_no from public.rounds where class_id=v_class.id;
  insert into public.rounds(class_id,round_no,status,submission_ends_at)
  values(v_class.id,v_no,'collecting',now()+make_interval(mins=>p_duration)) returning * into v_round;
  update public.classes set current_round_id=v_round.id,duration_minutes=p_duration where id=v_class.id;
  return json_build_object('round_id',v_round.id,'submission_ends_at',v_round.submission_ends_at);
end $$;

create or replace function public.close_submissions(p_join_code text, p_pin text)
returns json language plpgsql security definer set search_path = public, pg_temp, extensions as $$
declare v_class public.classes%rowtype;
begin
  select * into v_class from public.classes where join_code=upper(trim(p_join_code));
  if not found or v_class.teacher_pin_hash<>extensions.crypt(p_pin,v_class.teacher_pin_hash) then raise exception '班別代碼或老師 PIN 不正確'; end if;
  perform public._advance_round(v_class.id,true);
  return json_build_object('ok',true);
end $$;

create or replace function public.complete_round(p_join_code text, p_pin text)
returns json language plpgsql security definer set search_path = public, pg_temp, extensions as $$
declare v_class public.classes%rowtype;
begin
  select * into v_class from public.classes where join_code=upper(trim(p_join_code));
  if not found or v_class.teacher_pin_hash<>extensions.crypt(p_pin,v_class.teacher_pin_hash) then raise exception '班別代碼或老師 PIN 不正確'; end if;
  update public.rounds set status='complete' where id=v_class.current_round_id and status='reviewing';
  return json_build_object('ok',true);
end $$;

-- 只開放必要的 RPC；學生不能自行查閱或修改資料表。
grant execute on function public.create_class(text,text,text,integer) to anon,authenticated;
grant execute on function public.join_class(text,text,text) to anon,authenticated;
grant execute on function public.get_student_state(text) to anon,authenticated;
grant execute on function public.submit_artwork(text,text,text) to anon,authenticated;
grant execute on function public.submit_review(text,text,text) to anon,authenticated;
grant execute on function public.get_teacher_state(text,text) to anon,authenticated;
grant execute on function public.start_round(text,text,integer) to anon,authenticated;
grant execute on function public.close_submissions(text,text) to anon,authenticated;
grant execute on function public.complete_round(text,text) to anon,authenticated;

-- 作品圖片儲存桶。圖片以隨機路徑保存，不應上載敏感個人資料。
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('artworks','artworks',true,10485760,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists "artworks_public_read" on storage.objects;
create policy "artworks_public_read" on storage.objects for select to public using(bucket_id='artworks');
drop policy if exists "artworks_class_upload" on storage.objects;
create policy "artworks_class_upload" on storage.objects for insert to anon,authenticated
with check(bucket_id='artworks' and (storage.foldername(name))[1] is not null);

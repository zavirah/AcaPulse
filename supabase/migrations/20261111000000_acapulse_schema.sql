create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  role text not null default 'student' check (role in ('student', 'lecturer', 'administrator')),
  requested_role text not null default 'student' check (requested_role in ('student', 'lecturer')),
  access_status text not null default 'active' check (access_status in ('active', 'pending')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.courses (
  id uuid primary key default extensions.gen_random_uuid(),
  code text not null,
  title text not null,
  term text not null default '',
  lecturer_id uuid not null references public.profiles (user_id),
  enrollment_code text not null unique default upper(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 12)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lecturer_id, code, term)
);

create table public.course_enrollments (
  course_id uuid not null references public.courses (id) on delete cascade,
  student_id uuid not null references public.profiles (user_id) on delete cascade,
  join_code text,
  enrolled_at timestamptz not null default now(),
  primary key (course_id, student_id)
);

create table public.assessments (
  id uuid primary key default extensions.gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  title text not null,
  max_score numeric(8,2) not null check (max_score > 0),
  weight_percent numeric(5,2) not null check (weight_percent > 0 and weight_percent <= 100),
  due_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.grades (
  id uuid primary key default extensions.gen_random_uuid(),
  assessment_id uuid not null references public.assessments (id) on delete cascade,
  student_id uuid not null references public.profiles (user_id) on delete cascade,
  score numeric(8,2) not null check (score >= 0),
  feedback text not null default '',
  recorded_by uuid not null references public.profiles (user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assessment_id, student_id)
);

create index courses_lecturer_id_idx on public.courses (lecturer_id);
create index enrollments_student_id_idx on public.course_enrollments (student_id);
create index assessments_course_id_idx on public.assessments (course_id);
create index grades_student_id_idx on public.grades (student_id);
create index grades_assessment_id_idx on public.grades (assessment_id);

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested text := case
    when new.raw_user_meta_data ->> 'requested_role' = 'lecturer' then 'lecturer'
    else 'student'
  end;
begin
  insert into public.profiles (user_id, full_name, role, requested_role, access_status)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(coalesce(new.email, ''), '@', 1)),
    'student',
    requested,
    case when requested = 'lecturer' then 'pending' else 'active' end
  );
  return new;
end;
$$;
revoke all on function private.handle_new_user() from public, anon, authenticated;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.touch_updated_at() from public, anon, authenticated;
create trigger profiles_touch_updated_at before update on public.profiles for each row execute function private.touch_updated_at();
create trigger courses_touch_updated_at before update on public.courses for each row execute function private.touch_updated_at();
create trigger assessments_touch_updated_at before update on public.assessments for each row execute function private.touch_updated_at();
create trigger grades_touch_updated_at before update on public.grades for each row execute function private.touch_updated_at();

create or replace function private.is_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = (select auth.uid()) and p.role = 'administrator' and p.access_status = 'active'
  );
$$;

create or replace function private.has_active_role(expected_role text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = (select auth.uid()) and p.role = expected_role and p.access_status = 'active'
  );
$$;

create or replace function private.can_manage_course(target_course_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select private.is_admin() or (
    private.has_active_role('lecturer') and exists (
      select 1 from public.courses c
      where c.id = target_course_id and c.lecturer_id = (select auth.uid())
    )
  );
$$;

create or replace function private.can_access_course(target_course_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select private.is_admin() or exists (
    select 1 from public.courses c
    where c.id = target_course_id and (
      (c.lecturer_id = (select auth.uid()) and private.has_active_role('lecturer'))
      or exists (
        select 1 from public.course_enrollments e
        where e.course_id = c.id and e.student_id = (select auth.uid())
          and private.has_active_role('student')
      )
    )
  );
$$;

create or replace function private.can_enroll_with_code(target_course_id uuid, submitted_code text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select private.has_active_role('student') and exists (
    select 1 from public.courses c
    where c.id = target_course_id and c.enrollment_code = upper(trim(coalesce(submitted_code, '')))
  );
$$;

create or replace function private.can_manage_assessment(target_assessment_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.assessments a
    where a.id = target_assessment_id and private.can_manage_course(a.course_id)
  );
$$;

create or replace function private.check_grade_bounds()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  max_allowed numeric;
  target_course uuid;
begin
  select a.max_score, a.course_id into max_allowed, target_course
  from public.assessments a where a.id = new.assessment_id;
  if max_allowed is null then
    raise exception 'Assessment does not exist';
  end if;
  if new.score > max_allowed then
    raise exception 'Score cannot exceed the assessment maximum (%)', max_allowed;
  end if;
  if not private.is_admin() and not private.can_manage_course(target_course) then
    raise exception 'Only the assigned lecturer can record this grade';
  end if;
  if not exists (
    select 1 from public.course_enrollments e
    where e.course_id = target_course and e.student_id = new.student_id
  ) then
    raise exception 'Student is not enrolled in this course';
  end if;
  new.recorded_by := (select auth.uid());
  return new;
end;
$$;
revoke all on function private.check_grade_bounds() from public, anon, authenticated;
create trigger grades_check_bounds before insert or update on public.grades for each row execute function private.check_grade_bounds();

revoke all on function private.is_admin() from public, anon;
revoke all on function private.has_active_role(text) from public, anon;
revoke all on function private.can_manage_course(uuid) from public, anon;
revoke all on function private.can_access_course(uuid) from public, anon;
revoke all on function private.can_enroll_with_code(uuid, text) from public, anon;
revoke all on function private.can_manage_assessment(uuid) from public, anon;
grant execute on function private.is_admin() to authenticated;
grant execute on function private.has_active_role(text) to authenticated;
grant execute on function private.can_manage_course(uuid) to authenticated;
grant execute on function private.can_access_course(uuid) to authenticated;
grant execute on function private.can_enroll_with_code(uuid, text) to authenticated;
grant execute on function private.can_manage_assessment(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.courses enable row level security;
alter table public.course_enrollments enable row level security;
alter table public.assessments enable row level security;
alter table public.grades enable row level security;

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;
grant update (role, access_status) on public.profiles to authenticated;
create policy profiles_read_own_or_admin on public.profiles for select to authenticated
  using (user_id = (select auth.uid()) or private.is_admin());
create policy profiles_update_own_name on public.profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy profiles_admin_manage_roles on public.profiles for update to authenticated
  using (private.is_admin()) with check (private.is_admin());

create or replace function private.prevent_profile_privilege_escalation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.role is distinct from old.role or new.access_status is distinct from old.access_status)
     and (select auth.uid()) is not null and not private.is_admin() then
    raise exception 'Only an administrator can change account roles or access status';
  end if;
  return new;
end;
$$;
revoke all on function private.prevent_profile_privilege_escalation() from public, anon, authenticated;
create trigger profiles_prevent_role_escalation before update on public.profiles
  for each row execute function private.prevent_profile_privilege_escalation();

revoke all on public.courses from anon, authenticated;
grant select, insert, update, delete on public.courses to authenticated;
create policy courses_read_accessible on public.courses for select to authenticated
  using (private.can_access_course(id));
create policy courses_insert_lecturer_or_admin on public.courses for insert to authenticated
  with check (
    private.is_admin() or
    (lecturer_id = (select auth.uid()) and private.has_active_role('lecturer'))
  );
create policy courses_update_manager on public.courses for update to authenticated
  using (private.can_manage_course(id)) with check (private.can_manage_course(id));
create policy courses_delete_manager on public.courses for delete to authenticated
  using (private.can_manage_course(id));

revoke all on public.course_enrollments from anon, authenticated;
grant select, insert, delete on public.course_enrollments to authenticated;
create policy enrollments_read_self_or_course_manager on public.course_enrollments for select to authenticated
  using (student_id = (select auth.uid()) or private.can_manage_course(course_id) or private.is_admin());
create policy enrollments_insert_self_by_code_or_manager on public.course_enrollments for insert to authenticated
  with check (
    (student_id = (select auth.uid()) and private.can_enroll_with_code(course_id, join_code))
    or private.can_manage_course(course_id)
  );
create policy enrollments_delete_self_or_manager on public.course_enrollments for delete to authenticated
  using (student_id = (select auth.uid()) or private.can_manage_course(course_id) or private.is_admin());

revoke all on public.assessments from anon, authenticated;
grant select, insert, update, delete on public.assessments to authenticated;
create policy assessments_read_accessible on public.assessments for select to authenticated
  using (private.can_access_course(course_id));
create policy assessments_insert_manager on public.assessments for insert to authenticated
  with check (private.can_manage_course(course_id));
create policy assessments_update_manager on public.assessments for update to authenticated
  using (private.can_manage_course(course_id)) with check (private.can_manage_course(course_id));
create policy assessments_delete_manager on public.assessments for delete to authenticated
  using (private.can_manage_course(course_id));

revoke all on public.grades from anon, authenticated;
grant select, insert, update, delete on public.grades to authenticated;
create policy grades_read_self_or_manager on public.grades for select to authenticated
  using (student_id = (select auth.uid()) or private.can_manage_assessment(assessment_id) or private.is_admin());
create policy grades_insert_manager on public.grades for insert to authenticated
  with check (private.can_manage_assessment(assessment_id));
create policy grades_update_manager on public.grades for update to authenticated
  using (private.can_manage_assessment(assessment_id)) with check (private.can_manage_assessment(assessment_id));
create policy grades_delete_manager on public.grades for delete to authenticated
  using (private.can_manage_assessment(assessment_id));

create or replace view public.course_performance
with (security_invoker = true)
as
select
  e.student_id,
  c.id as course_id,
  c.code,
  c.title,
  coalesce(100 * sum((g.score / nullif(a.max_score, 0)) * a.weight_percent)
    filter (where g.id is not null) /
    nullif(sum(a.weight_percent) filter (where g.id is not null), 0), 0) as current_percent,
  coalesce(sum(a.weight_percent) filter (where g.id is not null), 0) as completed_weight_percent
from public.course_enrollments e
join public.courses c on c.id = e.course_id
left join public.assessments a on a.course_id = c.id
left join public.grades g on g.assessment_id = a.id and g.student_id = e.student_id
group by e.student_id, c.id, c.code, c.title;
revoke all on public.course_performance from anon, authenticated;
grant select on public.course_performance to authenticated;

create or replace function private.can_read_profile(target_user_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select target_user_id = (select auth.uid()) or private.is_admin() or exists (
    select 1
    from public.course_enrollments e
    join public.courses c on c.id = e.course_id
    where e.student_id = target_user_id
      and c.lecturer_id = (select auth.uid())
      and private.has_active_role('lecturer')
  );
$$;
revoke all on function private.can_read_profile(uuid) from public, anon;
grant execute on function private.can_read_profile(uuid) to authenticated;
create policy profiles_read_students_in_lecturer_courses on public.profiles for select to authenticated
  using (private.can_read_profile(user_id));

create or replace function private.check_assessment_weight_total()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  other_weight numeric;
begin
  select coalesce(sum(a.weight_percent), 0) into other_weight
  from public.assessments a
  where a.course_id = new.course_id and a.id <> new.id;
  if other_weight + new.weight_percent > 100 then
    raise exception 'Assessment weights for a course cannot exceed 100%%';
  end if;
  return new;
end;
$$;
revoke all on function private.check_assessment_weight_total() from public, anon, authenticated;
create trigger assessments_check_weight_total before insert or update on public.assessments
  for each row execute function private.check_assessment_weight_total();

create or replace function public.join_course_by_code(p_code text)
returns table(course_id uuid, course_code text, course_title text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  found_course public.courses%rowtype;
  normalized_code text := upper(trim(coalesce(p_code, '')));
begin
  if (select auth.uid()) is null or not private.has_active_role('student') then
    raise exception 'An active student account is required to join a course';
  end if;
  select c.* into found_course
  from public.courses c
  where c.enrollment_code = normalized_code;
  if not found then
    raise exception 'That class code was not found';
  end if;
  insert into public.course_enrollments (course_id, student_id, join_code)
  values (found_course.id, (select auth.uid()), normalized_code)
  on conflict (course_id, student_id) do nothing;
  return query select found_course.id, found_course.code, found_course.title;
end;
$$;
revoke all on function public.join_course_by_code(text) from public, anon;
grant execute on function public.join_course_by_code(text) to authenticated;

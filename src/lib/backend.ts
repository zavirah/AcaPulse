import type { Session } from '@supabase/supabase-js';

import { requireSupabase } from './supabase';

export type AppRole = 'student' | 'lecturer' | 'administrator';
export type RequestedRole = 'student' | 'lecturer';
export type AccessStatus = 'active' | 'pending';

export type Profile = {
  user_id: string;
  full_name: string;
  role: AppRole;
  requested_role: RequestedRole;
  access_status: AccessStatus;
};

export type Course = {
  id: string;
  code: string;
  title: string;
  term: string;
  lecturer_id: string;
  enrollment_code?: string;
};

export type CoursePerformance = {
  course_id: string;
  code: string;
  title: string;
  current_percent: number;
  completed_weight_percent: number;
};

export type Assessment = {
  id: string;
  course_id: string;
  title: string;
  max_score: number;
  weight_percent: number;
  due_date: string | null;
};

export type RosterStudent = { user_id: string; full_name: string };
export type Grade = { id: string; assessment_id: string; student_id: string; score: number; feedback: string };
export type StudentResult = {
  course_id: string;
  course_code: string;
  course_title: string;
  assessment_id: string;
  assessment_title: string;
  max_score: number;
  weight_percent: number;
  due_date: string | null;
  score: number | null;
  feedback: string;
};

export function passwordStrengthError(password: string): string | null {
  if (password.length < 10) return 'Use at least 10 characters.';
  if (!/[A-Z]/.test(password)) return 'Add at least one uppercase letter.';
  if (!/[a-z]/.test(password)) return 'Add at least one lowercase letter.';
  if (!/\d/.test(password)) return 'Add at least one number.';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Add at least one symbol, such as ! or @.';
  return null;
}

export async function signUpWithPassword(input: {
  email: string;
  password: string;
  fullName: string;
  requestedRole: RequestedRole;
}) {
  const weakPassword = passwordStrengthError(input.password);
  if (weakPassword) throw new Error(weakPassword);
  const { data, error } = await requireSupabase().auth.signUp({
    email: input.email.trim().toLowerCase(),
    password: input.password,
    options: {
      data: {
        full_name: input.fullName.trim(),
        requested_role: input.requestedRole,
      },
    },
  });
  if (error) throw error;
  return data;
}

export async function signInWithPassword(email: string, password: string) {
  const { data, error } = await requireSupabase().auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) throw error;
  return data.session;
}

export async function resendSignupCode(email: string) {
  const { error } = await requireSupabase().auth.resend({
    type: 'signup',
    email: email.trim().toLowerCase(),
  });
  if (error) throw error;
}

export async function requestPasswordReset(email: string) {
  const { error } = await requireSupabase().auth.resetPasswordForEmail(email.trim().toLowerCase());
  if (error) throw error;
}

export async function verifyEmailCode(email: string, token: string, intent: 'signup' | 'recovery' = 'signup') {
  const { data, error } = await requireSupabase().auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token: token.trim(),
    type: intent === 'recovery' ? 'recovery' : 'email',
  });
  if (error) throw error;
  if (!data.session) throw new Error('The code was accepted but no session was returned. Please try signing in again.');
  return data.session;
}

export async function updatePassword(password: string) {
  const weakPassword = passwordStrengthError(password);
  if (weakPassword) throw new Error(weakPassword);
  const { error } = await requireSupabase().auth.updateUser({ password });
  if (error) throw error;
}

export async function getProfile(userId: string): Promise<Profile> {
  const { data, error } = await requireSupabase()
    .from('profiles')
    .select('user_id, full_name, role, requested_role, access_status')
    .eq('user_id', userId)
    .single();
  if (error) throw error;
  return data as Profile;
}

export async function signOut() {
  const { error } = await requireSupabase().auth.signOut();
  if (error) throw error;
}

export async function listStudentPerformance(userId: string): Promise<CoursePerformance[]> {
  const { data, error } = await requireSupabase()
    .from('course_performance')
    .select('course_id, code, title, current_percent, completed_weight_percent')
    .eq('student_id', userId)
    .order('title');
  if (error) throw error;
  return (data ?? []) as CoursePerformance[];
}

export async function listStudentResults(userId: string): Promise<StudentResult[]> {
  const client = requireSupabase();
  const { data: enrollments, error: enrollmentError } = await client
    .from('course_enrollments')
    .select('course_id')
    .eq('student_id', userId);
  if (enrollmentError) throw enrollmentError;
  const courseIds = (enrollments ?? []).map((row) => row.course_id);
  if (!courseIds.length) return [];

  const [{ data: courses, error: courseError }, { data: assessments, error: assessmentError }] = await Promise.all([
    client.from('courses').select('id, code, title').in('id', courseIds),
    client.from('assessments').select('id, course_id, title, max_score, weight_percent, due_date').in('course_id', courseIds).order('due_date'),
  ]);
  if (courseError) throw courseError;
  if (assessmentError) throw assessmentError;
  const assessmentRows = assessments ?? [];
  if (!assessmentRows.length) return [];

  const { data: grades, error: gradeError } = await client
    .from('grades')
    .select('assessment_id, score, feedback')
    .eq('student_id', userId)
    .in('assessment_id', assessmentRows.map((assessment) => assessment.id));
  if (gradeError) throw gradeError;

  const courseById = new Map((courses ?? []).map((course) => [course.id, course]));
  const gradeByAssessmentId = new Map((grades ?? []).map((grade) => [grade.assessment_id, grade]));
  return assessmentRows.flatMap((assessment) => {
    const course = courseById.get(assessment.course_id);
    if (!course) return [];
    const grade = gradeByAssessmentId.get(assessment.id);
    return [{
      course_id: course.id,
      course_code: course.code,
      course_title: course.title,
      assessment_id: assessment.id,
      assessment_title: assessment.title,
      max_score: Number(assessment.max_score),
      weight_percent: Number(assessment.weight_percent),
      due_date: assessment.due_date,
      score: grade ? Number(grade.score) : null,
      feedback: grade?.feedback ?? '',
    }];
  });
}

export async function listLecturerCourses(userId: string): Promise<Course[]> {
  const { data, error } = await requireSupabase()
    .from('courses')
    .select('id, code, title, term, lecturer_id, enrollment_code')
    .eq('lecturer_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Course[];
}

export async function listAdminProfiles(): Promise<Profile[]> {
  const { data, error } = await requireSupabase()
    .from('profiles')
    .select('user_id, full_name, role, requested_role, access_status')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Profile[];
}

export async function listAdminCourses(): Promise<Course[]> {
  const { data, error } = await requireSupabase()
    .from('courses')
    .select('id, code, title, term, lecturer_id')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Course[];
}

export async function approveLecturer(userId: string) {
  const { error } = await requireSupabase()
    .from('profiles')
    .update({ role: 'lecturer', access_status: 'active' })
    .eq('user_id', userId);
  if (error) throw error;
}

export async function createCourse(input: {
  code: string;
  title: string;
  term: string;
  lecturerId: string;
}) {
  const { data, error } = await requireSupabase()
    .from('courses')
    .insert({
      code: input.code.trim().toUpperCase(),
      title: input.title.trim(),
      term: input.term.trim(),
      lecturer_id: input.lecturerId,
    })
    .select('id, code, title, term, lecturer_id, enrollment_code')
    .single();
  if (error) throw error;
  return data as Course;
}

export async function joinCourseByCode(code: string) {
  const { error } = await requireSupabase().rpc('join_course_by_code', { p_code: code.trim() });
  if (error) throw error;
}

export async function listAssessments(courseId: string): Promise<Assessment[]> {
  const { data, error } = await requireSupabase()
    .from('assessments')
    .select('id, course_id, title, max_score, weight_percent, due_date')
    .eq('course_id', courseId)
    .order('due_date');
  if (error) throw error;
  return (data ?? []) as Assessment[];
}

export async function createAssessment(input: {
  courseId: string;
  title: string;
  maxScore: number;
  weightPercent: number;
  dueDate?: string;
}) {
  const { error } = await requireSupabase().from('assessments').insert({
    course_id: input.courseId,
    title: input.title.trim(),
    max_score: input.maxScore,
    weight_percent: input.weightPercent,
    due_date: input.dueDate || null,
  });
  if (error) throw error;
}

export async function listRoster(courseId: string): Promise<RosterStudent[]> {
  const client = requireSupabase();
  const { data: enrollments, error: enrollmentError } = await client
    .from('course_enrollments')
    .select('student_id')
    .eq('course_id', courseId);
  if (enrollmentError) throw enrollmentError;
  const ids = (enrollments ?? []).map((row) => row.student_id);
  if (!ids.length) return [];
  const { data, error } = await client
    .from('profiles')
    .select('user_id, full_name')
    .in('user_id', ids)
    .order('full_name');
  if (error) throw error;
  return (data ?? []) as RosterStudent[];
}

export async function listCourseGrades(courseId: string): Promise<Grade[]> {
  const client = requireSupabase();
  const { data: assessments, error: assessmentError } = await client
    .from('assessments')
    .select('id')
    .eq('course_id', courseId);
  if (assessmentError) throw assessmentError;
  const ids = (assessments ?? []).map((row) => row.id);
  if (!ids.length) return [];
  const { data, error } = await client
    .from('grades')
    .select('id, assessment_id, student_id, score, feedback')
    .in('assessment_id', ids);
  if (error) throw error;
  return (data ?? []) as Grade[];
}

export async function saveGrade(input: {
  assessmentId: string;
  studentId: string;
  score: number;
  feedback: string;
  lecturerId: string;
}) {
  const { error } = await requireSupabase().from('grades').upsert({
    assessment_id: input.assessmentId,
    student_id: input.studentId,
    score: input.score,
    feedback: input.feedback,
    recorded_by: input.lecturerId,
  }, { onConflict: 'assessment_id,student_id' });
  if (error) throw error;
}

export function sessionUser(session: Session | null) {
  return session?.user ?? null;
}

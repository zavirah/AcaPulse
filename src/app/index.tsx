import {
  approveLecturer,
  createAssessment,
  createCourse,
  getProfile,
  joinCourseByCode,
  listAdminCourses,
  listAdminProfiles,
  listAssessments,
  listCourseGrades,
  listLecturerCourses,
  listRoster,
  listStudentPerformance,
  listStudentResults,
  requestPasswordReset,
  resendSignupCode,
  saveGrade,
  signInWithPassword,
  signOut,
  signUpWithPassword,
  updatePassword,
  verifyEmailCode,
  type AppRole,
  type Assessment,
  type Course,
  type CoursePerformance,
  type Grade,
  type Profile,
  type RosterStudent,
  type StudentResult,
} from "@/lib/backend";
import { supabase, supabaseConfigured } from "@/lib/supabase";
import type { Session } from "@supabase/supabase-js";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

type Screen =
  | "welcome"
  | "login"
  | "signup"
  | "verify"
  | "forgot"
  | "reset"
  | "home";
type RoleChoice = "student" | "lecturer" | "administrator";
const colors = {
  bg: "#180D2A",
  panel: "#241344",
  violet: "#7045B5",
  lavender: "#D7C5F7",
  pale: "#F5F0FF",
  white: "#FFFFFF",
  muted: "#B9ADC9",
  line: "rgba(255,255,255,0.16)",
};
const passwordChecks = [
  { label: "10 characters minimum", test: (v: string) => v.length >= 10 },
  {
    label: "Uppercase and lowercase letters",
    test: (v: string) => /[A-Z]/.test(v) && /[a-z]/.test(v),
  },
  { label: "At least one number", test: (v: string) => /\d/.test(v) },
  { label: "At least one symbol", test: (v: string) => /[^A-Za-z0-9]/.test(v) },
];

export default function Index() {
  const [screen, setScreen] = useState<Screen>("welcome");
  const [choice, setChoice] = useState<RoleChoice>("student");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [code, setCode] = useState("");
  const [recoveryVerified, setRecoveryVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const recoveryFlow = useRef(false);
  const [performances, setPerformances] = useState<CoursePerformance[]>([]);
  const [studentResults, setStudentResults] = useState<StudentResult[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [people, setPeople] = useState<Profile[]>([]);
  const [courseCode, setCourseCode] = useState("");
  const [courseTitle, setCourseTitle] = useState("");
  const [term, setTerm] = useState("");
  const [courseLecturerId, setCourseLecturerId] = useState("");

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth
      .getSession()
      .then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, current) => setSession(current),
    );
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let live = true;
    async function loadWorkspace() {
      if (!session?.user) {
        setProfile(null);
        return;
      }
      if (recoveryFlow.current) {
        recoveryFlow.current = true;
        setEmail(session.user.email ?? "");
        setScreen("reset");
        setRecoveryVerified(true);
        return;
      }
      try {
        const nextProfile = await getProfile(session.user.id);
        if (!live) return;
        setProfile(nextProfile);
        if (nextProfile.access_status !== "active") {
          setScreen("home");
          return;
        }
        if (nextProfile.role === "student") {
          const [nextPerformance, nextResults] = await Promise.all([
            listStudentPerformance(session.user.id),
            listStudentResults(session.user.id),
          ]);
          if (live) {
            setPerformances(nextPerformance);
            setStudentResults(nextResults);
          }
        }
        if (nextProfile.role === "lecturer")
          setCourses(await listLecturerCourses(session.user.id));
        if (nextProfile.role === "administrator") {
          const [nextPeople, nextCourses] = await Promise.all([
            listAdminProfiles(),
            listAdminCourses(),
          ]);
          if (live) {
            setPeople(nextPeople);
            setCourses(nextCourses);
            setCourseLecturerId((current) =>
              nextPeople.some(
                (person) =>
                  person.user_id === current &&
                  person.role === "lecturer" &&
                  person.access_status === "active",
              )
                ? current
                : (nextPeople.find(
                    (person) =>
                      person.role === "lecturer" &&
                      person.access_status === "active",
                  )?.user_id ?? ""),
            );
          }
        }
        if (live) setScreen("home");
      } catch (e) {
        if (live) setError(message(e));
      }
    }
    void loadWorkspace();
    return () => {
      live = false;
    };
  }, [session]);

  function validEmail() {
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Enter a valid email address.");
      return false;
    }
    return true;
  }
  function validPasswordPair() {
    const failed = passwordChecks.find((rule) => !rule.test(password));
    if (failed) {
      setError(`Your password needs: ${failed.label.toLowerCase()}.`);
      return false;
    }
    if (password !== confirmPassword) {
      setError("Your passwords do not match.");
      return false;
    }
    return true;
  }
  async function createAccount() {
    setError("");
    setSuccess("");
    if (!validEmail()) return;
    if (!name.trim()) {
      setError("Enter your full name.");
      return;
    }
    if (choice === "administrator") {
      setError(
        "Administrator accounts are assigned by your institution. Choose Student or Lecturer to request access.",
      );
      return;
    }
    if (!validPasswordPair()) return;
    setBusy(true);
    try {
      const data = await signUpWithPassword({
        email,
        password,
        fullName: name,
        requestedRole: choice === "lecturer" ? "lecturer" : "student",
      });
      if (data.session) {
        await signOut();
        throw new Error(
          "Email confirmation is turned off in Supabase. Enable Confirm email so AcaPulse can verify new accounts.",
        );
      }
      setCode("");
      setScreen("verify");
      setSuccess(
        `We sent a six-digit confirmation code to ${email.trim().toLowerCase()}.`,
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function resendSignup() {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await resendSignupCode(email);
      setSuccess("A fresh verification code is on its way.");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function confirmSignupCode() {
    setError("");
    setSuccess("");
    if (!/^\d{6}$/.test(code.trim())) {
      setError("Enter the six-digit code from your email.");
      return;
    }
    setBusy(true);
    try {
      const nextSession = await verifyEmailCode(email, code, "signup");
      setSession(nextSession);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function login() {
    setError("");
    setSuccess("");
    if (!validEmail()) return;
    if (!password) {
      setError("Enter your password.");
      return;
    }
    setBusy(true);
    try {
      const nextSession = await signInWithPassword(email, password);
      if (!nextSession)
        throw new Error("Sign-in did not return a session. Please try again.");
      setSession(nextSession);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function sendResetCode() {
    setError("");
    setSuccess("");
    if (!validEmail()) return;
    setBusy(true);
    try {
      await requestPasswordReset(email);
      setCode("");
      setRecoveryVerified(false);
      setScreen("reset");
      setSuccess(
        `We sent a six-digit reset code to ${email.trim().toLowerCase()}.`,
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function verifyRecoveryCode() {
    setError("");
    setSuccess("");
    if (!/^\d{6}$/.test(code.trim())) {
      setError("Enter the six-digit code from your email.");
      return;
    }
    setBusy(true);
    recoveryFlow.current = true;
    try {
      const nextSession = await verifyEmailCode(email, code, "recovery");
      setSession(nextSession);
      setRecoveryVerified(true);
      setSuccess("Code verified. Choose your new password.");
    } catch (e) {
      recoveryFlow.current = false;
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function cancelRecovery() {
    setError("");
    setSuccess("");
    const hadRecoverySession = recoveryFlow.current;
    setBusy(true);
    try {
      if (hadRecoverySession) await signOut();
      recoveryFlow.current = false;
      setSession(null);
      setProfile(null);
      setRecoveryVerified(false);
      setScreen("login");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function finishPasswordReset() {
    setError("");
    setSuccess("");
    if (!recoveryVerified) {
      setError("Verify the recovery code first.");
      return;
    }
    if (!validPasswordPair()) return;
    setBusy(true);
    try {
      await updatePassword(password);
      recoveryFlow.current = false;
      await signOut();
      setSession(null);
      setProfile(null);
      setPassword("");
      setConfirmPassword("");
      setRecoveryVerified(false);
      setScreen("login");
      setSuccess(
        "Your password has been updated. Sign in with the new password.",
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function leave() {
    setBusy(true);
    try {
      await signOut();
      setScreen("welcome");
      setEmail("");
      setName("");
      setPassword("");
      setConfirmPassword("");
      setProfile(null);
      setStudentResults([]);
      setPerformances([]);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function joinCourse() {
    setBusy(true);
    setError("");
    try {
      await joinCourseByCode(courseCode);
      setCourseCode("");
      if (session) {
        const [nextPerformance, nextResults] = await Promise.all([
          listStudentPerformance(session.user.id),
          listStudentResults(session.user.id),
        ]);
        setPerformances(nextPerformance);
        setStudentResults(nextResults);
      }
      Alert.alert("Course joined", "Your course has been added.");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function addCourse() {
    if (!session) return;
    const isAdministrator = profile?.role === "administrator";
    const approvedLecturers = people.filter(
      (person) =>
        person.role === "lecturer" && person.access_status === "active",
    );
    const lecturerId = isAdministrator ? courseLecturerId : session.user.id;
    if (
      isAdministrator &&
      !approvedLecturers.some((person) => person.user_id === lecturerId)
    ) {
      setError("Choose an approved lecturer to assign this course to.");
      return;
    }
    if (!courseCode.trim() || !courseTitle.trim() || !term.trim()) {
      setError("Enter a course code, course title, and term before creating the course.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const course = await createCourse({
        code: courseCode,
        title: courseTitle,
        term,
        lecturerId,
      });
      setCourses((old) => [course, ...old]);
      setCourseCode("");
      setCourseTitle("");
      setTerm("");
      const assignedLecturer = approvedLecturers.find(
        (person) => person.user_id === lecturerId,
      );
      Alert.alert(
        "Course created",
        `${isAdministrator && assignedLecturer ? `Assigned to ${assignedLecturer.full_name}. ` : ""}Share this class code with students: ${course.enrollment_code}`,
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function approve(userId: string) {
    setBusy(true);
    setError("");
    try {
      await approveLecturer(userId);
      setPeople(await listAdminProfiles());
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={s.screen}>
      <StatusBar style="light" />
      <View pointerEvents="none" style={s.glow} />
      <SafeAreaView style={s.safe}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            contentContainerStyle={s.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Brand />
            {screen === "welcome" && (
              <>
                <View style={s.hero}>
                  <Text style={s.overline}>ACADEMIC INTELLIGENCE</Text>
                  <Text style={s.heroTitle}>
                    Your potential.{"\n"}
                    <Text style={{ color: colors.lavender }}>
                      Our intelligence.
                    </Text>
                  </Text>
                  <Text style={s.sub}>
                    Understand your progress, discover what’s possible, and make
                    smarter academic decisions.
                  </Text>
                  <View style={s.preview}>
                    <Text style={s.cardTag}>ACADEMIC MOMENTUM</Text>
                    <Text style={s.previewTitle}>
                      Your progress, made clearer
                    </Text>
                    <View style={s.bars}>
                      {[34, 48, 42, 62, 56, 78, 70, 100].map((h, i) => (
                        <View key={i} style={s.barTrack}>
                          <View
                            style={[
                              s.bar,
                              {
                                height: `${h}%`,
                                backgroundColor:
                                  i === 7 ? "#E5D8FF" : "rgba(211,194,248,.62)",
                              },
                            ]}
                          />
                        </View>
                      ))}
                    </View>
                    <Text style={s.cardFoot}>
                      A confident next step starts with a clearer picture.
                    </Text>
                  </View>
                </View>
                <Button
                  title="Get started"
                  onPress={() => {
                    setError("");
                    setSuccess("");
                    setScreen("signup");
                  }}
                />
                <Pressable
                  style={s.link}
                  onPress={() => {
                    setError("");
                    setSuccess("");
                    setScreen("login");
                  }}
                >
                  <Text style={s.muted}>
                    Already have an account? <Text style={s.bold}>Sign in</Text>
                  </Text>
                </Pressable>
              </>
            )}
            {screen === "signup" && (
              <View style={s.panel}>
                <Back
                  onPress={() => {
                    setError("");
                    setScreen("welcome");
                  }}
                />
                <Text style={s.eyebrow}>CREATE YOUR ACCOUNT</Text>
                <Text style={s.title}>Your next chapter starts here.</Text>
                <Text style={s.sub}>
                  Set a strong password, then confirm your email with a one-time
                  code.
                </Text>
                <Field
                  label="FULL NAME"
                  value={name}
                  onChangeText={setName}
                  placeholder="Your full name"
                  autoCapitalize="words"
                />
                <Field
                  label="EMAIL ADDRESS"
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@example.com"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Text style={s.label}>I AM A</Text>
                <View style={s.roles}>
                  {(
                    ["student", "lecturer", "administrator"] as RoleChoice[]
                  ).map((r) => (
                    <Pressable
                      key={r}
                      onPress={() => setChoice(r)}
                      style={[s.role, choice === r && s.roleOn]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: choice === r }}
                    >
                      <Text style={[s.roleTxt, choice === r && s.roleTxtOn]}>
                        {cap(r)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                {choice === "lecturer" && (
                  <Text style={s.hint}>
                    Lecturer access is reviewed by an administrator after email
                    verification.
                  </Text>
                )}
                {choice === "administrator" && (
                  <Text style={s.hint}>
                    Administrator accounts are assigned by your institution.
                  </Text>
                )}
                <PasswordInput
                  label="PASSWORD"
                  value={password}
                  onChangeText={setPassword}
                  visible={showPassword}
                  onToggle={() => setShowPassword((v) => !v)}
                  autoComplete="new-password"
                />
                <PasswordRules password={password} />
                <PasswordInput
                  label="CONFIRM PASSWORD"
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  visible={showConfirmPassword}
                  onToggle={() => setShowConfirmPassword((v) => !v)}
                  autoComplete="new-password"
                />
                <Button
                  title={
                    busy ? "Creating account…" : "Create account and send code"
                  }
                  onPress={() => void createAccount()}
                  disabled={busy}
                />
                <SwitchLink
                  text="Already registered? Sign in"
                  onPress={() => {
                    setError("");
                    setSuccess("");
                    setScreen("login");
                  }}
                />
              </View>
            )}
            {screen === "login" && (
              <View style={s.panel}>
                <Back
                  onPress={() => {
                    setError("");
                    setScreen("welcome");
                  }}
                />
                <Text style={s.eyebrow}>WELCOME BACK</Text>
                <Text style={s.title}>Good to see you again.</Text>
                <Text style={s.sub}>
                  Sign in securely with your email and password.
                </Text>
                <Field
                  label="EMAIL ADDRESS"
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@example.com"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                />
                <PasswordInput
                  label="PASSWORD"
                  value={password}
                  onChangeText={setPassword}
                  visible={showPassword}
                  onToggle={() => setShowPassword((v) => !v)}
                  autoComplete="current-password"
                />
                <Pressable
                  onPress={() => {
                    setError("");
                    setSuccess("");
                    setScreen("forgot");
                  }}
                  style={s.forgotLink}
                >
                  <Text style={s.forgotText}>Forgot password?</Text>
                </Pressable>
                <Button
                  title={busy ? "Signing in…" : "Sign in"}
                  onPress={() => void login()}
                  disabled={busy}
                />
                <SwitchLink
                  text="New to AcaPulse? Create account"
                  onPress={() => {
                    setError("");
                    setSuccess("");
                    setScreen("signup");
                  }}
                />
              </View>
            )}
            {screen === "verify" && (
              <View style={s.panel}>
                <Back
                  onPress={() => {
                    setScreen("signup");
                    setCode("");
                  }}
                />
                <Text style={s.eyebrow}>CHECK YOUR INBOX</Text>
                <Text style={s.title}>Verify your email.</Text>
                <Text style={s.sub}>
                  Enter the six-digit code sent to {email.trim().toLowerCase()}{" "}
                  to activate your account.
                </Text>
                <Field
                  label="SIX-DIGIT CODE"
                  value={code}
                  onChangeText={(v) =>
                    setCode(v.replace(/\D/g, "").slice(0, 6))
                  }
                  placeholder="000000"
                  keyboardType="number-pad"
                  autoComplete="one-time-code"
                  maxLength={6}
                />
                <Button
                  title={busy ? "Verifying…" : "Verify email and continue"}
                  onPress={() => void confirmSignupCode()}
                  disabled={busy}
                />
                <Pressable style={s.link} onPress={() => void resendSignup()}>
                  <Text style={s.muted}>
                    Didn&apos;t receive it?{" "}
                    <Text style={s.bold}>Send another code</Text>
                  </Text>
                </Pressable>
              </View>
            )}
            {screen === "forgot" && (
              <View style={s.panel}>
                <Back onPress={() => setScreen("login")} />
                <Text style={s.eyebrow}>ACCOUNT RECOVERY</Text>
                <Text style={s.title}>Reset your password.</Text>
                <Text style={s.sub}>
                  We’ll send a one-time code to the email on your account.
                </Text>
                <Field
                  label="EMAIL ADDRESS"
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@example.com"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                />
                <Button
                  title={busy ? "Sending code…" : "Send reset code"}
                  onPress={() => void sendResetCode()}
                  disabled={busy}
                />
              </View>
            )}
            {screen === "reset" && (
              <View style={s.panel}>
                <Back onPress={() => void cancelRecovery()} />
                <Text style={s.eyebrow}>ACCOUNT RECOVERY</Text>
                <Text style={s.title}>
                  {recoveryVerified
                    ? "Choose a new password."
                    : "Enter your reset code."}
                </Text>
                <Text style={s.sub}>
                  {recoveryVerified
                    ? "Create a strong new password for your AcaPulse account."
                    : `We sent a six-digit code to ${email.trim().toLowerCase()}.`}
                </Text>
                {!recoveryVerified ? (
                  <>
                    <Field
                      label="SIX-DIGIT CODE"
                      value={code}
                      onChangeText={(v) =>
                        setCode(v.replace(/\D/g, "").slice(0, 6))
                      }
                      placeholder="000000"
                      keyboardType="number-pad"
                      autoComplete="one-time-code"
                      maxLength={6}
                    />
                    <Button
                      title={busy ? "Checking code…" : "Verify recovery code"}
                      onPress={() => void verifyRecoveryCode()}
                      disabled={busy}
                    />
                    <Pressable
                      style={s.link}
                      onPress={() => void sendResetCode()}
                    >
                      <Text style={s.muted}>
                        Didn&apos;t receive it?{" "}
                        <Text style={s.bold}>Send another code</Text>
                      </Text>
                    </Pressable>
                  </>
                ) : (
                  <>
                    <PasswordInput
                      label="NEW PASSWORD"
                      value={password}
                      onChangeText={setPassword}
                      visible={showPassword}
                      onToggle={() => setShowPassword((v) => !v)}
                      autoComplete="new-password"
                    />
                    <PasswordRules password={password} />
                    <PasswordInput
                      label="CONFIRM NEW PASSWORD"
                      value={confirmPassword}
                      onChangeText={setConfirmPassword}
                      visible={showConfirmPassword}
                      onToggle={() => setShowConfirmPassword((v) => !v)}
                      autoComplete="new-password"
                    />
                    <Button
                      title={busy ? "Updating password…" : "Save new password"}
                      onPress={() => void finishPasswordReset()}
                      disabled={busy}
                    />
                  </>
                )}
              </View>
            )}
            {screen === "home" && (
              <Home
                profile={profile}
                session={session}
                performances={performances}
                studentResults={studentResults}
                courses={courses}
                people={people}
                courseCode={courseCode}
                courseTitle={courseTitle}
                term={term}
                courseLecturerId={courseLecturerId}
                setCourseCode={setCourseCode}
                setCourseTitle={setCourseTitle}
                setTerm={setTerm}
                setCourseLecturerId={setCourseLecturerId}
                onJoin={() => void joinCourse()}
                onCreate={() => void addCourse()}
                onApprove={(id) => void approve(id)}
                onSignOut={() => void leave()}
                busy={busy}
              />
            )}
            {!!error && (
              <Text accessibilityRole="alert" style={s.error}>
                {error}
              </Text>
            )}
            {!!success && (
              <Text accessibilityRole="text" style={s.success}>
                {success}
              </Text>
            )}
            {!supabaseConfigured && (
              <View style={s.config}>
                <Text style={s.configTitle}>Connect your AcaPulse backend</Text>
                <Text style={s.hint}>
                  Add the Supabase project URL and publishable key to the
                  project’s .env file, then restart Expo. Account creation,
                  password sign-in, and email codes need those settings.
                </Text>
              </View>
            )}
            <Text style={s.footer}>PREDICT. IMPROVE. EXCEL.</Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
function Home(p: {
  profile: Profile | null;
  session: Session | null;
  performances: CoursePerformance[];
  studentResults: StudentResult[];
  courses: Course[];
  people: Profile[];
  courseCode: string;
  courseTitle: string;
  term: string;
  courseLecturerId: string;
  setCourseCode: (v: string) => void;
  setCourseTitle: (v: string) => void;
  setTerm: (v: string) => void;
  setCourseLecturerId: (v: string) => void;
  onJoin: () => void;
  onCreate: () => void;
  onApprove: (id: string) => void;
  onSignOut: () => void;
  busy: boolean;
}) {
  const profile = p.profile;
  const role: AppRole = profile?.role ?? "student";
  return (
    <View style={s.panel}>
      <Text style={s.eyebrow}>
        {profile?.access_status === "pending"
          ? "ACCESS REQUEST PENDING"
          : `${cap(role)} WORKSPACE`}
      </Text>
      <Text style={s.title}>
        Welcome,{" "}
        {profile?.full_name || p.session?.user.email?.split("@")[0] || "there"}.
      </Text>
      <Text style={s.sub}>
        {profile?.access_status === "pending"
          ? "Your lecturer request is waiting for an administrator to approve it."
          : `Signed in as ${p.session?.user.email ?? ""}`}
      </Text>
      {profile?.access_status === "pending" ? (
        <Info
          title="We’ll keep your account ready"
          body="You can sign in again later. An administrator must approve lecturer access before you can manage courses."
        />
      ) : role === "student" ? (
        <>
          <Text style={s.section}>YOUR COURSES</Text>
          {p.performances.length === 0 ? (
            <Info
              title="Start with a class code"
              body="Ask your lecturer for a course code, then join the class to see your progress here."
            />
          ) : (
            p.performances.map((c) => (
              <Info
                key={c.course_id}
                title={`${c.code} · ${c.title}`}
                body={
                  c.completed_weight_percent
                    ? `${Math.round(c.current_percent)}% current score · ${Math.round(c.completed_weight_percent)}% of course assessed`
                    : "No results recorded yet"
                }
              />
            ))
          )}
          <Text style={s.section}>MARKS &amp; FEEDBACK</Text>
          {p.studentResults.length === 0 ? (
            <Info
              title="No assessments yet"
              body="Assessment results and lecturer feedback will appear here once they are posted."
            />
          ) : (
            p.studentResults.map((item) => (
              <Info
                key={item.assessment_id}
                title={`${item.course_code} · ${item.assessment_title}`}
                body={
                  item.score === null
                    ? `Awaiting grade${item.due_date ? ` · due ${item.due_date}` : ``}`
                    : `Score ${item.score} / ${item.max_score} · ${item.weight_percent}% of course${item.feedback ? ` · ${item.feedback}` : ``}`
                }
              />
            ))
          )}
          <Field
            label="CLASS CODE"
            value={p.courseCode}
            onChangeText={p.setCourseCode}
            placeholder="Enter code from lecturer"
            autoCapitalize="characters"
          />
          <Button
            title={p.busy ? "Joining…" : "Join a course"}
            onPress={p.onJoin}
            disabled={p.busy}
          />
        </>
      ) : role === "lecturer" ? (
        <LecturerTools
          courses={p.courses}
          lecturerId={p.session?.user.id ?? ""}
          courseCode={p.courseCode}
          courseTitle={p.courseTitle}
          term={p.term}
          setCourseCode={p.setCourseCode}
          setCourseTitle={p.setCourseTitle}
          setTerm={p.setTerm}
          onCreate={p.onCreate}
          busy={p.busy}
        />
      ) : (
        <>
          <Text style={s.section}>LECTURER ACCESS REQUESTS</Text>
          {p.people.filter(
            (x) =>
              x.requested_role === "lecturer" && x.access_status === "pending",
          ).length === 0 ? (
            <Info
              title="All caught up"
              body="There are no lecturer requests waiting for review."
            />
          ) : (
            p.people
              .filter(
                (x) =>
                  x.requested_role === "lecturer" &&
                  x.access_status === "pending",
              )
              .map((person) => (
                <View key={person.user_id} style={s.listCard}>
                  <Text style={s.listTitle}>{person.full_name}</Text>
                  <Text style={s.hint}>Lecturer request</Text>
                  <Pressable
                    onPress={() => p.onApprove(person.user_id)}
                    style={s.approve}
                  >
                    <Text style={s.approveText}>Approve lecturer</Text>
                  </Pressable>
                </View>
              ))
          )}
          <Text style={s.section}>CREATE A COURSE</Text>
          {p.people.filter(
            (person) =>
              person.role === "lecturer" && person.access_status === "active",
          ).length === 0 ? (
            <Info
              title="Approve a lecturer first"
              body="A course must be assigned to an approved lecturer. Approve a lecturer request above, then create the course here."
            />
          ) : (
            <>
              <Text style={s.label}>ASSIGN TO AN APPROVED LECTURER</Text>
              {p.people
                .filter(
                  (person) =>
                    person.role === "lecturer" &&
                    person.access_status === "active",
                )
                .map((person) => (
                  <Pressable
                    key={person.user_id}
                    onPress={() => p.setCourseLecturerId(person.user_id)}
                    style={[
                      s.listCard,
                      p.courseLecturerId === person.user_id && s.roleOn,
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{
                      selected: p.courseLecturerId === person.user_id,
                    }}
                  >
                    <Text style={s.listTitle}>{person.full_name}</Text>
                    <Text style={s.hint}>
                      {p.courseLecturerId === person.user_id
                        ? "Selected lecturer"
                        : "Tap to assign course"}
                    </Text>
                  </Pressable>
                ))}
              <Field
                label="COURSE CODE"
                value={p.courseCode}
                onChangeText={p.setCourseCode}
                placeholder="e.g. CSC 201"
                autoCapitalize="characters"
              />
              <Field
                label="COURSE TITLE"
                value={p.courseTitle}
                onChangeText={p.setCourseTitle}
                placeholder="Introduction to Computing"
              />
              <Field
                label="TERM"
                value={p.term}
                onChangeText={p.setTerm}
                placeholder="e.g. 2026/2027, Semester 1"
              />
              <Button
                title={p.busy ? "Creating…" : "Create course"}
                onPress={p.onCreate}
                disabled={p.busy || !p.courseLecturerId}
              />
            </>
          )}
          <Text style={s.section}>ALL COURSES</Text>
          {p.courses.map((c) => (
            <Info key={c.id} title={`${c.code} · ${c.title}`} body={c.term} />
          ))}
        </>
      )}
      <Pressable onPress={p.onSignOut} style={s.link}>
        <Text style={s.muted}>Sign out</Text>
      </Pressable>
    </View>
  );
}
function LecturerTools(p: {
  courses: Course[];
  lecturerId: string;
  courseCode: string;
  courseTitle: string;
  term: string;
  setCourseCode: (v: string) => void;
  setCourseTitle: (v: string) => void;
  setTerm: (v: string) => void;
  onCreate: () => void;
  busy: boolean;
}) {
  const [active, setActive] = useState<Course | null>(null);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [roster, setRoster] = useState<RosterStudent[]>([]);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [assessmentId, setAssessmentId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [title, setTitle] = useState("");
  const [maxScore, setMaxScore] = useState("100");
  const [weight, setWeight] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [score, setScore] = useState("");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function refresh(courseId: string) {
    const [nextAssessments, nextRoster, nextGrades] = await Promise.all([
      listAssessments(courseId),
      listRoster(courseId),
      listCourseGrades(courseId),
    ]);
    setAssessments(nextAssessments);
    setRoster(nextRoster);
    setGrades(nextGrades);
    setAssessmentId((old) =>
      nextAssessments.some((item) => item.id === old)
        ? old
        : (nextAssessments[0]?.id ?? ""),
    );
  }
  function selectAssessment(id: string) {
    setAssessmentId(id);
    const existing = grades.find(
      (item) => item.assessment_id === id && item.student_id === studentId,
    );
    setScore(existing ? String(existing.score) : "");
    setFeedback(existing?.feedback ?? "");
  }
  function selectStudent(id: string) {
    setStudentId(id);
    const existing = grades.find(
      (item) => item.assessment_id === assessmentId && item.student_id === id,
    );
    setScore(existing ? String(existing.score) : "");
    setFeedback(existing?.feedback ?? "");
  }
  async function open(course: Course) {
    setError("");
    setStudentId("");
    setScore("");
    setFeedback("");
    setActive(course);
    try {
      await refresh(course.id);
    } catch (e) {
      setError(message(e));
    }
  }
  async function addAssessment() {
    if (!active) return;
    const parsedMax = Number(maxScore),
      parsedWeight = Number(weight);
    if (
      !title.trim() ||
      !Number.isFinite(parsedMax) ||
      parsedMax <= 0 ||
      !Number.isFinite(parsedWeight) ||
      parsedWeight <= 0
    ) {
      setError(
        "Enter an assessment name, a maximum score, and a course weight above zero.",
      );
      return;
    }
    if (dueDate.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate.trim())) {
      setError("Enter the due date as YYYY-MM-DD.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await createAssessment({
        courseId: active.id,
        title,
        maxScore: parsedMax,
        weightPercent: parsedWeight,
        dueDate: dueDate.trim() || undefined,
      });
      setTitle("");
      setWeight("");
      setDueDate("");
      await refresh(active.id);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function recordGrade() {
    if (
      !active ||
      !assessmentId ||
      !studentId ||
      !roster.some((item) => item.user_id === studentId)
    ) {
      setError("Choose an assessment and a student first.");
      return;
    }
    const selected = assessments.find((item) => item.id === assessmentId),
      parsed = Number(score);
    if (
      !selected ||
      !Number.isFinite(parsed) ||
      parsed < 0 ||
      parsed > selected.max_score
    ) {
      setError(
        `Enter a score from 0 to ${selected?.max_score ?? "the maximum score"}.`,
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      await saveGrade({
        assessmentId,
        studentId,
        score: parsed,
        feedback,
        lecturerId: p.lecturerId,
      });
      setScore("");
      setFeedback("");
      await refresh(active.id);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View>
      {!active ? (
        <>
          <Text style={s.section}>YOUR COURSES</Text>
          {p.courses.length === 0 ? (
            <Info
              title="No courses yet"
              body="Create a course, then share its class code with students."
            />
          ) : (
            p.courses.map((course) => (
              <View key={course.id} style={s.listCard}>
                <Text style={s.listTitle}>
                  {course.code} · {course.title}
                </Text>
                <Text style={s.hint}>
                  {course.term} · Class code {course.enrollment_code ?? "—"}
                </Text>
                <Pressable onPress={() => void open(course)} style={s.approve}>
                  <Text style={s.approveText}>Manage course</Text>
                </Pressable>
              </View>
            ))
          )}
          <Text style={s.section}>CREATE A COURSE</Text>
          <Field
            label="COURSE CODE"
            value={p.courseCode}
            onChangeText={p.setCourseCode}
            placeholder="e.g. CSC 201"
            autoCapitalize="characters"
          />
          <Field
            label="COURSE TITLE"
            value={p.courseTitle}
            onChangeText={p.setCourseTitle}
            placeholder="Introduction to Computing"
          />
          <Field
            label="TERM"
            value={p.term}
            onChangeText={p.setTerm}
            placeholder="e.g. 2026/2027, Semester 1"
          />
          <Button
            title={p.busy ? "Creating…" : "Create course"}
            onPress={p.onCreate}
            disabled={p.busy}
          />
        </>
      ) : (
        <>
          <Pressable
            onPress={() => {
              setActive(null);
              setError("");
            }}
            style={s.back}
          >
            <Text style={s.backText}>‹ All courses</Text>
          </Pressable>
          <Text style={s.eyebrow}>
            {active.code} · {active.term}
          </Text>
          <Text style={s.title}>{active.title}</Text>
          <Text style={s.hint}>
            Class code: {active.enrollment_code ?? "—"}
          </Text>
          <Text style={s.section}>
            ASSESSMENTS ·{" "}
            {assessments.reduce(
              (sum, item) => sum + Number(item.weight_percent),
              0,
            )}
            % OF COURSE
          </Text>
          {assessments.map((item) => (
            <Pressable
              key={item.id}
              onPress={() => selectAssessment(item.id)}
              style={[s.info, assessmentId === item.id && s.infoSelected]}
            >
              <Text style={s.infoTitle}>{item.title}</Text>
              <Text style={s.infoBody}>
                {item.weight_percent}% · scored out of {item.max_score}
                {item.due_date ? ` · due ${item.due_date}` : ""}
              </Text>
            </Pressable>
          ))}
          <Text style={s.label}>NEW ASSESSMENT</Text>
          <Field
            label="ASSESSMENT NAME"
            value={title}
            onChangeText={setTitle}
            placeholder="Quiz 1"
          />
          <View style={s.inline}>
            <View style={{ flex: 1 }}>
              <Field
                label="MAX SCORE"
                value={maxScore}
                onChangeText={setMaxScore}
                placeholder="100"
                keyboardType="decimal-pad"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label="COURSE WEIGHT %"
                value={weight}
                onChangeText={setWeight}
                placeholder="20"
                keyboardType="decimal-pad"
              />
            </View>
          </View>
          <Field
            label="DUE DATE (OPTIONAL)"
            value={dueDate}
            onChangeText={setDueDate}
            placeholder="YYYY-MM-DD"
          />
          <Button
            title={busy ? "Saving…" : "Add assessment"}
            onPress={() => void addAssessment()}
            disabled={busy}
          />
          <Text style={s.section}>CLASS ROSTER · {roster.length} STUDENTS</Text>
          {roster.length === 0 ? (
            <Info
              title="No students yet"
              body="Share the class code above so students can join before you record grades."
            />
          ) : (
            roster.map((person) => (
              <Pressable
                key={person.user_id}
                onPress={() => selectStudent(person.user_id)}
                style={[s.info, studentId === person.user_id && s.infoSelected]}
              >
                <Text style={s.infoTitle}>{person.full_name}</Text>
                <Text style={s.infoBody}>
                  {grades.filter((g) => g.student_id === person.user_id).length}{" "}
                  grades recorded
                </Text>
              </Pressable>
            ))
          )}
          {roster.length > 0 && (
            <>
              <Text style={s.label}>GRADE SELECTED STUDENT</Text>
              <Field
                label="SCORE"
                value={score}
                onChangeText={setScore}
                placeholder="Score"
                keyboardType="decimal-pad"
              />
              <Field
                label="FEEDBACK (OPTIONAL)"
                value={feedback}
                onChangeText={setFeedback}
                placeholder="Feedback for this student"
              />
              <Button
                title={busy ? "Saving…" : "Save grade"}
                onPress={() => void recordGrade()}
                disabled={busy}
              />
            </>
          )}
        </>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      )}
    </View>
  );
}

function PasswordInput(p: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  visible: boolean;
  onToggle: () => void;
  autoComplete?: React.ComponentProps<typeof TextInput>["autoComplete"];
}) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{p.label}</Text>
      <View>
        <TextInput
          value={p.value}
          onChangeText={p.onChangeText}
          placeholder="At least 10 characters"
          placeholderTextColor="rgba(255,255,255,0.42)"
          selectionColor={colors.lavender}
          secureTextEntry={!p.visible}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete={p.autoComplete}
          style={[s.input, s.passwordInput]}
        />
        <Pressable
          onPress={p.onToggle}
          style={s.passwordToggle}
          accessibilityRole="button"
          accessibilityLabel={p.visible ? "Hide password" : "Show password"}
        >
          <Text style={s.passwordToggleText}>
            {p.visible ? "Hide" : "Show"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
function PasswordRules({ password }: { password: string }) {
  return (
    <View style={s.passwordRules}>
      {passwordChecks.map((rule) => (
        <Text
          key={rule.label}
          style={[s.passwordRule, rule.test(password) && s.passwordRuleMet]}
        >
          {rule.test(password) ? "✓" : "○"} {rule.label}
        </Text>
      ))}
    </View>
  );
}
function cap(v: string) {
  return v.charAt(0).toUpperCase() + v.slice(1);
}
function message(e: unknown) {
  if (typeof e === "object" && e !== null) {
    const error = e as {
      code?: unknown;
      details?: unknown;
      hint?: unknown;
      message?: unknown;
    };
    if (error.code === "23505") {
      return "A course with this code and term already exists. Choose a different code or term.";
    }
    if (error.code === "42501") {
      return "Only an approved lecturer or administrator can create courses. Check your account access and try again.";
    }
    if (error.code === "23503") {
      return "The selected lecturer account could not be found. Refresh the app and choose an approved lecturer again.";
    }
    if (error.code === "23502") {
      return "Some course information is missing. Enter the course code, title, term, and lecturer, then try again.";
    }
    if (typeof error.message === "string" && error.message.trim()) {
      const extra = [error.details, error.hint]
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .join(" ");
      return extra ? `${error.message} ${extra}` : error.message;
    }
  }
  if (e instanceof Error && e.message.trim()) return e.message;
  return "Something went wrong. Please try again.";
}
function Brand() {
  return (
    <View style={s.brand}>
      <View style={s.mark}>
        <Text style={s.markA}>A</Text>
        <View style={s.dot} />
      </View>
      <Text style={s.brandName}>AcaPulse</Text>
      <Text style={s.brandSub}>ACADEMIC INTELLIGENCE</Text>
    </View>
  );
}
function Field(
  props: React.ComponentProps<typeof TextInput> & { label: string },
) {
  const { label, ...rest } = props;
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        {...rest}
        placeholderTextColor="rgba(255,255,255,0.42)"
        selectionColor={colors.lavender}
        style={s.input}
      />
    </View>
  );
}
function Button({
  title,
  onPress,
  disabled,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        pressed && { opacity: 0.84 },
        disabled && { opacity: 0.55 },
      ]}
    >
      <Text style={s.buttonText}>{title}</Text>
      <Text style={s.arrow}>→</Text>
    </Pressable>
  );
}
function SwitchLink({ text, onPress }: { text: string; onPress: () => void }) {
  return (
    <Pressable style={s.link} onPress={onPress}>
      <Text style={s.muted}>{text}</Text>
    </Pressable>
  );
}
function Back({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={s.back}>
      <Text style={s.backText}>‹ Back</Text>
    </Pressable>
  );
}
function Info({ title, body }: { title: string; body: string }) {
  return (
    <View style={s.info}>
      <Text style={s.infoTitle}>{title}</Text>
      <Text style={s.infoBody}>{body}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, overflow: "hidden" },
  safe: { flex: 1 },
  glow: {
    position: "absolute",
    width: 320,
    height: 320,
    borderRadius: 200,
    backgroundColor: "rgba(112,69,181,.22)",
    top: -170,
    right: -100,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 27,
    paddingTop: 16,
    paddingBottom: 20,
    justifyContent: "space-between",
  },
  brand: { alignItems: "center", marginBottom: 18 },
  mark: {
    width: 45,
    height: 45,
    borderRadius: 15,
    backgroundColor: "rgba(255,255,255,.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,.26)",
    alignItems: "center",
    justifyContent: "center",
  },
  markA: { fontSize: 25, fontWeight: "700", color: colors.white },
  dot: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 7,
    height: 7,
    borderRadius: 5,
    backgroundColor: colors.lavender,
  },
  brandName: {
    color: colors.white,
    fontSize: 20,
    fontWeight: "700",
    marginTop: 8,
  },
  brandSub: {
    color: "rgba(255,255,255,.53)",
    fontSize: 9,
    letterSpacing: 2,
    marginTop: 3,
  },
  hero: { flex: 1, justifyContent: "center", paddingVertical: 18 },
  overline: {
    color: colors.lavender,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 2,
    textAlign: "center",
  },
  heroTitle: {
    color: colors.white,
    fontSize: 33,
    lineHeight: 41,
    textAlign: "center",
    fontWeight: "700",
    marginTop: 14,
  },
  sub: {
    color: "rgba(255,255,255,.68)",
    fontSize: 14,
    lineHeight: 22,
    marginTop: 10,
    marginBottom: 16,
  },
  preview: {
    borderRadius: 21,
    padding: 17,
    backgroundColor: "rgba(255,255,255,.095)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,.19)",
    marginTop: 22,
  },
  cardTag: { color: "rgba(255,255,255,.58)", fontSize: 9, letterSpacing: 1.2 },
  previewTitle: {
    color: colors.white,
    fontSize: 16,
    fontWeight: "600",
    marginTop: 7,
  },
  bars: {
    height: 63,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    marginTop: 17,
  },
  barTrack: {
    flex: 1,
    height: "100%",
    justifyContent: "flex-end",
    borderRadius: 5,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,.07)",
  },
  bar: { width: "100%", borderRadius: 5 },
  cardFoot: { color: "rgba(255,255,255,.55)", fontSize: 11, marginTop: 12 },
  button: {
    height: 55,
    borderRadius: 16,
    backgroundColor: colors.pale,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
  },
  buttonText: { color: colors.panel, fontSize: 15, fontWeight: "700" },
  arrow: { position: "absolute", right: 18, color: colors.panel, fontSize: 19 },
  link: { minHeight: 48, alignItems: "center", justifyContent: "center" },
  muted: { color: "rgba(255,255,255,.68)", fontSize: 13, textAlign: "center" },
  bold: { color: colors.white, fontWeight: "700" },
  panel: { flex: 1, justifyContent: "center", paddingTop: 5 },
  back: {
    alignSelf: "flex-start",
    paddingVertical: 10,
    paddingRight: 20,
    marginBottom: 10,
  },
  backText: { color: colors.lavender, fontWeight: "600" },
  eyebrow: {
    color: colors.lavender,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.7,
  },
  title: {
    color: colors.white,
    fontSize: 28,
    lineHeight: 35,
    fontWeight: "700",
    marginTop: 7,
  },
  label: {
    color: "rgba(255,255,255,.74)",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  field: { marginBottom: 14 },
  input: {
    height: 52,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: "rgba(255,255,255,.07)",
    paddingHorizontal: 14,
    color: colors.white,
    fontSize: 14,
  },
  roles: { flexDirection: "row", gap: 7, marginBottom: 16 },
  role: {
    flex: 1,
    minHeight: 41,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: "rgba(255,255,255,.04)",
  },
  roleOn: { backgroundColor: "#E9DEFF", borderColor: "#E9DEFF" },
  roleTxt: { color: "rgba(255,255,255,.85)", fontSize: 10, fontWeight: "600" },
  roleTxtOn: { color: colors.panel },
  hint: {
    color: "#DED1F5",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 8,
    marginBottom: 10,
  },
  error: {
    backgroundColor: "rgba(255,90,120,.14)",
    borderWidth: 1,
    borderColor: "rgba(255,130,150,.32)",
    color: "#FFD9E0",
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
    fontSize: 12,
    lineHeight: 18,
  },
  config: {
    padding: 13,
    borderRadius: 13,
    backgroundColor: "rgba(200,178,242,.10)",
    borderWidth: 1,
    borderColor: "rgba(200,178,242,.24)",
    marginTop: 14,
  },
  configTitle: { color: colors.white, fontSize: 13, fontWeight: "700" },
  footer: {
    textAlign: "center",
    color: "rgba(255,255,255,.36)",
    fontSize: 9,
    letterSpacing: 1.8,
    marginTop: 12,
  },
  section: {
    color: colors.lavender,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.5,
    marginTop: 20,
    marginBottom: 10,
  },
  info: {
    padding: 15,
    borderRadius: 15,
    backgroundColor: "rgba(255,255,255,.075)",
    borderWidth: 1,
    borderColor: colors.line,
    marginBottom: 9,
  },
  infoTitle: { color: colors.white, fontSize: 14, fontWeight: "700" },
  infoBody: {
    color: "rgba(255,255,255,.65)",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 5,
  },
  listCard: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,.075)",
    borderWidth: 1,
    borderColor: colors.line,
    marginBottom: 9,
  },
  listTitle: { color: colors.white, fontSize: 14, fontWeight: "700" },
  approve: {
    alignSelf: "flex-start",
    marginTop: 9,
    backgroundColor: "#E9DEFF",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 9,
  },
  approveText: { color: colors.panel, fontSize: 12, fontWeight: "700" },
  infoSelected: {
    borderColor: colors.lavender,
    backgroundColor: "rgba(200,178,242,.16)",
  },
  inline: { flexDirection: "row", gap: 10 },
  success: {
    color: "#C1F8D9",
    backgroundColor: "rgba(182,255,219,.10)",
    borderWidth: 1,
    borderColor: "rgba(182,255,219,.24)",
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
    fontSize: 12,
    lineHeight: 18,
  },
  forgotLink: {
    alignSelf: "flex-end",
    paddingVertical: 5,
    marginTop: -8,
    marginBottom: 10,
  },
  forgotText: { color: colors.lavender, fontSize: 12, fontWeight: "700" },
  passwordInput: { paddingRight: 72 },
  passwordToggle: {
    position: "absolute",
    right: 7,
    top: 6,
    bottom: 6,
    minWidth: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  passwordToggleText: {
    color: colors.lavender,
    fontSize: 12,
    fontWeight: "700",
  },
  passwordRules: {
    marginTop: -5,
    marginBottom: 12,
    paddingHorizontal: 2,
    gap: 4,
  },
  passwordRule: {
    color: "rgba(255,255,255,.47)",
    fontSize: 11,
    lineHeight: 16,
  },
  passwordRuleMet: { color: "#C1F8D9" },
});

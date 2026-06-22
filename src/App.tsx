import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";
import { useAccountStore } from "@/stores/accountStore";
import { AppLayout } from "@/components/layout/AppLayout";

import Login from "@/pages/auth/Login";
import Signup from "@/pages/auth/Signup";
import NotFound from "@/pages/NotFound";

const TestimonialFormPublic = lazy(() => import("@/pages/public/TestimonialForm"));

const OwnerPanel = lazy(() => import("@/pages/owner/OwnerPanel"));
const Dashboard = lazy(() => import("@/pages/modules/Dashboard"));
const Analytics = lazy(() => import("@/pages/modules/Analytics"));
const RepurposingEngine = lazy(() => import("@/pages/modules/RepurposingEngine"));
const SocialPosts = lazy(() => import("@/pages/modules/SocialPosts"));
const BlogPosts = lazy(() => import("@/pages/modules/BlogPosts"));
const EmailMarketing = lazy(() => import("@/pages/modules/EmailMarketing"));
const Testimonials = lazy(() => import("@/pages/modules/Testimonials"));
const VideoModule = lazy(() => import("@/pages/modules/VideoModule"));
const BrainstormChat = lazy(() => import("@/pages/modules/BrainstormChat"));
const ApprovalBoard = lazy(() => import("@/pages/modules/ApprovalBoard"));
const ContentCalendar = lazy(() => import("@/pages/modules/ContentCalendar"));
const ContentLibrary = lazy(() => import("@/pages/modules/ContentLibrary"));
const PromptLibrary = lazy(() => import("@/pages/modules/PromptLibrary"));
const SeoTools = lazy(() => import("@/pages/modules/SeoTools"));
const GoogleBusiness = lazy(() => import("@/pages/modules/GoogleBusiness"));
const WebsiteScanner = lazy(() => import("@/pages/modules/WebsiteScanner"));
const SocialListener = lazy(() => import("@/pages/modules/SocialListener"));
const NicheResearch = lazy(() => import("@/pages/modules/NicheResearch"));
const BrandKit = lazy(() => import("@/pages/modules/BrandKit"));
const KnowledgeBase = lazy(() => import("@/pages/modules/KnowledgeBase"));
const AccountSettings = lazy(() => import("@/pages/modules/AccountSettings"));

function FullScreenSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}

/** Gates the app shell behind a valid Supabase session. */
function RequireAuth({ children }: { children: ReactNode }) {
  const session = useAuthStore((s) => s.session);
  const initialized = useAuthStore((s) => s.initialized);
  if (!initialized) return <FullScreenSpinner />;
  if (!session) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** Gates owner routes behind the master owner role (Section 3). Accepts the
 *  platform_owner JWT claim or the profiles flag, so a freshly-promoted
 *  owner works before their token refreshes. */
function RequireOwner({ children }: { children: ReactNode }) {
  const claimIsOwner = useAuthStore((s) => s.isPlatformOwner);
  const initialized = useAuthStore((s) => s.initialized);
  const accountStatus = useAccountStore((s) => s.status);
  const profileIsOwner = useAccountStore((s) => s.profile?.is_platform_owner ?? false);
  if (!initialized || accountStatus === "loading" || accountStatus === "idle") {
    return <FullScreenSpinner />;
  }
  if (!claimIsOwner && !profileIsOwner) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Keeps signed-in users out of the auth pages. */
function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const session = useAuthStore((s) => s.session);
  const initialized = useAuthStore((s) => s.initialized);
  if (!initialized) return <FullScreenSpinner />;
  if (session) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  const initialize = useAuthStore((s) => s.initialize);
  const user = useAuthStore((s) => s.user);
  const loadForUser = useAccountStore((s) => s.loadForUser);
  const clearAccount = useAccountStore((s) => s.clear);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  // Load profile + account (and apply white-label branding) whenever a
  // session appears; clear tenant state on sign-out.
  useEffect(() => {
    if (user) {
      void loadForUser(user.id);
    } else {
      clearAccount();
    }
  }, [user, loadForUser, clearAccount]);

  return (
    <BrowserRouter>
      <Suspense fallback={<FullScreenSpinner />}>
      <Routes>
        <Route
          path="/login"
          element={
            <RedirectIfAuthed>
              <Login />
            </RedirectIfAuthed>
          }
        />
        <Route
          path="/signup"
          element={
            <RedirectIfAuthed>
              <Signup />
            </RedirectIfAuthed>
          }
        />

        {/* Public — no auth: client feedback form via opaque token */}
        <Route path="/t/:token" element={<TestimonialFormPublic />} />

        <Route
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route path="/" element={<Dashboard />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/repurpose" element={<RepurposingEngine />} />
          <Route path="/social-posts" element={<SocialPosts />} />
          <Route path="/blog-posts" element={<BlogPosts />} />
          <Route path="/email" element={<EmailMarketing />} />
          <Route path="/testimonials" element={<Testimonials />} />
          <Route path="/video" element={<VideoModule />} />
          <Route path="/brainstorm" element={<BrainstormChat />} />
          <Route path="/kanban" element={<ApprovalBoard />} />
          <Route path="/calendar" element={<ContentCalendar />} />
          <Route path="/library" element={<ContentLibrary />} />
          <Route path="/prompts" element={<PromptLibrary />} />
          <Route path="/seo" element={<SeoTools />} />
          <Route path="/google-business" element={<GoogleBusiness />} />
          <Route path="/website-scanner" element={<WebsiteScanner />} />
          <Route path="/social-listener" element={<SocialListener />} />
          <Route path="/niche-research" element={<NicheResearch />} />
          <Route path="/brand-kit" element={<BrandKit />} />
          <Route path="/knowledge-base" element={<KnowledgeBase />} />
          <Route path="/settings" element={<AccountSettings />} />
          <Route
            path="/owner/*"
            element={
              <RequireOwner>
                <OwnerPanel />
              </RequireOwner>
            }
          />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

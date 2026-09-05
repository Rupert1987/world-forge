import { useEffect, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClerkProvider, SignIn, SignUp, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import ProjectsPage from '@/pages/projects';
import WorkspacePage from '@/pages/workspace';
import DeveloperAccessPage from '@/pages/developer-access';
import { AUTH_ENABLED } from '@/lib/auth-mode';
import {
  Route,
  Redirect,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

const clerkAppearance = {
  theme: 'simple' as const,
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: '#ef4d32',
    colorForeground: '#202833',
    colorMutedForeground: '#687383',
    colorBackground: '#ffffff',
    colorInput: '#f7f8fa',
    colorInputForeground: '#202833',
    colorNeutral: '#d9dee5',
    fontFamily: 'Plus Jakarta Sans, sans-serif',
    borderRadius: '0.75rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-white rounded-2xl w-[440px] max-w-full overflow-hidden border border-border shadow-sm',
    card: '!shadow-none !border-0 !bg-transparent',
    footer: '!shadow-none !border-0 !bg-transparent',
    headerTitle: 'text-2xl font-extrabold tracking-tight',
    headerSubtitle: 'text-sm text-muted-foreground',
    formFieldLabel: 'text-sm font-semibold',
    footerActionLink: 'font-semibold text-primary',
    footerActionText: 'text-sm text-muted-foreground',
  },
};

const clerkLocalization = {
  signIn: {
    start: {
      title: 'World Forge',
      subtitle: 'Sign in to continue',
    },
  },
  signUp: {
    start: {
      title: 'World Forge',
      subtitle: 'Create your workspace',
    },
  },
};

function SignInPage() {
  return <div className="grid min-h-[100dvh] place-items-center bg-background px-4"><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} fallbackRedirectUrl={`${basePath}/projects`} /></div>;
}

function SignUpPage() {
  return <div className="grid min-h-[100dvh] place-items-center bg-background px-4"><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} fallbackRedirectUrl={`${basePath}/projects`} /></div>;
}

function ClerkProtectedRoute({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useUser();
  const [session, setSession] = useState<'checking' | 'authenticated' | 'anonymous'>('checking');

  useEffect(() => {
    let active = true;
    void fetch('/api/developer/session', { credentials: 'include' })
      .then((response) => {
        if (active) setSession(response.ok ? 'authenticated' : 'anonymous');
      })
      .catch(() => {
        if (active) setSession('anonymous');
      });
    return () => { active = false; };
  }, [isSignedIn]);

  if (!isLoaded || session === 'checking') {
    return <div className="grid min-h-[100dvh] place-items-center bg-background text-sm text-muted-foreground">Checking your World Forge session…</div>;
  }
  if (session !== 'authenticated') return <Redirect to="/sign-in" />;
  return <>{children}</>;
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  if (!AUTH_ENABLED) return <>{children}</>;
  return <ClerkProtectedRoute>{children}</ClerkProtectedRoute>;
}

function Router() {
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/projects"><ProtectedRoute><ProjectsPage /></ProtectedRoute></Route>
        <Route path="/developer-access" component={DeveloperAccessPage} />
        <Route path="/sign-in/*?">{AUTH_ENABLED ? <SignInPage /> : <Redirect to="/projects" />}</Route>
        <Route path="/sign-up/*?">{AUTH_ENABLED ? <SignUpPage /> : <Redirect to="/projects" />}</Route>
        <Route path="/project/:id"><ProtectedRoute><WorkspacePage /></ProtectedRoute></Route>
        <Route path="/"><Redirect to="/projects" /></Route>
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function AppContent() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={basePath}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function App() {
  if (!AUTH_ENABLED) return <AppContent />;
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      localization={clerkLocalization}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
    >
      <AppContent />
    </ClerkProvider>
  );
}

export default App;

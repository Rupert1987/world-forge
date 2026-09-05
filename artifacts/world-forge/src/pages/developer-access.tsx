import { useEffect, useState } from 'react';
import { useUser } from '@clerk/react';
import { Link } from 'wouter';
import { Bot, Check, Copy, KeyRound, LoaderCircle, LockKeyhole, PlugZap, ShieldCheck, TerminalSquare, Trash2 } from 'lucide-react';
import { PageMeta, WorldForgeShell } from '@/components/world-forge-shell';
import { AUTH_ENABLED } from '@/lib/auth-mode';

const AGENT_REQUEST = `Use World Forge to turn my concept art into an Unreal production plan.
1. Create a World Forge project.
2. Request a signed upload URL, PUT the wide master there, then attach its objectPath as the canonical image.
3. Repeat the signed upload and attach steps for the left and right three-quarter alternate views.
4. Start calibrated analysis and wait until it completes.
5. Report confidence, registration, camera-pose status and critical warnings.
6. Export the Unreal bundle only after showing me the review summary.`;

const WORLD_FORGE_ORIGIN = window.location.origin;

const CLAUDE_CONFIG = `{
  "mcpServers": {
    "world-forge": {
      "type": "http",
      "url": "${WORLD_FORGE_ORIGIN}/api/mcp",
      "headers": {
        "Authorization": "Bearer \${WORLDFORGE_API_KEY}"
      }
    }
  }
}`;

const REST_EXAMPLE = `# 1. Verify the key
curl ${WORLD_FORGE_ORIGIN}/api/v1/projects \\
  -H "Authorization: Bearer $WORLDFORGE_API_KEY"

# 2. For each image: request a signed URL, PUT bytes to uploadUrl,
#    then POST its objectPath to /api/v1/projects/{projectId}/assets.
# 3. Start analysis, poll statusUrl, GET /confidence, then GET /export.`;

export default function DeveloperAccessPage() {
  return <WorldForgeShell><div className="min-h-[100dvh]">
    <PageMeta eyebrow="Automation / AI agents" title="Connect your coding agent" description="A guided setup for Claude Code, Grok, Cursor and any tool that can call REST APIs. Keep secrets out of prompts and let the agent discover the correct World Forge workflow." />
    <main className="space-y-6 px-5 py-6 sm:px-8 lg:px-10">
      <section className="grid gap-4 lg:grid-cols-3" data-testid="panel-agent-choices">
        <Choice icon={<Bot size={19} />} title="Claude Code or MCP client" detail="Recommended. The agent discovers World Forge tools and their required inputs automatically." badge="Best experience" />
        <Choice icon={<TerminalSquare size={19} />} title="Grok, scripts or CI" detail="Use the versioned REST API when the tool cannot connect to an MCP server." badge="Universal" />
        <Choice icon={<PlugZap size={19} />} title="Unreal automation" detail="Use the export endpoint from a build script or Unreal commandlet after analysis completes." badge="Production" />
      </section>
      <ApiKeyManager />

      <section className="rounded-xl border border-border bg-card" data-testid="panel-agent-setup-steps">
        <div className="border-b border-border px-5 py-5"><div className="wf-kicker text-primary">Setup checklist</div><h2 className="mt-2 text-xl font-semibold">Do these steps once</h2><p className="mt-1 text-sm text-muted-foreground">The key is a password for your World Forge workspace. Never paste it directly into an AI chat.</p></div>
        <ol className="grid gap-px bg-border md:grid-cols-2 xl:grid-cols-3">
          <GuideStep number="01" icon={<ShieldCheck size={16} />} title="Sign in to World Forge" detail="Use your World Forge account so projects, usage and generated API keys belong only to your workspace." />
          <GuideStep number="02" icon={<KeyRound size={16} />} title="Create an API key" detail="Open Developer Access, name the key after the tool you are connecting, then copy it. The complete key is shown only once." />
          <GuideStep number="03" icon={<LockKeyhole size={16} />} title="Save it as a secret" detail="Store it as WORLDFORGE_API_KEY in the coding environment. Do not commit it to Git or include it in a prompt." />
          <GuideStep number="04" icon={<PlugZap size={16} />} title="Choose MCP or REST" detail="Use MCP for Claude Code and compatible clients. Use REST for Grok, scripts, build systems and custom applications." />
          <GuideStep number="05" icon={<Bot size={16} />} title="Give the agent a job" detail="Copy the safe agent request below. The agent should create the project, upload views, wait for analysis and review confidence." />
          <GuideStep number="06" icon={<Check size={16} />} title="Verify before export" detail="Confirm the project ID, completed job status, registration result and critical warnings before downloading the Unreal bundle." />
        </ol>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <CodeCard eyebrow="Claude Code / MCP" title="Connection configuration" code={CLAUDE_CONFIG} testId="code-claude-config" note="This configuration already uses the current World Forge domain. The API key remains in the WORLDFORGE_API_KEY environment variable." />
        <CodeCard eyebrow="Grok / REST / scripts" title="Connection test" code={REST_EXAMPLE} testId="code-rest-example" note="A successful response returns the projects available to that API key." />
      </section>

      <CodeCard eyebrow="First request to your agent" title="Tell the agent exactly what success means" code={AGENT_REQUEST} testId="code-agent-request" note="This request forces the agent to wait for analysis, report uncertainty and ask for review before exporting." />

      <section className="rounded-xl border border-amber-500/25 bg-amber-500/5 px-5 py-5">
        <div className="flex items-start gap-3"><LockKeyhole className="mt-0.5 shrink-0 text-amber-700" size={18} /><div><h2 className="text-sm font-semibold">Security rules users should not skip</h2><ul className="mt-2 grid gap-1.5 text-xs leading-relaxed text-muted-foreground md:grid-cols-2"><li>• Never paste an API key into Claude, Grok or another chat.</li><li>• Create separate keys for each tool and machine.</li><li>• Revoke a key immediately if it is exposed.</li><li>• Review confidence and critical warnings before export.</li></ul></div></div>
      </section>
    </main>
  </div></WorldForgeShell>;
}

type ApiKeySummary = {
  id: string;
  label: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

function ApiKeyManager() {
  if (!AUTH_ENABLED) return <ApiKeyManagerBody isLoaded isSignedIn />;
  return <ClerkApiKeyManager />;
}

function ClerkApiKeyManager() {
  const { isLoaded, isSignedIn } = useUser();
  return <ApiKeyManagerBody isLoaded={isLoaded} isSignedIn={isSignedIn} />;
}

function ApiKeyManagerBody({ isLoaded, isSignedIn }: { isLoaded: boolean; isSignedIn?: boolean }) {
  const [sessionAuthenticated, setSessionAuthenticated] = useState(false);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [keys, setKeys] = useState<ApiKeySummary[]>([]);
  const [label, setLabel] = useState('Claude Code');
  const [newKey, setNewKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function loadKeys() {
    const response = await fetch('/api/developer/api-keys', { credentials: 'include' });
    if (!response.ok) throw new Error('Could not load API keys');
    setKeys(await response.json() as ApiKeySummary[]);
  }

  useEffect(() => {
    let active = true;
    void fetch('/api/developer/session', { credentials: 'include' })
      .then((response) => {
        if (!active) return undefined;
        setSessionAuthenticated(response.ok);
        setSessionChecked(true);
        if (response.ok) return loadKeys();
        return undefined;
      })
      .catch(() => {
        if (!active) return undefined;
        setSessionAuthenticated(false);
        setSessionChecked(true);
        return undefined;
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not load API keys'));
    return () => { active = false; };
  }, [isSignedIn]);

  async function createKey(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/developer/api-keys', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Could not create API key');
      setNewKey(body.key);
      setLabel('');
      await loadKeys();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create API key');
    } finally {
      setLoading(false);
    }
  }

  async function revokeKey(keyId: string) {
    setError('');
    const response = await fetch(`/api/developer/api-keys/${encodeURIComponent(keyId)}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!response.ok) {
      setError('Could not revoke API key');
      return;
    }
    await loadKeys();
  }

  async function copyNewKey() {
    await navigator.clipboard?.writeText(newKey);
  }

  if (!isLoaded || !sessionChecked) return <section className="grid min-h-40 place-items-center rounded-xl border border-border bg-card"><LoaderCircle className="animate-spin text-primary" /></section>;
  if (!sessionAuthenticated) return <section className="rounded-xl border border-primary/20 bg-primary/5 px-5 py-6" data-testid="panel-api-key-signin"><div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between"><div><div className="wf-kicker text-primary">API key control</div><h2 className="mt-2 text-lg font-semibold">Sign in before creating an agent key</h2><p className="mt-1 max-w-2xl text-sm text-muted-foreground">Signing in keeps keys, projects and usage isolated to your account. The complete key is shown once and stored only as a hash.</p></div><Link href="/sign-in" className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md bg-foreground px-4 py-3 text-sm font-semibold text-background"><KeyRound size={15} />Sign in to create a key</Link></div></section>;

  return <section className="rounded-xl border border-border bg-card" data-testid="panel-api-key-manager">
    <div className="grid gap-5 border-b border-border p-5 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-end">
      <div><div className="wf-kicker text-primary">API key control</div><h2 className="mt-2 text-lg font-semibold">Create one key for each coding agent</h2><p className="mt-1 text-sm text-muted-foreground">Use a clear label such as “Claude Code · studio PC”. If a device is lost, revoke only that key.</p></div>
      <form onSubmit={createKey} className="flex gap-2"><input value={label} onChange={(event) => setLabel(event.target.value)} minLength={2} maxLength={80} required data-testid="input-api-key-label" placeholder="e.g. Claude Code · laptop" className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary" /><button disabled={loading} data-testid="button-create-api-key" className="inline-flex shrink-0 items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60">{loading ? <LoaderCircle size={14} className="animate-spin" /> : <KeyRound size={14} />}Create key</button></form>
    </div>
    {newKey && <div className="border-b border-emerald-500/20 bg-emerald-500/5 p-5" data-testid="panel-new-api-key"><div className="flex items-start justify-between gap-4"><div><div className="flex items-center gap-2 text-sm font-semibold text-emerald-800"><Check size={16} />Copy this key now</div><p className="mt-1 text-xs text-muted-foreground">It will not be shown again. Save it as WORLDFORGE_API_KEY in your coding environment.</p></div><button type="button" onClick={copyNewKey} className="inline-flex items-center gap-2 rounded-md border border-emerald-500/25 px-3 py-2 text-xs font-bold text-emerald-800"><Copy size={13} />Copy key</button></div><code className="mt-3 block overflow-x-auto rounded-md bg-[#111a24] p-3 font-mono text-xs text-[#dce8e3]">{newKey}</code><button type="button" onClick={() => setNewKey('')} className="mt-3 text-xs font-semibold text-muted-foreground hover:text-foreground">I saved this key</button></div>}
    {error && <p className="border-b border-destructive/20 bg-destructive/5 px-5 py-3 text-xs text-destructive">{error}</p>}
    <div className="divide-y divide-border">
      {keys.length === 0 ? <div className="px-5 py-8 text-center text-sm text-muted-foreground">No API keys yet. Create one for the first coding agent you want to connect.</div> : keys.map((key) => <div key={key.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center"><div className="grid h-9 w-9 place-items-center rounded-md bg-muted text-muted-foreground"><KeyRound size={15} /></div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="text-sm font-semibold">{key.label}</span>{key.revokedAt && <span className="rounded-full bg-destructive/10 px-2 py-0.5 font-mono text-[9px] font-bold uppercase text-destructive">Revoked</span>}</div><p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{key.keyPrefix}•••• · created {new Date(key.createdAt).toLocaleDateString()} · {key.lastUsedAt ? `last used ${new Date(key.lastUsedAt).toLocaleDateString()}` : 'never used'}</p></div>{!key.revokedAt && <button type="button" onClick={() => revokeKey(key.id)} className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-semibold text-muted-foreground hover:border-destructive/30 hover:text-destructive"><Trash2 size={13} />Revoke</button>}</div>)}
    </div>
  </section>;
}

function Choice({ icon, title, detail, badge }: { icon: React.ReactNode; title: string; detail: string; badge: string }) {
  return <article className="rounded-xl border border-border bg-card p-5"><div className="flex items-center justify-between"><span className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary">{icon}</span><span className="rounded-full bg-muted px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{badge}</span></div><h2 className="mt-4 text-sm font-semibold">{title}</h2><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{detail}</p></article>;
}

function GuideStep({ number, icon, title, detail }: { number: string; icon: React.ReactNode; title: string; detail: string }) {
  return <li className="bg-card p-5"><div className="flex items-center gap-2 text-primary"><span className="font-mono text-[10px] font-bold">{number}</span>{icon}</div><h3 className="mt-3 text-sm font-semibold">{title}</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{detail}</p></li>;
}

function CodeCard({ eyebrow, title, code, note, testId }: { eyebrow: string; title: string; code: string; note: string; testId: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard?.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }
  return <section className="overflow-hidden rounded-xl border border-border bg-card">
    <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4"><div><div className="wf-kicker text-primary">{eyebrow}</div><h2 className="mt-1 text-base font-semibold">{title}</h2></div><button type="button" onClick={copy} className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-bold hover:border-primary/40"><Copy size={13} />{copied ? 'Copied' : 'Copy'}</button></div>
    <pre data-testid={testId} className="overflow-x-auto bg-[#111a24] p-5 font-mono text-[11px] leading-relaxed text-[#dce8e3]"><code>{code}</code></pre>
    <p className="px-5 py-3 text-xs leading-relaxed text-muted-foreground">{note}</p>
  </section>;
}
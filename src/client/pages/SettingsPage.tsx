import * as React from 'react';
import { CheckCircle2, ExternalLink, Eye, EyeOff, Loader2, Lock, RefreshCw, ShieldCheck, Trash2, XCircle } from 'lucide-react';
import { errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog, ErrorState, PageHeader } from '@/components/common';

function SecretInput({
  id,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [visible, setVisible] = React.useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        className="pr-10 font-mono text-[13px]"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 cursor-pointer rounded p-1.5 text-subtle transition-colors hover:text-foreground"
        aria-label={visible ? 'Hide value' : 'Show value'}
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

function StatusRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 text-[13px]">
      <span className="text-muted">{label}</span>
      <span className="min-w-0 truncate text-right text-zinc-200">{children}</span>
    </div>
  );
}

export default function SettingsPage() {
  const { status, loading, error, testing, test, save, remove, refresh } = useConnectionStatus();
  const [apiKey, setApiKey] = React.useState('');
  const [apiToken, setApiToken] = React.useState('');
  const [feedback, setFeedback] = React.useState<{ kind: 'success' | 'danger'; title: string; message: string } | null>(
    null,
  );
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const configured = !!(status?.keyConfigured && status?.tokenConfigured);

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    try {
      const s = await save({ apiKey: apiKey.trim(), apiToken: apiToken.trim() });
      // Clear secrets from memory as soon as they're submitted.
      setApiKey('');
      setApiToken('');
      if (s.state === 'connected') {
        setFeedback({
          kind: 'success',
          title: 'Credentials saved',
          message: s.member ? `Connected as ${s.member.fullName || s.member.username} (@${s.member.username}).` : 'Connected to Trello.',
        });
      } else {
        setFeedback({
          kind: 'danger',
          title: 'Saved, but the connection test failed',
          message: s.error ?? 'Trello rejected these credentials.',
        });
      }
    } catch (err) {
      setFeedback({ kind: 'danger', title: 'Could not save credentials', message: errorMessage(err) });
    }
  };

  const onTest = async () => {
    setFeedback(null);
    try {
      const s = await test();
      setFeedback(
        s.state === 'connected'
          ? { kind: 'success', title: 'Connection OK', message: s.member ? `Authenticated as @${s.member.username}.` : 'Trello accepted the credentials.' }
          : { kind: 'danger', title: 'Connection failed', message: s.error ?? 'Trello rejected the credentials.' },
      );
    } catch (err) {
      setFeedback({ kind: 'danger', title: 'Connection failed', message: errorMessage(err) });
    }
  };

  const onRemove = async () => {
    setFeedback(null);
    try {
      await remove();
      setFeedback({ kind: 'success', title: 'Credentials removed', message: 'The API key and token were removed from the local .env file.' });
    } catch (err) {
      setFeedback({ kind: 'danger', title: 'Could not remove credentials', message: errorMessage(err) });
    }
  };

  const canSubmit = apiKey.trim().length > 0 && apiToken.trim().length > 0 && !testing;

  return (
    <>
      <PageHeader title="Settings" description="Connect the importer to your Trello account." />

      {feedback && (
        <Alert variant={feedback.kind} className="mb-6">
          {feedback.kind === 'success' ? <CheckCircle2 /> : <XCircle />}
          <AlertTitle>{feedback.title}</AlertTitle>
          <AlertDescription>{feedback.message}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <form onSubmit={onSave}>
            <CardHeader>
              <CardTitle>Trello API credentials</CardTitle>
              <CardDescription>
                {configured
                  ? 'Credentials are configured. Enter new values to replace them.'
                  : 'Enter your Trello API key and token.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <Label htmlFor="apiKey">API key</Label>
                <SecretInput
                  id="apiKey"
                  value={apiKey}
                  onChange={setApiKey}
                  placeholder={status?.keyHint ? `Current key ends in ${status.keyHint}` : '32-character API key'}
                  disabled={testing}
                />
                <p className="text-[12px] text-subtle">
                  Create a Power-Up and generate an API key at{' '}
                  <a
                    href="https://trello.com/power-ups/admin"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 text-zinc-300 underline-offset-4 hover:underline"
                  >
                    trello.com/power-ups/admin <ExternalLink className="size-3" />
                  </a>
                  .
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="apiToken">API token</Label>
                <SecretInput
                  id="apiToken"
                  value={apiToken}
                  onChange={setApiToken}
                  placeholder={status?.tokenConfigured ? 'Token configured — enter a new one to replace' : 'Token'}
                  disabled={testing}
                />
                <p className="text-[12px] text-subtle">
                  On the same API key page, use the <span className="text-zinc-300">Token</span> link next to your key to
                  authorize your account and generate a token.
                </p>
              </div>
            </CardContent>
            <CardFooter className="flex-wrap">
              <Button type="submit" disabled={!canSubmit}>
                {testing && canSubmit ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
                Save &amp; test
              </Button>
              <Button variant="secondary" onClick={onTest} disabled={!configured || testing}>
                {testing && !canSubmit ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                Test connection
              </Button>
              <Button variant="ghost" className="sm:ml-auto" onClick={() => setConfirmOpen(true)} disabled={!configured || testing}>
                <Trash2 />
                Remove credentials
              </Button>
            </CardFooter>
          </form>
        </Card>

        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Current status</CardTitle>
            </CardHeader>
            <CardContent className="pt-3">
              {loading && !status ? (
                <div className="flex flex-col gap-3 py-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              ) : error && !status ? (
                <ErrorState message={error} onRetry={() => void refresh()} />
              ) : status ? (
                <div className="divide-y divide-border">
                  <StatusRow label="State">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className={`size-1.5 rounded-full ${
                          status.state === 'connected' ? 'bg-emerald-400' : status.state === 'failed' ? 'bg-red-400' : 'bg-zinc-500'
                        }`}
                      />
                      {status.state === 'connected' ? 'Connected' : status.state === 'failed' ? 'Connection failed' : 'Not connected'}
                    </span>
                  </StatusRow>
                  <StatusRow label="API key">
                    {status.keyConfigured ? <span className="font-mono">{status.keyHint ?? 'configured'}</span> : <span className="text-subtle">not set</span>}
                  </StatusRow>
                  <StatusRow label="API token">
                    {status.tokenConfigured ? 'configured' : <span className="text-subtle">not set</span>}
                  </StatusRow>
                  {status.member && (
                    <StatusRow label="Account">
                      <span className="font-mono">@{status.member.username}</span>
                    </StatusRow>
                  )}
                  <StatusRow label="Last checked">{formatDateTime(status.checkedAt)}</StatusRow>
                  {status.state === 'failed' && status.error && (
                    <p className="pt-3 text-[12px] text-red-300">{status.error}</p>
                  )}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex gap-3">
              <Lock className="mt-0.5 size-4 shrink-0 text-muted" />
              <div className="text-[13px] leading-relaxed text-muted">
                Credentials are stored only in the local <span className="font-mono text-zinc-300">.env</span> file on
                this machine. They are used by the local server to call Trello and are never sent back to the browser —
                only the last characters of the key are shown here.
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Separator className="my-8 opacity-0" />

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Remove Trello credentials?"
        description="The API key and token will be deleted from the local .env file. You'll need to enter them again before importing."
        confirmLabel="Remove"
        destructive
        onConfirm={onRemove}
      />
    </>
  );
}

import * as React from 'react';
import { Check, ExternalLink, LayoutGrid, Plus, Search } from 'lucide-react';
import type { ListSummary, TrelloBoard, TrelloList, TrelloWorkspace } from '@shared/types';
import { cn, normalizeName } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EmptyState, ErrorState } from '@/components/common';
import { SectionTitle } from './shared';

export interface BoardConfig {
  mode: 'existing' | 'new';
  boardId: string | null;
  newName: string;
  newDesc: string;
  idOrganization: string | null;
  reuseExistingLists: boolean;
  createMissingLists: boolean;
  skipDuplicates: boolean;
}

export interface ListPlanEntry {
  name: string;
  cardCount: number;
  action: 'reuse' | 'create' | 'missing';
}

/** Determine what will happen to each CSV list given the board config + current board lists. */
export function planLists(csvLists: ListSummary[], config: BoardConfig, boardLists: TrelloList[] | null): ListPlanEntry[] {
  const existing = new Set(
    config.mode === 'existing' && boardLists ? boardLists.filter((l) => !l.closed).map((l) => normalizeName(l.name)) : [],
  );
  return csvLists.map((l) => {
    const exists = existing.has(normalizeName(l.name));
    let action: ListPlanEntry['action'];
    if (exists && config.reuseExistingLists) action = 'reuse';
    else if (config.createMissingLists) action = 'create';
    else action = 'missing';
    return { name: l.name, cardCount: l.cardCount, action };
  });
}

const PERSONAL = '__personal__';

function ModeOption({
  active,
  onClick,
  icon: Icon,
  title,
  description,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Plus;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        'flex flex-1 cursor-pointer items-start gap-3 rounded-lg border p-4 text-left transition-colors duration-150',
        active ? 'border-white/30 bg-white/[0.04]' : 'border-border hover:border-border-strong',
      )}
    >
      <span
        className={cn(
          'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border',
          active ? 'border-foreground' : 'border-border-strong',
        )}
      >
        {active && <span className="size-2 rounded-full bg-foreground" />}
      </span>
      <span>
        <span className="flex items-center gap-2 text-[13px] font-medium">
          <Icon className="size-3.5 text-muted" /> {title}
        </span>
        <span className="mt-0.5 block text-[12px] text-muted">{description}</span>
      </span>
    </button>
  );
}

function OptionSwitch({
  id,
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div>
        <Label htmlFor={id} className={disabled ? 'opacity-60' : undefined}>
          {label}
        </Label>
        <p className="mt-1 text-[12px] text-muted">{description}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}

export function BoardStep({
  config,
  onChange,
  boards,
  boardsLoading,
  boardsError,
  onReloadBoards,
  workspaces,
  workspacesLoading,
  boardLists,
  boardListsLoading,
  boardListsError,
  csvLists,
  duplicateCount,
}: {
  config: BoardConfig;
  onChange: (c: BoardConfig) => void;
  boards: TrelloBoard[] | null;
  boardsLoading: boolean;
  boardsError: string | null;
  onReloadBoards: () => void;
  workspaces: TrelloWorkspace[] | null;
  workspacesLoading: boolean;
  boardLists: TrelloList[] | null;
  boardListsLoading: boolean;
  boardListsError: string | null;
  csvLists: ListSummary[];
  duplicateCount: number;
}) {
  const [query, setQuery] = React.useState('');
  const set = (patch: Partial<BoardConfig>) => onChange({ ...config, ...patch });

  const openBoards = (boards ?? []).filter((b) => !b.closed);
  const filtered = query.trim()
    ? openBoards.filter((b) => b.name.toLowerCase().includes(query.trim().toLowerCase()))
    : openBoards;
  const selected = openBoards.find((b) => b.id === config.boardId) ?? null;
  const plan = planLists(csvLists, config, boardLists);
  const wsName = (id: string | null) => workspaces?.find((w) => w.id === id)?.displayName ?? null;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
      <div className="flex flex-col gap-6 lg:col-span-3">
        <Card>
          <CardContent>
            <SectionTitle title="Destination board" description="Import into a board you already have, or create a new one." />
            <div role="radiogroup" className="flex flex-col gap-3 sm:flex-row">
              <ModeOption
                active={config.mode === 'existing'}
                onClick={() => set({ mode: 'existing' })}
                icon={LayoutGrid}
                title="Existing board"
                description="Add lists and cards to a board"
              />
              <ModeOption
                active={config.mode === 'new'}
                onClick={() => set({ mode: 'new' })}
                icon={Plus}
                title="New board"
                description="Create a fresh board for this import"
              />
            </div>

            {config.mode === 'existing' ? (
              <div className="mt-5">
                {boardsError ? (
                  <ErrorState title="Could not load boards" message={boardsError} onRetry={onReloadBoards} />
                ) : (
                  <>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
                      <Input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={`Search ${openBoards.length || ''} boards…`}
                        className="pl-9"
                      />
                    </div>
                    <div className="scrollbar-thin mt-2 max-h-72 overflow-y-auto rounded-lg border border-border">
                      {boardsLoading ? (
                        <div className="flex flex-col gap-2 p-3">
                          {Array.from({ length: 4 }).map((_, i) => (
                            <Skeleton key={i} className="h-8 w-full" />
                          ))}
                        </div>
                      ) : filtered.length === 0 ? (
                        <EmptyState
                          icon={LayoutGrid}
                          title={openBoards.length === 0 ? 'No boards found' : 'No matching boards'}
                          description={openBoards.length === 0 ? 'Create a new board instead.' : 'Try a different search.'}
                          className="py-8"
                        />
                      ) : (
                        <ul role="listbox" className="divide-y divide-border">
                          {filtered.map((b) => {
                            const active = b.id === config.boardId;
                            return (
                              <li key={b.id}>
                                <button
                                  type="button"
                                  role="option"
                                  aria-selected={active}
                                  onClick={() => set({ boardId: b.id })}
                                  className={cn(
                                    'flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left text-[13px] transition-colors duration-150',
                                    active ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]',
                                  )}
                                >
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate font-medium text-zinc-100">{b.name}</span>
                                    {wsName(b.idOrganization) && (
                                      <span className="block truncate text-[11px] text-subtle">{wsName(b.idOrganization)}</span>
                                    )}
                                  </span>
                                  {active && <Check className="size-4 shrink-0" />}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="mt-5 flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="boardName">
                    Board name<span className="ml-0.5 text-red-300">*</span>
                  </Label>
                  <Input
                    id="boardName"
                    value={config.newName}
                    maxLength={16384}
                    onChange={(e) => set({ newName: e.target.value })}
                    placeholder="e.g. Product roadmap"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="boardDesc">Description</Label>
                  <Textarea
                    id="boardDesc"
                    value={config.newDesc}
                    onChange={(e) => set({ newDesc: e.target.value })}
                    placeholder="Optional"
                    rows={3}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Workspace</Label>
                  <Select
                    value={config.idOrganization ?? PERSONAL}
                    onValueChange={(v) => set({ idOrganization: v === PERSONAL ? null : v })}
                    disabled={workspacesLoading}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={workspacesLoading ? 'Loading…' : 'Select workspace'} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={PERSONAL}>
                        <span className="text-muted">Personal / no workspace</span>
                      </SelectItem>
                      {(workspaces?.length ?? 0) > 0 && <SelectSeparator />}
                      {(workspaces ?? []).map((w) => (
                        <SelectItem key={w.id} value={w.id}>
                          {w.displayName || w.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-2">
            <div className="divide-y divide-border">
              <OptionSwitch
                id="reuse"
                label="Reuse existing lists"
                description="Put cards into lists on the board whose name matches (case-insensitive)."
                checked={config.reuseExistingLists}
                onChange={(v) => set({ reuseExistingLists: v })}
                disabled={config.mode === 'new'}
              />
              <OptionSwitch
                id="create"
                label="Create missing lists"
                description="Create lists that don't exist yet. If off, cards for missing lists will fail."
                checked={config.createMissingLists}
                onChange={(v) => set({ createMissingLists: v })}
              />
              <OptionSwitch
                id="skipdup"
                label="Skip duplicate rows"
                description={`Skip rows that repeat an earlier list + card name${duplicateCount ? ` (${duplicateCount} found)` : ''}.`}
                checked={config.skipDuplicates}
                onChange={(v) => set({ skipDuplicates: v })}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="h-fit lg:col-span-2">
        <CardContent>
          <SectionTitle
            title="Lists"
            description={
              config.mode === 'existing'
                ? selected
                  ? 'Compared with lists on the selected board.'
                  : 'Select a board to compare lists.'
                : 'All lists will be created on the new board.'
            }
            right={
              selected && (
                <a
                  href={selected.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-foreground"
                >
                  Open <ExternalLink className="size-3" />
                </a>
              )
            }
          />
          {boardListsError && config.mode === 'existing' && (
            <ErrorState title="Could not load lists" message={boardListsError} className="mb-3" />
          )}
          {config.mode === 'existing' && config.boardId && boardListsLoading ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: Math.min(5, csvLists.length || 3) }).map((_, i) => (
                <Skeleton key={i} className="h-7 w-full" />
              ))}
            </div>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {plan.map((p) => (
                <li key={p.name} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                  <span className="min-w-0 truncate">
                    {p.name}
                    <span className="tabular ml-2 text-[12px] text-subtle">{p.cardCount}</span>
                  </span>
                  {config.mode === 'existing' && !config.boardId ? null : p.action === 'reuse' ? (
                    <Badge variant="default">Will reuse</Badge>
                  ) : p.action === 'create' ? (
                    <Badge variant="info">Will create</Badge>
                  ) : (
                    <Badge variant="danger">Missing</Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
          {config.mode === 'existing' && boardLists && boardLists.filter((l) => !l.closed).length > 0 && (
            <p className="mt-4 text-[12px] text-subtle">
              Board has {boardLists.filter((l) => !l.closed).length} open list
              {boardLists.filter((l) => !l.closed).length === 1 ? '' : 's'}:{' '}
              {boardLists
                .filter((l) => !l.closed)
                .map((l) => l.name)
                .join(', ')}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

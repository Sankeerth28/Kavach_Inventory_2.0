'use client';

import { APP_NAME } from '@kavach/shared';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { Alert, Badge, Button, Select } from '@/components/ui';
import { StoreSwitcher } from '@/components/store-switcher';
import { type NavItem, canOpen, navFor } from '@/lib/nav';
import { useSession } from '@/lib/session';
import { StoreProvider } from '@/lib/store-context';
import { cn } from '@/lib/utils';

const GROUPS: NavItem['group'][] = ['Daily work', 'Inventory', 'Setup', 'Oversight'];

/** Shell for signed-in pages: left navigation, top bar with project selector, notifications, profile (PRD §20.1). */
export default function AppLayout({ children }: { children: ReactNode }) {
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);

  const mustChange = session.me?.user.mustChangePassword ?? false;
  useEffect(() => {
    if (session.status === 'anonymous') router.replace('/login');
    else if (session.status === 'signed-in' && mustChange) router.replace('/change-password');
  }, [session.status, mustChange, router]);

  if (session.status !== 'signed-in' || !session.me || mustChange) {
    return <p className="p-8 text-sm text-muted-foreground">Loading…</p>;
  }

  const { me, membership } = session;
  if (!membership) {
    return (
      <main className="mx-auto max-w-md p-8">
        <Alert tone="warning" title="No project assigned">
          Your account is not a member of any active project. Ask your Project Admin for access.
        </Alert>
        <Button variant="secondary" className="mt-4" onClick={() => void session.logout()}>
          Sign out
        </Button>
      </main>
    );
  }

  const items = navFor(membership.permissions);
  const allowed = canOpen(pathname, membership.permissions);

  return (
    <StoreProvider>
      <div className="flex min-h-screen">
        <aside
          className={cn(
            'fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col overflow-y-auto bg-sidebar text-sidebar-foreground',
            '[scrollbar-color:rgb(255_255_255/0.25)_transparent] [scrollbar-width:thin]',
            'transition-transform md:sticky md:top-0 md:h-screen md:translate-x-0',
            menuOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <div className="flex items-center gap-3 px-5 py-5">
            <span className="flex size-9 items-center justify-center rounded-lg bg-white text-lg font-bold text-primary shadow-sm">
              K
            </span>
            <div className="leading-tight">
              <p className="text-lg font-semibold tracking-wide">{APP_NAME}</p>
              <p className="text-xs text-sidebar-muted">Material inventory</p>
            </div>
          </div>
          <nav className="px-3 pb-6" aria-label="Main">
            {GROUPS.map((group) => {
              const inGroup = items.filter((i) => i.group === group);
              if (inGroup.length === 0) return null;
              return (
                <div key={group} className="mb-4">
                  <p className="px-3 pb-1 text-[11px] font-semibold tracking-wider text-sidebar-muted uppercase">
                    {group}
                  </p>
                  {inGroup.map((item) =>
                    item.phase ? (
                      <span
                        key={item.href}
                        className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-sidebar-muted/70"
                        title={`Arrives in Phase ${item.phase}`}
                      >
                        {item.label}
                        <span className="text-[10px]">Phase {item.phase}</span>
                      </span>
                    ) : (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setMenuOpen(false)}
                        aria-current={pathname.startsWith(item.href) ? 'page' : undefined}
                        className={cn(
                          'block rounded-lg px-3 py-2 text-sm transition-colors hover:bg-white/10',
                          pathname.startsWith(item.href) &&
                            'bg-white font-medium text-primary shadow-sm hover:bg-white',
                        )}
                      >
                        {item.label}
                      </Link>
                    ),
                  )}
                </div>
              );
            })}
          </nav>
          <div className="mt-auto border-t border-white/10 px-3 py-4">
            <Link
              href="/change-password"
              onClick={() => setMenuOpen(false)}
              className="block rounded-lg px-3 py-2 text-sm text-sidebar-muted transition-colors hover:bg-white/10 hover:text-sidebar-foreground"
            >
              Change password
            </Link>
          </div>
        </aside>
        {menuOpen && (
          <div
            className="fixed inset-0 z-30 bg-sidebar/40 md:hidden"
            onClick={() => setMenuOpen(false)}
          />
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex h-16 items-center gap-2 border-b border-border bg-surface/95 px-3 shadow-sm backdrop-blur sm:gap-3 sm:px-6">
            <Button
              variant="ghost"
              size="sm"
              className="md:hidden"
              onClick={() => setMenuOpen(true)}
              aria-label="Open menu"
            >
              ☰
            </Button>
            {me.memberships.length > 1 ? (
              <Select
                aria-label="Project"
                className="h-8 w-auto max-w-[40vw] text-xs py-1"
                value={membership.projectId}
                onChange={(e) => session.selectProject(e.target.value)}
              >
                {me.memberships.map((m) => (
                  <option key={m.projectId} value={m.projectId}>
                    {m.projectName}
                  </option>
                ))}
              </Select>
            ) : (
              <span className="truncate text-sm font-medium">{membership.projectName}</span>
            )}
            <span className="hidden text-border sm:inline">|</span>
            <StoreSwitcher />
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <div className="relative">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Notifications"
                  aria-expanded={bellOpen}
                  onClick={() => setBellOpen((v) => !v)}
                >
                  🔔
                </Button>
                {bellOpen && (
                  <div className="absolute right-0 mt-2 w-64 rounded-xl border border-border bg-surface p-4 text-sm shadow-lg">
                    <p className="font-medium">Notifications</p>
                    <p className="mt-1 text-muted-foreground">
                      Nothing yet. Low stock and pending approvals will appear here.
                    </p>
                  </div>
                )}
              </div>
              <span
                aria-hidden
                className="hidden size-9 items-center justify-center rounded-full bg-primary-soft text-sm font-semibold text-primary-hover sm:flex"
              >
                {me.user.name.trim().charAt(0).toUpperCase()}
              </span>
              <div className="hidden text-left sm:block">
                <p className="text-sm leading-tight font-medium">{me.user.name}</p>
                <p className="text-xs leading-tight text-muted-foreground">{membership.roleName}</p>
              </div>
              <Link
                href="/change-password"
                className="hidden text-xs text-muted-foreground hover:text-primary hover:underline sm:inline"
              >
                Password
              </Link>
              <Button variant="secondary" size="sm" onClick={() => void session.logout()}>
                Sign out
              </Button>
            </div>
          </header>
          <main className="mx-auto w-full max-w-7xl min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
            {allowed ? (
              children
            ) : (
              <Alert tone="warning" title="Not available">
                Your role ({membership.roleName}) does not include this page.{' '}
                <Badge>{pathname}</Badge>
              </Alert>
            )}
          </main>
        </div>
      </div>
    </StoreProvider>
  );
}

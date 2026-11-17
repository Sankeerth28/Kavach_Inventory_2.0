/**
 * Module boundaries from docs/ARCHITECTURE.md §3.1. Run with `pnpm depcruise`; enforced in CI.
 * @type {import('dependency-cruiser').IConfiguration}
 */
module.exports = {
  forbidden: [
    {
      name: 'worker-never-imports-api',
      comment:
        'AI code must never reach the inventory posting engine (CLAUDE.md AI rules, PRD §22.4).',
      severity: 'error',
      from: { path: '^apps/worker/' },
      to: { path: '^apps/api/' },
    },
    {
      name: 'apps-do-not-import-each-other',
      comment: 'Apps share code only through packages/*.',
      severity: 'error',
      from: { path: '^apps/([^/]+)/' },
      to: { path: '^apps/', pathNot: '^apps/$1/' },
    },
    {
      name: 'inventory-callers-are-allow-listed',
      comment: 'Only invoices, verification and transactions (reversal) may call InventoryService.',
      severity: 'error',
      from: {
        path: '^apps/api/src/modules/',
        pathNot: '^apps/api/src/modules/(inventory|invoices|verification|transactions)/',
      },
      to: { path: '^apps/api/src/modules/inventory/' },
    },
    {
      name: 'shared-is-isolated',
      comment: 'packages/shared is isomorphic with no I/O: it imports no other workspace.',
      severity: 'error',
      from: { path: '^packages/shared/' },
      to: { path: '^(apps|packages/(db|matching|storage|api-client|ai-eval))/' },
    },
    {
      name: 'matching-uses-a-port-not-the-db',
      severity: 'error',
      from: { path: '^packages/matching/' },
      to: { path: '^(apps|packages/(db|storage|api-client))/' },
    },
    {
      name: 'db-imports-only-shared',
      severity: 'error',
      from: { path: '^packages/db/' },
      to: { path: '^(apps|packages/(matching|storage|api-client|ai-eval))/' },
    },
    {
      name: 'api-client-imports-only-shared',
      comment: 'The typed client runs in browsers and on phones: no server code.',
      severity: 'error',
      from: { path: '^packages/api-client/' },
      to: { path: '^(apps|packages/(db|matching|storage|ai-eval))/' },
    },
    {
      name: 'clients-never-import-server-packages',
      comment: 'web and mobile talk to the API; they never touch the DB or matching engine.',
      severity: 'error',
      from: { path: '^apps/(web|mobile)/' },
      to: { path: '^packages/(db|matching|storage)/' },
    },
    {
      name: 'storage-is-a-leaf',
      comment: 'Document storage knows nothing about the domain: it imports no other workspace.',
      severity: 'error',
      from: { path: '^packages/storage/' },
      to: { path: '^(apps|packages/(db|matching|shared|api-client))/' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(node_modules|dist|\\.next|\\.expo|\\.turbo|coverage)/' },
    tsPreCompilationDeps: true,
  },
};

import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { type PrismaClient, addMember, createProject, syncSystemData } from '@kavach/db';
import { type LocationType, type RoleCode, permissionsForRole } from '@kavach/shared';
import { AppModule } from '../app.module';
import { hashPassword } from '../common/auth/password.service';
import type { RequestContext } from '../common/context/request-context';
import { PrismaService } from '../common/prisma/prisma.service';
import { CategoriesService } from '../modules/categories/categories';
import { LocationsService } from '../modules/locations/locations';
import { MaterialsService } from '../modules/materials/materials.service';
import { StoresService } from '../modules/stores/stores';
import { UnitsService } from '../modules/units/units';

/**
 * Demo data for local development: `pnpm db:seed`. Idempotent: a project that already exists is
 * left untouched. Master data is created through the real services, so it is validated,
 * duplicate-checked and audited exactly like data entered in the UI.
 *
 * LOCAL DEMO CREDENTIALS ONLY. Never run this against a production database.
 */
const DEMO_PASSWORD = 'Kavach@123';

interface DemoUser {
  name: string;
  email: string;
  phone?: string;
  role: RoleCode;
  /** Store codes, for Store Managers. */
  stores?: string[];
}

interface DemoMaterial {
  name: string;
  category: string;
  unit: string;
  brand?: string;
  grade?: string;
  size?: string;
  pack?: [size: string, unit: string];
  min?: string;
  variableWeight?: boolean;
}

interface DemoProject {
  code: string;
  name: string;
  address: string;
  extraStores: { code: string; name: string }[];
  users: DemoUser[];
  /** Tower → floors → work areas */
  towers: Record<string, Record<string, string[]>>;
  materials: DemoMaterial[];
}

const tmt = (size: string): DemoMaterial => ({
  name: `TMT Steel Bar ${size}`,
  category: 'Steel',
  unit: 'MT',
  grade: 'Fe 550D',
  min: '2',
  variableWeight: true,
});

const PROJECTS: DemoProject[] = [
  {
    code: 'SKY',
    name: 'Skyline Residency',
    address: 'Survey No. 42, Gachibowli, Hyderabad',
    extraStores: [{ code: 'TWR-B', name: 'Tower B Store' }],
    users: [
      { name: 'Asha Rao', email: 'admin@kavach.local', role: 'PROJECT_ADMIN' },
      {
        name: 'Ravi Kumar',
        email: 'store@kavach.local',
        phone: '9000000001',
        role: 'STORE_MANAGER',
        stores: ['MAIN'],
      },
      {
        name: 'Suresh Babu',
        email: 'store2@kavach.local',
        phone: '9000000002',
        role: 'STORE_MANAGER',
        stores: ['MAIN', 'TWR-B'],
      },
    ],
    towers: {
      'Tower A': { 'Floor 1': ['Flat 101', 'Flat 102'], 'Floor 2': ['Flat 201', 'Flat 202'] },
      'Tower B': { 'Floor 1': ['Flat 101', 'Flat 102'], 'Floor 2': [] },
      'Common Areas': { Basement: ['Parking', 'Pump Room'], 'Club House': [] },
    },
    materials: [
      {
        name: 'OPC Cement 53 Grade',
        category: 'Cement',
        unit: 'BAG',
        pack: ['50', 'KG'],
        min: '200',
      },
      { name: 'PPC Cement', category: 'Cement', unit: 'BAG', pack: ['50', 'KG'], min: '100' },
      { name: 'White Cement', category: 'Cement', unit: 'BAG', pack: ['25', 'KG'] },
      tmt('8mm'),
      tmt('10mm'),
      tmt('12mm'),
      tmt('16mm'),
      tmt('20mm'),
      { name: 'Binding Wire', category: 'Steel', unit: 'KG', min: '50' },
      { name: 'River Sand', category: 'Sand and Aggregate', unit: 'CFT', min: '500' },
      { name: 'Aggregate 20mm', category: 'Sand and Aggregate', unit: 'CFT', min: '500' },
      { name: 'Aggregate 12mm', category: 'Sand and Aggregate', unit: 'CFT' },
      {
        name: 'Red Clay Brick',
        category: 'Bricks and Blocks',
        unit: 'NOS',
        size: '230 x 110 x 75 mm',
        min: '5000',
      },
      { name: 'AAC Block', category: 'Bricks and Blocks', unit: 'NOS', size: '600 x 200 x 150 mm' },
      {
        name: 'Copper Wire 2.5 sqmm',
        category: 'Electrical',
        unit: 'ROLL',
        brand: 'Finolex',
        pack: ['90', 'M'],
      },
      {
        name: 'Copper Wire 1.5 sqmm',
        category: 'Electrical',
        unit: 'ROLL',
        brand: 'Finolex',
        pack: ['90', 'M'],
      },
      { name: 'PVC Conduit Pipe 25mm', category: 'Electrical', unit: 'NOS' },
      { name: 'CPVC Pipe 25mm', category: 'Plumbing', unit: 'M', grade: 'SDR 11' },
      { name: 'PVC Pipe 110mm', category: 'Plumbing', unit: 'M' },
      { name: 'Vitrified Tile 600 x 600 mm', category: 'Tiles and Flooring', unit: 'BOX' },
      {
        name: 'Interior Emulsion White',
        category: 'Paint and Finishing',
        unit: 'L',
        brand: 'Asian Paints',
      },
      { name: 'Wall Putty', category: 'Paint and Finishing', unit: 'BAG', pack: ['40', 'KG'] },
      { name: 'Safety Helmet', category: 'Safety Equipment', unit: 'NOS', min: '20' },
      { name: 'Safety Shoes', category: 'Safety Equipment', unit: 'NOS' },
    ],
  },
  {
    code: 'GRN',
    name: 'Green Valley Villas',
    address: 'Kompally, Hyderabad',
    extraStores: [],
    users: [
      { name: 'Meera Nair', email: 'admin2@kavach.local', role: 'PROJECT_ADMIN' },
      {
        name: 'Imran Khan',
        email: 'store.grn@kavach.local',
        phone: '9000000003',
        role: 'STORE_MANAGER',
        stores: ['MAIN'],
      },
    ],
    towers: { 'Block 1': { 'Villa 1': [], 'Villa 2': [] } },
    materials: [
      { name: 'OPC Cement 43 Grade', category: 'Cement', unit: 'BAG', pack: ['50', 'KG'] },
      tmt('12mm'),
      { name: 'M Sand', category: 'Sand and Aggregate', unit: 'MT' },
    ],
  },
];

async function seedProject(
  app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>>,
  db: PrismaClient,
  passwordHash: string,
  demo: DemoProject,
): Promise<void> {
  if (await db.project.findUnique({ where: { code: demo.code } })) {
    console.log(`  ${demo.code}: already exists, skipped`);
    return;
  }

  // 1. What the operator CLI does: the project and its first admin.
  const project = await db.$transaction((tx) => createProject(tx, demo));
  const userIds = new Map<string, string>();
  for (const u of demo.users) {
    const user = await db.user.upsert({
      where: { email: u.email },
      update: {},
      create: { name: u.name, email: u.email, phone: u.phone ?? null, passwordHash },
    });
    userIds.set(u.email, user.id);
  }
  const adminUser = demo.users.find((u) => u.role === 'PROJECT_ADMIN')!;
  const adminMember = await db.$transaction((tx) =>
    addMember(tx, {
      projectId: project.id,
      userId: userIds.get(adminUser.email)!,
      roleCode: 'PROJECT_ADMIN',
    }),
  );

  // 2. Everything else is done as that admin, through the services.
  const ctx: RequestContext = {
    userId: userIds.get(adminUser.email)!,
    userName: adminUser.name,
    requestId: randomUUID(),
    ip: null,
    userAgent: 'seed',
    projectId: project.id,
    memberId: adminMember.id,
    roleCode: 'PROJECT_ADMIN',
    permissions: new Set(permissionsForRole('PROJECT_ADMIN')),
    storeIds: 'ALL',
  };

  const stores = app.get(StoresService);
  for (const s of demo.extraStores) await stores.create(ctx, { ...s, address: undefined });
  const storeId = new Map((await stores.list(ctx)).map((s) => [s.code, s.id]));

  for (const u of demo.users.filter((x) => x.role === 'STORE_MANAGER')) {
    await db.$transaction((tx) =>
      addMember(tx, {
        projectId: project.id,
        userId: userIds.get(u.email)!,
        roleCode: 'STORE_MANAGER',
        storeIds: (u.stores ?? []).map((code) => storeId.get(code)!),
      }),
    );
  }

  const locations = app.get(LocationsService);
  const add = (name: string, type: LocationType, parentId: string | null) =>
    locations.create(ctx, { name, type, parentId });
  for (const [tower, floors] of Object.entries(demo.towers)) {
    const t = await add(tower, tower.startsWith('Tower') ? 'TOWER' : 'BLOCK', null);
    for (const [floor, areas] of Object.entries(floors)) {
      const f = await add(floor, 'FLOOR', t.id);
      for (const area of areas) await add(area, 'WORK_AREA', f.id);
    }
  }

  const categoryId = new Map(
    (await app.get(CategoriesService).list(ctx)).map((c) => [c.name, c.id]),
  );
  const unitId = new Map((await app.get(UnitsService).listUnits(ctx)).map((u) => [u.code, u.id]));
  const materials = app.get(MaterialsService);
  for (const m of demo.materials) {
    await materials.create(ctx, {
      name: m.name,
      categoryId: categoryId.get(m.category)!,
      stockUnitId: unitId.get(m.unit)!,
      brand: m.brand ?? null,
      grade: m.grade ?? null,
      size: m.size ?? null,
      specification: null,
      description: null,
      subcategoryId: null,
      packSize: m.pack?.[0] ?? null,
      packUnitId: m.pack ? unitId.get(m.pack[1])! : null,
      minimumStock: m.min ?? null,
      isVariableWeight: m.variableWeight ?? false,
      // The demo list is curated: similar names (TMT sizes, cement types) are intended.
      confirmNotDuplicate: true,
    });
  }
  console.log(
    `  ${demo.code}: ${demo.users.length} users, ${storeId.size} stores, ${demo.materials.length} materials`,
  );
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The demo seed has fixed passwords and must not run in production.');
  }
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    // The seed provisions projects and users like the operator CLI, so it needs the plain client.
    const db = app.get(PrismaService).unscoped;
    await syncSystemData(db);
    console.log('System data synced (roles, permissions, units, conversions).');
    const passwordHash = await hashPassword(DEMO_PASSWORD);
    for (const demo of PROJECTS) await seedProject(app, db, passwordHash, demo);
    console.log(`\nDemo logins (password for all: ${DEMO_PASSWORD})`);
    for (const p of PROJECTS) {
      for (const u of p.users) {
        console.log(
          `  ${p.code}  ${u.role.padEnd(13)}  ${u.email}${u.phone ? `  /  ${u.phone}` : ''}`,
        );
      }
    }
  } finally {
    await app.close();
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});

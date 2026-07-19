// Synthetic dev seed. NEVER real data (db.md): obviously-fake names + example.test contacts,
// deterministic UUIDv7s from a fixed sequence so tests and screenshots are reproducible, and
// idempotent (ON CONFLICT DO NOTHING) so re-running never duplicates. It runs as the
// migration/owner role, which bypasses RLS — that is why a plain insert of many farms works.
//
// Phase 1 seeds only the identity & tenancy core: one business, three farms spanning the
// enterprise matrix (livestock / crop / mixed) so the enterprise-adaptive home grid (FR-002,
// FR-017) can be exercised end to end, one owner who is a member of all three, and each
// farm's enterprises. There are NO employees yet (Phase 5), so no SA ID numbers exist to
// (deliberately) fail a checksum here — that rule attaches to the labour seed when it lands.
import pg from 'pg';

const url = process.env.DATABASE_URL ?? 'postgres://werf:werf@localhost:5432/werf';

// Fixed, obviously-synthetic UUIDv7s (version nibble 7, variant 8; padded with zeros).
const ID = {
  business: '01900000-0000-7000-8000-000000000001',
  owner: '01900000-0000-7000-8000-000000000021',
  farmMixed: '01900000-0000-7000-8000-000000000011',
  farmLivestock: '01900000-0000-7000-8000-000000000012',
  farmCrop: '01900000-0000-7000-8000-000000000013',
  fuMixed: '01900000-0000-7000-8000-000000000031',
  fuLivestock: '01900000-0000-7000-8000-000000000032',
  fuCrop: '01900000-0000-7000-8000-000000000033',
};

// Each farm: [id, name, province, enterprise_types[]] — the array drives the whole UI.
const FARMS = [
  [ID.farmMixed, 'Rietfontein', 'Free State', ['beef_cattle', 'row_crops']],
  [ID.farmLivestock, 'Kudu Ranch', 'Northern Cape', ['beef_cattle', 'sheep']],
  [ID.farmCrop, 'Vinkel Lande', 'Western Cape', ['vineyards', 'orchards']],
];

const MEMBERSHIPS = [
  [ID.fuMixed, ID.farmMixed],
  [ID.fuLivestock, ID.farmLivestock],
  [ID.fuCrop, ID.farmCrop],
];

// One enterprise row per declared type: [id, farmId, name, type]. Names are recognisably fake.
const ENTERPRISES = [
  ['01900000-0000-7000-8000-000000000041', ID.farmMixed, 'Beef cattle', 'beef_cattle'],
  ['01900000-0000-7000-8000-000000000042', ID.farmMixed, 'Maize 2026', 'row_crops'],
  ['01900000-0000-7000-8000-000000000043', ID.farmLivestock, 'Beef cattle', 'beef_cattle'],
  ['01900000-0000-7000-8000-000000000044', ID.farmLivestock, 'Dorper flock', 'sheep'],
  ['01900000-0000-7000-8000-000000000045', ID.farmCrop, 'Chardonnay', 'vineyards'],
  ['01900000-0000-7000-8000-000000000046', ID.farmCrop, 'Stone fruit', 'orchards'],
];

const pool = new pg.Pool({ connectionString: url });
const client = await pool.connect();
try {
  await client.query('BEGIN');

  await client.query(
    `INSERT INTO businesses (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
    [ID.business, 'Rietfontein Boerdery (synthetic)'],
  );

  await client.query(
    `INSERT INTO users (id, email, full_name, locale)
     VALUES ($1, $2, $3, 'en-ZA') ON CONFLICT (id) DO NOTHING`,
    [ID.owner, 'test.farmer@example.test', 'Test Farmer'],
  );

  for (const [id, name, province, types] of FARMS) {
    await client.query(
      `INSERT INTO farms (id, business_id, name, province, enterprise_types)
       VALUES ($1, $2, $3, $4, $5::enterprise_type[]) ON CONFLICT (id) DO NOTHING`,
      [id, ID.business, name, province, types],
    );
  }

  for (const [id, farmId] of MEMBERSHIPS) {
    await client.query(
      `INSERT INTO farm_users (id, farm_id, user_id, role)
       VALUES ($1, $2, $3, 'owner') ON CONFLICT (farm_id, user_id) DO NOTHING`,
      [id, farmId, ID.owner],
    );
  }

  for (const [id, farmId, name, type] of ENTERPRISES) {
    await client.query(
      `INSERT INTO enterprises (id, farm_id, name, type)
       VALUES ($1, $2, $3, $4::enterprise_type) ON CONFLICT (id) DO NOTHING`,
      [id, farmId, name, type],
    );
  }

  await client.query('COMMIT');
  console.log('[@werf/db] seeded 1 business, 3 farms (livestock/crop/mixed), 1 owner ✓');
} catch (err) {
  await client.query('ROLLBACK');
  console.error('[@werf/db] seed failed:', err);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}

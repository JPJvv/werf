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

// Veterinary products — regulated REFERENCE data (FR-131), the withdrawal-period source the health
// slice injects FROM (never a number typed into code). Reference data is exactly where these figures
// belong. The names are recognisably synthetic and the withdrawal values are ILLUSTRATIVE — a real
// deployment loads registered products from a maintained source, and every figure has an expiry
// (legal-compliance.md § 0). Shape: [id, name, actives[], species[], meatDays, milkHours, route].
const VET_PRODUCTS = [
  [
    '01900000-0000-7000-8000-000000000051',
    'Synthamycin LA (synthetic)',
    ['oxytetracycline'],
    ['cattle', 'sheep', 'goat'],
    28,
    96,
    'injection_im',
  ],
  [
    '01900000-0000-7000-8000-000000000052',
    'Fictipour Pour-On (synthetic)',
    ['ivermectin'],
    ['cattle'],
    14,
    null, // not registered for lactating dairy → no milk withdrawal figure
    'topical',
  ],
  [
    '01900000-0000-7000-8000-000000000053',
    'Mockvax Clostridial (synthetic)',
    ['clostridial toxoids'],
    ['cattle', 'sheep', 'goat'],
    null, // a zero-withdrawal vaccine
    null,
    'injection_sc',
  ],
  [
    '01900000-0000-7000-8000-000000000054',
    'Tickaway Dip (synthetic)',
    ['amitraz'],
    ['cattle'],
    3,
    null,
    'topical',
  ],
];

// Chemical products — regulated REFERENCE data (FR-204/FR-508), the pre-harvest-interval source the
// crop slice's spray capture injects FROM (never a number typed into code). Same synthetic-data
// discipline as VET_PRODUCTS above, and the SAME production caveat: a real deployment loads
// registered Act 36 of 1947 remedies from a maintained source (STATUS.md's open decision), not this
// seed. Shape: [id, name, registrationNumber, actives[], crop, phiDays, reentryHours].
const CHEMICAL_PRODUCTS = [
  [
    '01900000-0000-7000-8000-000000000061',
    'Cyprodinex 50 WG (synthetic)',
    'L1234 (synthetic)',
    ['cyprodinil'],
    'grapes',
    7,
    12,
  ],
  [
    '01900000-0000-7000-8000-000000000062',
    'Glyfospray 360 (synthetic)',
    'L2345 (synthetic)',
    ['glyphosate'],
    null,
    null, // a burn-down herbicide with no registered PHI on this synthetic row
    24,
  ],
  [
    '01900000-0000-7000-8000-000000000063',
    'Maizeguard Lambda (synthetic)',
    'L3456 (synthetic)',
    ['lambda-cyhalothrin'],
    'maize',
    21,
    24,
  ],
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
      // accepted_at is what makes a membership real: app_user_farm_ids() ignores pending
      // invitations, so without it the seeded owner would log in and see no farms at all.
      // Self-created memberships are accepted on the spot — you are inviting yourself.
      `INSERT INTO farm_users (id, farm_id, user_id, role, accepted_at)
       VALUES ($1, $2, $3, 'owner', now()) ON CONFLICT (farm_id, user_id) DO NOTHING`,
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

  for (const [id, name, actives, species, meatDays, milkHours, route] of VET_PRODUCTS) {
    await client.query(
      `INSERT INTO veterinary_products
         (id, jurisdiction, name, active_ingredients, species,
          meat_withdrawal_days, milk_withdrawal_hours, route, effective_from)
       VALUES ($1, 'ZA', $2, $3::text[], $4::text[], $5, $6, $7, '2020-01-01')
       ON CONFLICT (id) DO NOTHING`,
      [id, name, actives, species, meatDays, milkHours, route],
    );
  }

  for (const [
    id,
    name,
    registrationNumber,
    actives,
    crop,
    phiDays,
    reentryHours,
  ] of CHEMICAL_PRODUCTS) {
    await client.query(
      `INSERT INTO chemical_products
         (id, jurisdiction, name, registration_number, active_ingredients,
          crop, phi_days, reentry_hours, effective_from)
       VALUES ($1, 'ZA', $2, $3, $4::text[], $5, $6, $7, '2020-01-01')
       ON CONFLICT (id) DO NOTHING`,
      [id, name, registrationNumber, actives, crop, phiDays, reentryHours],
    );
  }

  await client.query('COMMIT');
  console.log(
    '[@werf/db] seeded 1 business, 3 farms (livestock/crop/mixed), 1 owner, ' +
      `${VET_PRODUCTS.length} veterinary products, ${CHEMICAL_PRODUCTS.length} chemical products ✓`,
  );
} catch (err) {
  await client.query('ROLLBACK');
  console.error('[@werf/db] seed failed:', err);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}

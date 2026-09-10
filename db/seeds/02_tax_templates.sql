-- =====================================================================
-- OC POS · SEED 02 · Plantillas de impuestos por país
-- El ProfileProvisioner las clona a app.taxes del tenant según su país.
-- =====================================================================

INSERT INTO platform.tax_templates
  (country_code, code, name, rate, kind, applies_to, is_default, metadata)
VALUES
  -- República Dominicana
  ('DO', 'ITBIS_18',  'ITBIS 18%',            0.180000, 'vat',        'both',     true,
   '{"calculation":"inclusive","authority_code":"ITBIS"}'::jsonb),
  ('DO', 'ITBIS_16',  'ITBIS 16% (tasa reducida)', 0.160000, 'vat',   'goods',    false,
   '{"calculation":"inclusive"}'::jsonb),
  ('DO', 'EXENTO',    'Exento de ITBIS',      0.000000, 'exempt',     'both',     false,
   '{"reason":"canasta_basica"}'::jsonb),
  ('DO', 'PROPINA_10','Propina legal 10%',    0.100000, 'tip',        'services', false,
   '{"calculation":"exclusive","applies_to":"restaurante"}'::jsonb),
  ('DO', 'ISC_ALC',   'Impuesto Selectivo — Alcohol', 0.100000, 'excise', 'goods', false,
   '{"calculation":"exclusive"}'::jsonb),

  -- Colombia
  ('CO', 'IVA_19',    'IVA 19%',              0.190000, 'vat',        'both',     true,
   '{"calculation":"inclusive","authority_code":"01"}'::jsonb),
  ('CO', 'IVA_5',     'IVA 5%',               0.050000, 'vat',        'goods',    false,
   '{"calculation":"inclusive","authority_code":"01"}'::jsonb),
  ('CO', 'IVA_0',     'Excluido de IVA',      0.000000, 'exempt',     'both',     false, '{}'::jsonb),
  ('CO', 'INC_8',     'Impuesto al Consumo 8%', 0.080000, 'excise',   'services', false,
   '{"calculation":"exclusive","applies_to":"restaurante"}'::jsonb),
  ('CO', 'RETEFUENTE','Retención en la fuente 2.5%', 0.025000, 'withholding', 'both', false,
   '{"calculation":"exclusive"}'::jsonb),

  -- México
  ('MX', 'IVA_16',    'IVA 16%',              0.160000, 'vat',        'both',     true,
   '{"calculation":"exclusive","authority_code":"002"}'::jsonb),
  ('MX', 'IVA_8',     'IVA 8% (frontera)',    0.080000, 'vat',        'both',     false,
   '{"calculation":"exclusive","authority_code":"002"}'::jsonb),
  ('MX', 'IVA_0',     'IVA Tasa 0%',          0.000000, 'vat',        'goods',    false,
   '{"calculation":"exclusive","authority_code":"002"}'::jsonb),
  ('MX', 'IEPS_8',    'IEPS 8% (alimentos)',  0.080000, 'excise',     'goods',    false,
   '{"calculation":"exclusive","authority_code":"003"}'::jsonb),

  -- Perú
  ('PE', 'IGV_18',    'IGV 18%',              0.180000, 'vat',        'both',     true,
   '{"calculation":"inclusive","authority_code":"1000"}'::jsonb),
  ('PE', 'EXONERADO', 'Exonerado de IGV',     0.000000, 'exempt',     'both',     false, '{}'::jsonb),
  ('PE', 'ICBPER',    'Impuesto a la bolsa plástica', 0.000000, 'excise', 'goods', false,
   '{"calculation":"exclusive","fixed_amount_per_unit":0.50}'::jsonb),

  -- Ecuador
  ('EC', 'IVA_15',    'IVA 15%',              0.150000, 'vat',        'both',     true,
   '{"calculation":"exclusive"}'::jsonb),
  ('EC', 'IVA_0',     'IVA 0%',               0.000000, 'vat',        'both',     false,
   '{"calculation":"exclusive"}'::jsonb),

  -- Guatemala
  ('GT', 'IVA_12',    'IVA 12%',              0.120000, 'vat',        'both',     true,
   '{"calculation":"inclusive"}'::jsonb),
  ('GT', 'EXENTO',    'Exento de IVA',        0.000000, 'exempt',     'both',     false, '{}'::jsonb),

  -- Panamá
  ('PA', 'ITBMS_7',   'ITBMS 7%',             0.070000, 'vat',        'both',     true,
   '{"calculation":"exclusive"}'::jsonb),
  ('PA', 'ITBMS_10',  'ITBMS 10% (alcohol)',  0.100000, 'vat',        'goods',    false,
   '{"calculation":"exclusive"}'::jsonb),
  ('PA', 'EXENTO',    'Exento de ITBMS',      0.000000, 'exempt',     'both',     false, '{}'::jsonb),

  -- Estados Unidos: el sales tax es estatal/municipal; el tenant lo configura.
  ('US', 'NO_TAX',    'Sin impuesto',         0.000000, 'exempt',     'both',     true, '{}'::jsonb),
  ('US', 'SALES_TAX', 'Sales Tax (configurable)', 0.000000, 'sales_tax', 'both',  false,
   '{"calculation":"exclusive","configurable_by_tenant":true}'::jsonb)

ON CONFLICT (country_code, code) DO UPDATE
  SET name = EXCLUDED.name,
      rate = EXCLUDED.rate,
      kind = EXCLUDED.kind,
      applies_to = EXCLUDED.applies_to,
      is_default = EXCLUDED.is_default,
      metadata = EXCLUDED.metadata;

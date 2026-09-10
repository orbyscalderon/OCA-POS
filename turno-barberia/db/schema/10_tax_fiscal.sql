-- =====================================================================
-- OC POS · 10 · Motor de Impuestos y Comprobantes Fiscales Dinámicos
-- =====================================================================
-- Objetivo: soportar ITBIS (DO), IVA (CO/MX/PE), Sales Tax (US) y la
-- facturacion electronica de cada pais SIN ramificar el codigo por pais.
-- Todo es data: platform.countries.fiscal_config + app.fiscal_document_types.
-- =====================================================================

CREATE TABLE app.taxes (
  id            uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id     uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  code          text NOT NULL,                      -- ITBIS_18, IVA_19, EXENTO
  name          text NOT NULL,
  rate          app.rate NOT NULL,
  kind          text NOT NULL DEFAULT 'vat'
                CHECK (kind IN ('vat','sales_tax','excise','withholding','tip','exempt')),
  -- 'inclusive' -> el precio de lista YA trae el impuesto (LatAm retail)
  -- 'exclusive' -> se suma al precio (US)
  calculation   text NOT NULL DEFAULT 'inclusive'
                CHECK (calculation IN ('inclusive','exclusive')),
  -- Impuesto que se calcula sobre (precio + otro impuesto)
  compound_on   uuid REFERENCES app.taxes(id),
  -- Codigo que exige la autoridad en el XML/JSON de factura electronica
  authority_code text,
  is_default    boolean NOT NULL DEFAULT false,
  is_active     boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, code)
);

-- Un grupo agrupa 1..N impuestos (ej. IVA + impuesto al consumo)
CREATE TABLE app.tax_groups (
  id         uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id  uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  code       text NOT NULL,
  name       text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  UNIQUE (tenant_id, code)
);

CREATE TABLE app.tax_group_items (
  tax_group_id uuid NOT NULL REFERENCES app.tax_groups(id) ON DELETE CASCADE,
  tax_id       uuid NOT NULL REFERENCES app.taxes(id) ON DELETE CASCADE,
  tenant_id    uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  position     smallint NOT NULL DEFAULT 0,
  PRIMARY KEY (tax_group_id, tax_id)
);

ALTER TABLE app.products          ADD CONSTRAINT products_taxgroup_fk
  FOREIGN KEY (tax_group_id) REFERENCES app.tax_groups(id);
ALTER TABLE app.categories        ADD CONSTRAINT categories_taxgroup_fk
  FOREIGN KEY (tax_group_id) REFERENCES app.tax_groups(id);
ALTER TABLE app.sale_lines        ADD CONSTRAINT salelines_taxgroup_fk
  FOREIGN KEY (tax_group_id) REFERENCES app.tax_groups(id);
ALTER TABLE app.purchase_order_lines ADD CONSTRAINT polines_taxgroup_fk
  FOREIGN KEY (tax_group_id) REFERENCES app.tax_groups(id);

-- Excepciones: exoneracion por cliente (ONG, zona franca) o por sucursal
CREATE TABLE app.tax_exemptions (
  id           uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id    uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  customer_id  uuid REFERENCES app.customers(id) ON DELETE CASCADE,
  branch_id    uuid REFERENCES app.branches(id) ON DELETE CASCADE,
  tax_id       uuid REFERENCES app.taxes(id) ON DELETE CASCADE,
  certificate_number text,
  valid_from   date,
  valid_to     date,
  reason       text
);

-- ---------------------------------------------------------------------
-- ★ TIPOS DE COMPROBANTE FISCAL — parametrizables por pais
-- DO: B01 Credito Fiscal, B02 Consumidor Final, B04 Nota de Credito
-- MX: CFDI I/E/P     CO: Factura Electronica / POS
-- ---------------------------------------------------------------------
CREATE TABLE app.fiscal_document_types (
  id            uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id     uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  code          text NOT NULL,                      -- 'B02'
  name          text NOT NULL,                      -- 'Consumidor Final'
  document_class text NOT NULL CHECK (document_class IN
                ('invoice','credit_note','debit_note','receipt','quote',
                 'delivery_note','purchase_invoice','payment_receipt')),
  -- Reglas declarativas que el motor valida antes de emitir:
  -- {"requires_customer_tax_id":true,"max_amount":250000,
  --  "requires_customer_name":true,"allows_credit":true}
  rules         jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Plantilla de impresion ESC/POS y de PDF/A
  print_template text,
  -- Facturacion electronica
  einvoice_enabled boolean NOT NULL DEFAULT false,
  einvoice_standard text,                           -- 'e-CF','CFDI 4.0','UBL 2.1'
  is_default    boolean NOT NULL DEFAULT false,
  is_active     boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, code)
);

-- ---------------------------------------------------------------------
-- ★ SECUENCIAS FISCALES CON BLOQUES POR DISPOSITIVO
-- Problema: 3 cajas offline no pueden pedirle el siguiente numero al
-- servidor. Solucion: a cada dispositivo se le PRE-ASIGNA un rango
-- disjunto del talonario autorizado. Nunca hay colision ni salto ilegal.
-- ---------------------------------------------------------------------
CREATE TABLE app.fiscal_sequences (
  id             uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id      uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  branch_id      uuid REFERENCES app.branches(id),
  document_type_id uuid NOT NULL REFERENCES app.fiscal_document_types(id) ON DELETE CASCADE,
  prefix         text NOT NULL DEFAULT '',          -- 'B02'
  padding        smallint NOT NULL DEFAULT 8,
  -- Rango autorizado por la autoridad tributaria
  range_from     bigint NOT NULL,
  range_to       bigint NOT NULL,
  next_number    bigint NOT NULL,
  authorization_code text,                          -- num. de autorizacion
  valid_until    date,
  -- Umbral para alertar "se te acaban los comprobantes"
  alert_threshold int NOT NULL DEFAULT 100,
  status         text NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','exhausted','expired','revoked')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (range_to >= range_from)
);

-- Bloque reservado a un dispositivo para operar OFFLINE
CREATE TABLE app.fiscal_sequence_blocks (
  id            uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id     uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  sequence_id   uuid NOT NULL REFERENCES app.fiscal_sequences(id) ON DELETE CASCADE,
  device_id     uuid NOT NULL REFERENCES app.devices(id) ON DELETE CASCADE,
  block_from    bigint NOT NULL,
  block_to      bigint NOT NULL,
  next_number   bigint NOT NULL,
  assigned_at   timestamptz NOT NULL DEFAULT now(),
  exhausted_at  timestamptz,
  released_at   timestamptz,
  status        text NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','exhausted','released')),
  -- Dos bloques del mismo talonario no pueden solaparse. btree_gist hace
  -- que la BD lo garantice; no depende de la logica de aplicacion.
  EXCLUDE USING gist (
    sequence_id WITH =,
    int8range(block_from, block_to, '[]') WITH &&
  ) WHERE (status <> 'released')
);
CREATE INDEX ON app.fiscal_sequence_blocks (tenant_id, device_id, status);

-- Reserva atomica de un bloque nuevo para un dispositivo
CREATE OR REPLACE FUNCTION app.allocate_fiscal_block(
  p_sequence_id uuid, p_device_id uuid, p_size int DEFAULT 200
) RETURNS app.fiscal_sequence_blocks
LANGUAGE plpgsql AS $fn$
DECLARE
  s   app.fiscal_sequences%ROWTYPE;
  blk app.fiscal_sequence_blocks%ROWTYPE;
  v_from bigint;
  v_to   bigint;
BEGIN
  SELECT * INTO s FROM app.fiscal_sequences WHERE id = p_sequence_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Secuencia fiscal % inexistente', p_sequence_id;
  END IF;
  IF s.status <> 'active' THEN
    RAISE EXCEPTION 'Secuencia fiscal % en estado %', s.prefix, s.status;
  END IF;

  v_from := s.next_number;
  v_to   := LEAST(s.next_number + p_size - 1, s.range_to);
  IF v_from > s.range_to THEN
    UPDATE app.fiscal_sequences SET status = 'exhausted' WHERE id = s.id;
    RAISE EXCEPTION 'Talonario % agotado (rango % - %)', s.prefix, s.range_from, s.range_to;
  END IF;

  INSERT INTO app.fiscal_sequence_blocks
    (tenant_id, sequence_id, device_id, block_from, block_to, next_number)
  VALUES (s.tenant_id, s.id, p_device_id, v_from, v_to, v_from)
  RETURNING * INTO blk;

  UPDATE app.fiscal_sequences SET next_number = v_to + 1 WHERE id = s.id;
  RETURN blk;
END $fn$;

-- ---------------------------------------------------------------------
-- ★ COMPROBANTE EMITIDO
-- ---------------------------------------------------------------------
CREATE TABLE app.fiscal_documents (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  branch_id       uuid NOT NULL REFERENCES app.branches(id),
  document_type_id uuid NOT NULL REFERENCES app.fiscal_document_types(id),
  sequence_id     uuid REFERENCES app.fiscal_sequences(id),
  block_id        uuid REFERENCES app.fiscal_sequence_blocks(id),
  device_id       uuid REFERENCES app.devices(id),

  number          bigint NOT NULL,
  full_number     text NOT NULL,                    -- 'B0200000431'

  sale_id         uuid REFERENCES app.sales(id),
  sale_return_id  uuid REFERENCES app.sale_returns(id),
  credit_movement_id uuid REFERENCES app.credit_movements(id),
  -- Comprobante que modifica (nota de credito -> factura original)
  references_document_id uuid REFERENCES app.fiscal_documents(id),

  -- Snapshot del receptor (los datos NO deben cambiar si el cliente se edita)
  customer_id     uuid REFERENCES app.customers(id),
  customer_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  issuer_snapshot   jsonb NOT NULL DEFAULT '{}'::jsonb,

  issue_date      date NOT NULL,
  currency_code   char(3) NOT NULL,
  subtotal        app.money NOT NULL,
  tax_total       app.money NOT NULL,
  total           app.money NOT NULL,
  tax_breakdown   jsonb NOT NULL DEFAULT '[]'::jsonb,

  status          text NOT NULL DEFAULT 'issued'
                  CHECK (status IN ('issued','submitted','accepted','rejected','canceled','contingency')),
  -- Emitido offline: se transmite a la autoridad al recuperar conexion
  is_contingency  boolean NOT NULL DEFAULT false,
  issued_at       timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, document_type_id, number)
);
CREATE INDEX ON app.fiscal_documents (tenant_id, issue_date DESC);
CREATE INDEX ON app.fiscal_documents (tenant_id, status) WHERE status IN ('issued','contingency','rejected');

ALTER TABLE app.sales        ADD CONSTRAINT sales_fiscaldoc_fk
  FOREIGN KEY (fiscal_document_id) REFERENCES app.fiscal_documents(id);
ALTER TABLE app.sale_returns ADD CONSTRAINT returns_fiscaldoc_fk
  FOREIGN KEY (fiscal_document_id) REFERENCES app.fiscal_documents(id);

-- Envio a la autoridad (DGII, SAT, DIAN, SUNAT)
CREATE TABLE app.einvoice_submissions (
  id            uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id     uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  document_id   uuid NOT NULL REFERENCES app.fiscal_documents(id) ON DELETE CASCADE,
  provider      text NOT NULL,                      -- PAC / proveedor autorizado
  payload_xml   text,
  payload_json  jsonb,
  signature     text,
  authority_uuid text,                              -- folio fiscal / TrackId
  qr_data       text,
  status        text NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued','sent','accepted','rejected','error')),
  response      jsonb,
  error_message text,
  attempts      smallint NOT NULL DEFAULT 0,
  sent_at       timestamptz,
  resolved_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON app.einvoice_submissions (tenant_id, status);

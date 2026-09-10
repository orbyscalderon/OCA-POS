-- =====================================================================
-- OC POS · 13 · Tienda Online / Catálogo Web Automático
-- =====================================================================
-- Cada tenant obtiene una tienda publicada en tienda.ocpos.app/{slug}
-- sincronizada con el MISMO inventario del POS (misma tabla, sin ETL).
-- =====================================================================

CREATE TABLE app.storefronts (
  id            uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id     uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  slug          text NOT NULL UNIQUE,
  custom_domain text UNIQUE,
  branch_id     uuid REFERENCES app.branches(id),   -- sucursal que despacha
  warehouse_id  uuid REFERENCES app.warehouses(id), -- stock que publica
  price_list_id uuid REFERENCES app.price_lists(id),
  title         text NOT NULL,
  description   text,
  -- Tema y layout generados desde el perfil de negocio
  -- {"template":"grid","primary_color":"#16A34A","hero_image":"...",
  --  "show_stock":true,"show_prices":true,"catalog_only":false}
  theme         jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Como se cierra el pedido
  checkout_mode text NOT NULL DEFAULT 'whatsapp'
                CHECK (checkout_mode IN ('whatsapp','gateway','both','quote_only')),
  whatsapp_e164 text,
  -- Metodos de pago online habilitados
  payment_providers jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Horario de atencion y reglas de pedido minimo
  business_hours jsonb NOT NULL DEFAULT '{}'::jsonb,
  min_order_amount app.money,
  seo           jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_published  boolean NOT NULL DEFAULT false,
  published_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER touch BEFORE UPDATE ON app.storefronts
  FOR EACH ROW EXECUTE FUNCTION app.tg_touch_updated_at();

-- Overrides de publicacion por producto (por defecto se publica todo lo
-- que sea is_sellable y tenga precio > 0)
CREATE TABLE app.storefront_products (
  id            uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id     uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  storefront_id uuid NOT NULL REFERENCES app.storefronts(id) ON DELETE CASCADE,
  product_id    uuid NOT NULL REFERENCES app.products(id) ON DELETE CASCADE,
  is_visible    boolean NOT NULL DEFAULT true,
  is_featured   boolean NOT NULL DEFAULT false,
  online_title  text,
  online_description text,
  position      smallint NOT NULL DEFAULT 0,
  UNIQUE (storefront_id, product_id)
);

CREATE TABLE app.delivery_zones (
  id            uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id     uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  storefront_id uuid NOT NULL REFERENCES app.storefronts(id) ON DELETE CASCADE,
  name          text NOT NULL,
  fee           app.money NOT NULL DEFAULT 0,
  free_over     app.money,
  eta_minutes   smallint,
  -- Poligono o lista de sectores/codigos postales
  coverage      jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active     boolean NOT NULL DEFAULT true
);

-- ---------------------------------------------------------------------
-- PEDIDOS ONLINE. Al aceptarse se convierten en app.sales (canal
-- 'storefront') reutilizando todo el motor de precios, impuestos y stock.
-- ---------------------------------------------------------------------
CREATE TABLE app.online_orders (
  id             uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id      uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  storefront_id  uuid NOT NULL REFERENCES app.storefronts(id),
  code           text NOT NULL,
  customer_id    uuid REFERENCES app.customers(id),
  -- Datos del comprador sin registro
  guest_name     text,
  guest_phone    text,
  guest_email    citext,
  fulfillment    text NOT NULL DEFAULT 'pickup'
                 CHECK (fulfillment IN ('pickup','delivery','shipping')),
  delivery_zone_id uuid REFERENCES app.delivery_zones(id),
  delivery_address jsonb,
  subtotal       app.money NOT NULL DEFAULT 0,
  delivery_fee   app.money NOT NULL DEFAULT 0,
  discount_total app.money NOT NULL DEFAULT 0,
  tax_total      app.money NOT NULL DEFAULT 0,
  total          app.money NOT NULL DEFAULT 0,
  payment_status text NOT NULL DEFAULT 'pending'
                 CHECK (payment_status IN ('pending','paid','failed','refunded','on_delivery')),
  payment_link_id uuid REFERENCES app.payment_links(id),
  status         text NOT NULL DEFAULT 'new'
                 CHECK (status IN ('new','confirmed','preparing','ready','dispatched',
                                   'delivered','canceled','rejected')),
  -- Reserva de stock mientras el pedido esta vivo (qty_reserved)
  stock_reserved boolean NOT NULL DEFAULT false,
  sale_id        uuid REFERENCES app.sales(id),
  customer_note  text,
  internal_note  text,
  placed_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);
CREATE INDEX ON app.online_orders (tenant_id, status, placed_at DESC);

CREATE TABLE app.online_order_lines (
  id           uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id    uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  order_id     uuid NOT NULL REFERENCES app.online_orders(id) ON DELETE CASCADE,
  variant_id   uuid NOT NULL REFERENCES app.product_variants(id),
  packaging_id uuid REFERENCES app.product_packagings(id),
  name_snapshot text NOT NULL,
  qty          app.qty NOT NULL,
  qty_in_base  app.qty NOT NULL,
  unit_price   app.money NOT NULL,
  line_total   app.money NOT NULL,
  note         text
);

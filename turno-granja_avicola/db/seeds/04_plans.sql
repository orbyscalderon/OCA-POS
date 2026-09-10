-- =====================================================================
-- OC POS · SEED 04 · Planes de suscripción
-- `limits` lo verifica PlanLimitGuard; `features` enciende módulos.
-- Un límite en null significa ilimitado.
-- =====================================================================

INSERT INTO platform.plans
  (code, name, price_monthly, price_yearly, currency_code, limits, features, is_active)
VALUES
  ('free', 'Gratis', 0, 0, 'USD',
   '{"branches":1,"users":2,"devices":1,"products":300,"customers":200,
     "whatsapp_msgs_month":0,"storage_mb":100,"history_days":90}'::jsonb,
   '{"pos":true,"inventory":true,"credit":true,"cash":true,"reports_basic":true,
     "storefront":false,"einvoice":false,"agro":false,"multi_branch":false,
     "loyalty":false,"api":false,"offline":true,"support":"community"}'::jsonb,
   true),

  ('pro', 'Pro', 14.99, 149.00, 'USD',
   '{"branches":1,"users":5,"devices":3,"products":3000,"customers":5000,
     "whatsapp_msgs_month":500,"storage_mb":2000,"history_days":730}'::jsonb,
   '{"pos":true,"inventory":true,"credit":true,"cash":true,"reports_basic":true,
     "reports_advanced":true,"storefront":true,"einvoice":false,"agro":false,
     "multi_branch":false,"loyalty":true,"appointments":true,"tables":true,
     "service_orders":true,"api":false,"offline":true,"support":"email"}'::jsonb,
   true),

  ('business', 'Business', 39.99, 399.00, 'USD',
   '{"branches":5,"users":20,"devices":10,"products":null,"customers":null,
     "whatsapp_msgs_month":3000,"storage_mb":20000,"history_days":null}'::jsonb,
   '{"pos":true,"inventory":true,"credit":true,"cash":true,"reports_basic":true,
     "reports_advanced":true,"storefront":true,"einvoice":true,"agro":true,
     "multi_branch":true,"loyalty":true,"appointments":true,"tables":true,
     "service_orders":true,"lending":true,"forecasting":true,"api":true,
     "offline":true,"support":"priority"}'::jsonb,
   true),

  ('enterprise', 'Enterprise', 0, 0, 'USD',
   '{"branches":null,"users":null,"devices":null,"products":null,"customers":null,
     "whatsapp_msgs_month":null,"storage_mb":null,"history_days":null}'::jsonb,
   '{"pos":true,"inventory":true,"credit":true,"cash":true,"reports_basic":true,
     "reports_advanced":true,"storefront":true,"einvoice":true,"agro":true,
     "multi_branch":true,"loyalty":true,"appointments":true,"tables":true,
     "service_orders":true,"lending":true,"forecasting":true,"api":true,
     "offline":true,"dedicated_db":true,"sso":true,"sla":true,
     "custom_profiles":true,"support":"dedicated"}'::jsonb,
   true)

ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name,
      price_monthly = EXCLUDED.price_monthly,
      price_yearly = EXCLUDED.price_yearly,
      limits = EXCLUDED.limits,
      features = EXCLUDED.features,
      is_active = EXCLUDED.is_active;

-- Precio de excedente por métrica, usado por platform.usage_counters
-- cuando el tenant supera lo incluido en su plan.
COMMENT ON TABLE platform.plans IS
  'Los excedentes se cobran vía subscription_invoice_lines con kind=overage. '
  'Referencia: whatsapp_msgs 0.01 USD/msj, storage 0.10 USD/GB/mes.';

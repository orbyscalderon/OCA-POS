-- =====================================================================
-- OC POS · SEED 05 · Biblioteca de plantillas de mensajería
-- El ProfileProvisioner clona a app.message_templates las plantillas cuyo
-- profile_slugs esté vacío (todas) o incluya el perfil del tenant.
-- Los marcadores {{n}} se resuelven con `variables`.
-- =====================================================================

INSERT INTO platform.message_template_library
  (code, name, purpose, category, language, country_code,
   header_kind, header_text, body_text, footer_text, buttons, variables, profile_slugs)
VALUES

-- ── Cobranza ─────────────────────────────────────────────────────────
('collection_due_soon', 'Recordatorio antes del vencimiento', 'collection', 'utility', 'es', NULL,
 'text', 'Recordatorio de pago',
 'Hola {{1}} 👋. Te recordamos que tu pago de {{2}} vence el {{3}}. Puedes pagar desde este enlace o pasar por el negocio. ¡Gracias!',
 'Enviado por {{4}}',
 '[{"kind":"url","label":"Pagar ahora","url":"{{1}}"}]'::jsonb,
 '[{"index":1,"source":"customer.full_name"},
   {"index":2,"source":"account.balance","format":"money"},
   {"index":3,"source":"account.due_date","format":"date"},
   {"index":4,"source":"tenant.trade_name"}]'::jsonb,
 '{}'),

('collection_overdue', 'Aviso de saldo vencido', 'collection', 'utility', 'es', NULL,
 'text', 'Saldo pendiente',
 'Hola {{1}}. Tu saldo de {{2}} venció hace {{3}} días. Si ya pagaste, ignora este mensaje. Si necesitas un acuerdo de pago, respóndenos por aquí.',
 NULL,
 '[{"kind":"url","label":"Pagar ahora","url":"{{1}}"},{"kind":"quick_reply","label":"Ya pagué"}]'::jsonb,
 '[{"index":1,"source":"customer.full_name"},
   {"index":2,"source":"account.balance","format":"money"},
   {"index":3,"source":"account.days_overdue"}]'::jsonb,
 '{}'),

('payment_received', 'Confirmación de abono', 'collection', 'utility', 'es', NULL,
 NULL, NULL,
 'Recibimos tu abono de {{1}}. Tu saldo pendiente ahora es {{2}}. ¡Gracias, {{3}}!',
 'Comprobante {{4}}',
 '[]'::jsonb,
 '[{"index":1,"source":"movement.amount","format":"money"},
   {"index":2,"source":"account.balance","format":"money"},
   {"index":3,"source":"customer.full_name"},
   {"index":4,"source":"movement.receipt_number"}]'::jsonb,
 '{}'),

-- ── Facturación ──────────────────────────────────────────────────────
('invoice_sent', 'Envío de factura digital', 'invoice', 'utility', 'es', NULL,
 'document', 'Tu factura',
 'Hola {{1}}, adjuntamos tu comprobante {{2}} por {{3}}. ¡Gracias por tu compra en {{4}}!',
 NULL,
 '[]'::jsonb,
 '[{"index":1,"source":"customer.full_name"},
   {"index":2,"source":"document.full_number"},
   {"index":3,"source":"sale.total","format":"money"},
   {"index":4,"source":"tenant.trade_name"}]'::jsonb,
 '{}'),

-- ── Citas ────────────────────────────────────────────────────────────
('appointment_reminder', 'Recordatorio de cita', 'appointment_reminder', 'utility', 'es', NULL,
 'text', 'Tu cita se acerca',
 'Hola {{1}} 👋. Te esperamos el {{2}} a las {{3}} con {{4}}. Si necesitas reprogramar, avísanos por aquí.',
 '{{5}}',
 '[{"kind":"quick_reply","label":"Confirmar"},{"kind":"quick_reply","label":"Reprogramar"}]'::jsonb,
 '[{"index":1,"source":"customer.full_name"},
   {"index":2,"source":"appointment.starts_at","format":"date"},
   {"index":3,"source":"appointment.starts_at","format":"time"},
   {"index":4,"source":"employee.full_name"},
   {"index":5,"source":"tenant.contact.address"}]'::jsonb,
 '{barberia,taller}'),

('rebooking_nudge', 'Invitación a volver', 'promo', 'marketing', 'es', NULL,
 NULL, NULL,
 'Hola {{1}}, ya pasaron {{2}} semanas desde tu última visita a {{3}}. ¿Agendamos tu próxima cita?',
 'Responde STOP para no recibir más promociones',
 '[{"kind":"url","label":"Reservar","url":"{{1}}"}]'::jsonb,
 '[{"index":1,"source":"customer.full_name"},
   {"index":2,"source":"customer.weeks_since_last_visit"},
   {"index":3,"source":"tenant.trade_name"}]'::jsonb,
 '{barberia}'),

-- ── Pedidos online ───────────────────────────────────────────────────
('order_status', 'Cambio de estado del pedido', 'order_status', 'utility', 'es', NULL,
 NULL, NULL,
 'Tu pedido {{1}} está {{2}}. Total: {{3}}. Cualquier duda respóndenos por aquí.',
 NULL,
 '[]'::jsonb,
 '[{"index":1,"source":"order.code"},
   {"index":2,"source":"order.status_label"},
   {"index":3,"source":"order.total","format":"money"}]'::jsonb,
 '{}'),

-- ── Operación interna (al dueño) ─────────────────────────────────────
('low_stock_owner', 'Alerta de stock bajo', 'low_stock', 'utility', 'es', NULL,
 'text', 'Stock bajo',
 '⚠️ {{1}} quedó en {{2}} unidades (mínimo: {{3}}) en {{4}}.',
 NULL,
 '[]'::jsonb,
 '[{"index":1,"source":"product.name"},
   {"index":2,"source":"balance.qty_on_hand"},
   {"index":3,"source":"product.reorder_point"},
   {"index":4,"source":"warehouse.name"}]'::jsonb,
 '{}'),

('daily_summary_owner', 'Resumen del día', 'daily_summary', 'utility', 'es', NULL,
 'text', 'Cierre del día',
 'Resumen de {{1}}:\n💰 Ventas: {{2}}\n🧾 Tickets: {{3}}\n📊 Ticket promedio: {{4}}\n📕 Fiado del día: {{5}}\n💵 Efectivo en caja: {{6}}',
 NULL,
 '[]'::jsonb,
 '[{"index":1,"source":"date","format":"date"},
   {"index":2,"source":"summary.sales_total","format":"money"},
   {"index":3,"source":"summary.tickets"},
   {"index":4,"source":"summary.avg_ticket","format":"money"},
   {"index":5,"source":"summary.credit_total","format":"money"},
   {"index":6,"source":"summary.counted_cash","format":"money"}]'::jsonb,
 '{}'),

-- ── Agro ─────────────────────────────────────────────────────────────
('agro_high_mortality', 'Alerta de mortalidad alta', 'low_stock', 'utility', 'es', NULL,
 'text', '🚨 Mortalidad elevada',
 'Lote {{1}} ({{2}}): {{3}} bajas hoy, {{4}}% del lote. Mortalidad acumulada: {{5}}%. Revisa el galpón.',
 NULL,
 '[]'::jsonb,
 '[{"index":1,"source":"lot.code"},
   {"index":2,"source":"farm_unit.name"},
   {"index":3,"source":"record.losses"},
   {"index":4,"source":"record.daily_pct"},
   {"index":5,"source":"lot.mortality_pct"}]'::jsonb,
 '{granja_avicola}'),

('agro_missing_daily', 'Registro diario pendiente', 'daily_summary', 'utility', 'es', NULL,
 NULL, NULL,
 'No se ha registrado la jornada de hoy del lote {{1}}. Recuerda anotar bajas, alimento y producción antes de cerrar el día.',
 NULL,
 '[]'::jsonb,
 '[{"index":1,"source":"lot.code"}]'::jsonb,
 '{granja_avicola}'),

-- ── Seguridad ────────────────────────────────────────────────────────
('otp_login', 'Código de verificación', 'otp', 'authentication', 'es', NULL,
 NULL, NULL,
 'Tu código de acceso a {{1}} es {{2}}. Vence en 10 minutos. No lo compartas con nadie.',
 'Nunca te pediremos este código por teléfono',
 '[]'::jsonb,
 '[{"index":1,"source":"tenant.trade_name"},{"index":2,"source":"otp.code"}]'::jsonb,
 '{}')

ON CONFLICT (code, language, country_code) DO UPDATE
  SET name = EXCLUDED.name,
      body_text = EXCLUDED.body_text,
      footer_text = EXCLUDED.footer_text,
      buttons = EXCLUDED.buttons,
      variables = EXCLUDED.variables,
      profile_slugs = EXCLUDED.profile_slugs;

-- =====================================================================
-- OC POS · SEED 01 · Países y localización fiscal
-- Idempotente: se puede reejecutar sin duplicar.
-- =====================================================================

INSERT INTO platform.countries
  (code, name, currency_code, currency_symbol, decimal_places, phone_prefix,
   timezone_default, fiscal_config)
VALUES
  ('DO', 'República Dominicana', 'DOP', 'RD$', 2, '+1', 'America/Santo_Domingo',
   '{"tax_label":"ITBIS","tax_id_label":"RNC","tax_id_regex":"^([0-9]{9}|[0-9]{11})$",
     "authority":"DGII","prices_include_tax":true,
     "rounding":{"mode":"half_up","precision":2},
     "einvoice":{"required":false,"standard":"e-CF","authority":"DGII","phase_in":"2026"},
     "document_types":[
       {"code":"B01","name":"Crédito Fiscal","class":"invoice","requires_tax_id":true},
       {"code":"B02","name":"Consumidor Final","class":"invoice","requires_tax_id":false,"max_amount":250000},
       {"code":"B04","name":"Nota de Crédito","class":"credit_note"},
       {"code":"B14","name":"Régimen Especial","class":"invoice"},
       {"code":"B15","name":"Gubernamental","class":"invoice"}]}'::jsonb),

  ('CO', 'Colombia', 'COP', '$', 2, '+57', 'America/Bogota',
   '{"tax_label":"IVA","tax_id_label":"NIT","tax_id_regex":"^[0-9]{9,10}(-[0-9])?$",
     "authority":"DIAN","prices_include_tax":true,
     "rounding":{"mode":"half_up","precision":2},
     "einvoice":{"required":true,"standard":"UBL 2.1","authority":"DIAN"},
     "document_types":[
       {"code":"FE","name":"Factura Electrónica","class":"invoice","requires_tax_id":true},
       {"code":"POS","name":"Documento POS","class":"receipt","max_amount":5000000},
       {"code":"NC","name":"Nota Crédito","class":"credit_note"},
       {"code":"ND","name":"Nota Débito","class":"debit_note"}]}'::jsonb),

  ('MX', 'México', 'MXN', '$', 2, '+52', 'America/Mexico_City',
   '{"tax_label":"IVA","tax_id_label":"RFC","tax_id_regex":"^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$",
     "authority":"SAT","prices_include_tax":false,
     "rounding":{"mode":"half_up","precision":2},
     "einvoice":{"required":true,"standard":"CFDI 4.0","authority":"SAT"},
     "document_types":[
       {"code":"I","name":"Ingreso","class":"invoice","requires_tax_id":true},
       {"code":"E","name":"Egreso","class":"credit_note"},
       {"code":"P","name":"Pago","class":"payment_receipt"}]}'::jsonb),

  ('PE', 'Perú', 'PEN', 'S/', 2, '+51', 'America/Lima',
   '{"tax_label":"IGV","tax_id_label":"RUC","tax_id_regex":"^(10|20)[0-9]{9}$",
     "authority":"SUNAT","prices_include_tax":true,
     "rounding":{"mode":"half_up","precision":2},
     "einvoice":{"required":true,"standard":"UBL 2.1","authority":"SUNAT"},
     "document_types":[
       {"code":"01","name":"Factura","class":"invoice","requires_tax_id":true},
       {"code":"03","name":"Boleta de Venta","class":"receipt"},
       {"code":"07","name":"Nota de Crédito","class":"credit_note"},
       {"code":"08","name":"Nota de Débito","class":"debit_note"}]}'::jsonb),

  ('EC', 'Ecuador', 'USD', '$', 2, '+593', 'America/Guayaquil',
   '{"tax_label":"IVA","tax_id_label":"RUC","tax_id_regex":"^[0-9]{13}$",
     "authority":"SRI","prices_include_tax":false,
     "rounding":{"mode":"half_up","precision":2},
     "einvoice":{"required":true,"standard":"XML SRI","authority":"SRI"},
     "document_types":[
       {"code":"01","name":"Factura","class":"invoice"},
       {"code":"04","name":"Nota de Crédito","class":"credit_note"}]}'::jsonb),

  ('GT', 'Guatemala', 'GTQ', 'Q', 2, '+502', 'America/Guatemala',
   '{"tax_label":"IVA","tax_id_label":"NIT","authority":"SAT",
     "prices_include_tax":true,"rounding":{"mode":"half_up","precision":2},
     "einvoice":{"required":true,"standard":"FEL","authority":"SAT"},
     "document_types":[
       {"code":"FACT","name":"Factura","class":"invoice"},
       {"code":"NCRE","name":"Nota de Crédito","class":"credit_note"}]}'::jsonb),

  ('PA', 'Panamá', 'PAB', 'B/.', 2, '+507', 'America/Panama',
   '{"tax_label":"ITBMS","tax_id_label":"RUC","authority":"DGI",
     "prices_include_tax":false,"rounding":{"mode":"half_up","precision":2},
     "einvoice":{"required":true,"standard":"FE Panamá","authority":"DGI"},
     "document_types":[
       {"code":"01","name":"Factura","class":"invoice"},
       {"code":"04","name":"Nota de Crédito","class":"credit_note"}]}'::jsonb),

  ('US', 'Estados Unidos', 'USD', '$', 2, '+1', 'America/New_York',
   '{"tax_label":"Sales Tax","tax_id_label":"EIN","authority":"IRS",
     "prices_include_tax":false,"rounding":{"mode":"half_up","precision":2},
     "einvoice":{"required":false},
     "document_types":[
       {"code":"INV","name":"Invoice","class":"invoice"},
       {"code":"RCP","name":"Receipt","class":"receipt"}]}'::jsonb)

ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name,
      currency_code = EXCLUDED.currency_code,
      currency_symbol = EXCLUDED.currency_symbol,
      phone_prefix = EXCLUDED.phone_prefix,
      timezone_default = EXCLUDED.timezone_default,
      fiscal_config = EXCLUDED.fiscal_config;

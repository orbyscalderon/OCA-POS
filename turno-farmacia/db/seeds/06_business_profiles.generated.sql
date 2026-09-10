-- =====================================================================
-- ARCHIVO GENERADO — NO EDITAR A MANO
-- Fuente: config/profiles/*.json
-- Regenerar: node db/seeds/generate.mjs
-- =====================================================================


-- ── Barbería / Salón (barberia) ────────────────────────
INSERT INTO platform.business_profiles
  (slug, name, description, icon, category, primary_mode, is_public, sort_order)
VALUES ('barberia', 'Barbería / Salón', 'Negocio de servicios con agenda por profesional, comisiones por corte y venta cruzada de productos.', 'scissors',
        'servicios', 'appointments', true, 10)
ON CONFLICT (slug) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      icon = EXCLUDED.icon,
      category = EXCLUDED.category,
      primary_mode = EXCLUDED.primary_mode,
      sort_order = EXCLUDED.sort_order;

INSERT INTO platform.business_profile_versions
  (profile_id, version, manifest, status, published_at, changelog)
SELECT bp.id, 1, $manifest${
  "$schema": "../schemas/business-profile.schema.json",
  "profile": {
    "slug": "barberia",
    "name": "Barbería / Salón",
    "category": "servicios",
    "icon": "scissors",
    "version": 1,
    "primary_mode": "appointments",
    "description": "Negocio de servicios con agenda por profesional, comisiones por corte y venta cruzada de productos."
  },
  "modules": {
    "pos": {
      "enabled": true,
      "required": true,
      "layout": "service_first"
    },
    "inventory": {
      "enabled": true,
      "variants": false,
      "lots": false,
      "expiry": false,
      "serials": false,
      "label": "Productos y consumibles"
    },
    "credit": {
      "enabled": true,
      "default_kind": "open_account"
    },
    "customers": {
      "enabled": true,
      "required": true
    },
    "loyalty": {
      "enabled": true,
      "default_program": "stamps"
    },
    "purchasing": {
      "enabled": true
    },
    "expenses": {
      "enabled": true
    },
    "cash": {
      "enabled": true
    },
    "taxes": {
      "enabled": true
    },
    "storefront": {
      "enabled": true,
      "checkout_mode": "whatsapp",
      "mode": "booking"
    },
    "appointments": {
      "enabled": true,
      "required": true
    },
    "tables": {
      "enabled": false
    },
    "service_orders": {
      "enabled": false
    },
    "employees": {
      "enabled": true,
      "commissions": true,
      "attendance": true,
      "bookable": true
    },
    "agro": {
      "enabled": false
    },
    "lending": {
      "enabled": false
    }
  },
  "operation_modes": [
    "appointments",
    "quick_pos"
  ],
  "uoms": [
    {
      "code": "UND",
      "name": "Unidad",
      "dimension": "unit",
      "factor_to_base": 1,
      "is_base": true,
      "precision": 0
    },
    {
      "code": "SERV",
      "name": "Servicio",
      "dimension": "unit",
      "factor_to_base": 1,
      "precision": 0
    },
    {
      "code": "ML",
      "name": "Mililitro",
      "dimension": "volume",
      "factor_to_base": 0.001,
      "precision": 0
    },
    {
      "code": "L",
      "name": "Litro",
      "dimension": "volume",
      "factor_to_base": 1,
      "is_base": true,
      "precision": 3
    }
  ],
  "categories": [
    {
      "slug": "cortes",
      "name": "Cortes",
      "color": "#0EA5E9",
      "icon": "scissors",
      "kind": "service"
    },
    {
      "slug": "barba",
      "name": "Barba y Afeitado",
      "color": "#8B5CF6",
      "icon": "razor",
      "kind": "service"
    },
    {
      "slug": "color",
      "name": "Color y Tratamientos",
      "color": "#EC4899",
      "icon": "palette",
      "kind": "service"
    },
    {
      "slug": "productos",
      "name": "Productos de Venta",
      "color": "#F59E0B",
      "icon": "package"
    },
    {
      "slug": "consumibles",
      "name": "Consumibles (uso interno)",
      "color": "#64748B",
      "icon": "spray"
    }
  ],
  "attributes": {
    "product": [
      {
        "key": "duration_min",
        "label": "Duración",
        "data_type": "integer",
        "ui_widget": "stepper",
        "ui_group": "Servicio",
        "unit_suffix": "min",
        "is_required": true,
        "default_value": 30,
        "show_in_pos": true,
        "position": 10,
        "validation": {
          "min": 5,
          "max": 480,
          "step": 5
        },
        "applies_to_categories": [
          "cortes",
          "barba",
          "color"
        ]
      },
      {
        "key": "buffer_min",
        "label": "Tiempo de limpieza",
        "data_type": "integer",
        "ui_widget": "stepper",
        "ui_group": "Servicio",
        "unit_suffix": "min",
        "default_value": 5,
        "position": 20,
        "applies_to_categories": [
          "cortes",
          "barba",
          "color"
        ]
      },
      {
        "key": "skill_required",
        "label": "Nivel requerido",
        "data_type": "enum",
        "ui_widget": "segmented",
        "ui_group": "Servicio",
        "position": 30,
        "options": [
          {
            "value": "junior",
            "label": "Junior"
          },
          {
            "value": "senior",
            "label": "Senior"
          },
          {
            "value": "master",
            "label": "Master"
          }
        ]
      },
      {
        "key": "commission_pct",
        "label": "Comisión del profesional",
        "data_type": "percent",
        "ui_widget": "number",
        "ui_group": "Comercial",
        "unit_suffix": "%",
        "default_value": 40,
        "position": 40
      },
      {
        "key": "gender_target",
        "label": "Dirigido a",
        "data_type": "enum",
        "ui_widget": "segmented",
        "ui_group": "Servicio",
        "is_filterable": true,
        "position": 50,
        "options": [
          {
            "value": "hombre",
            "label": "Hombre"
          },
          {
            "value": "mujer",
            "label": "Mujer"
          },
          {
            "value": "nino",
            "label": "Niño"
          },
          {
            "value": "unisex",
            "label": "Unisex"
          }
        ]
      }
    ],
    "customer": [
      {
        "key": "tipo_cabello",
        "label": "Tipo de cabello",
        "data_type": "enum",
        "ui_widget": "select",
        "is_filterable": true,
        "position": 10,
        "options": [
          {
            "value": "liso",
            "label": "Liso"
          },
          {
            "value": "ondulado",
            "label": "Ondulado"
          },
          {
            "value": "rizado",
            "label": "Rizado"
          },
          {
            "value": "afro",
            "label": "Afro"
          }
        ]
      },
      {
        "key": "barbero_preferido",
        "label": "Profesional preferido",
        "data_type": "uuid_ref",
        "ui_widget": "select",
        "ref_entity": "employee",
        "position": 20
      },
      {
        "key": "alergias",
        "label": "Alergias / sensibilidades",
        "data_type": "text",
        "ui_widget": "textarea",
        "position": 30
      },
      {
        "key": "ultimo_corte_notas",
        "label": "Notas del último servicio",
        "data_type": "text",
        "ui_widget": "textarea",
        "position": 40
      }
    ],
    "employee": [
      {
        "key": "especialidades",
        "label": "Especialidades",
        "data_type": "multi_enum",
        "ui_widget": "chips",
        "position": 10,
        "options": [
          {
            "value": "fade",
            "label": "Fade / Degradado"
          },
          {
            "value": "barba",
            "label": "Barba y afeitado"
          },
          {
            "value": "color",
            "label": "Color"
          },
          {
            "value": "keratina",
            "label": "Keratina / Alisado"
          },
          {
            "value": "infantil",
            "label": "Corte infantil"
          },
          {
            "value": "diseno",
            "label": "Diseños / Freestyle"
          }
        ]
      },
      {
        "key": "nivel",
        "label": "Nivel",
        "data_type": "enum",
        "ui_widget": "segmented",
        "position": 20,
        "options": [
          {
            "value": "junior",
            "label": "Junior"
          },
          {
            "value": "senior",
            "label": "Senior"
          },
          {
            "value": "master",
            "label": "Master"
          }
        ]
      }
    ]
  },
  "product_defaults": {
    "kind": "service",
    "track_inventory": false,
    "track_lots": false,
    "track_expiry": false,
    "is_sellable": true
  },
  "appointments": {
    "slot_minutes": 15,
    "advance_booking_days": 30,
    "min_notice_minutes": 30,
    "allow_online_booking": true,
    "require_deposit": false,
    "deposit_pct": 0,
    "no_show_policy": {
      "track": true,
      "block_after": 3
    },
    "reminders": [
      {
        "offset_hours": -24,
        "channel": "whatsapp"
      },
      {
        "offset_hours": -2,
        "channel": "whatsapp"
      }
    ],
    "resources": [
      {
        "kind": "chair",
        "label": "Silla"
      }
    ]
  },
  "ui": {
    "navigation": [
      {
        "key": "agenda",
        "label": "Agenda",
        "icon": "calendar",
        "route": "/agenda",
        "primary": true
      },
      {
        "key": "pos",
        "label": "Cobrar",
        "icon": "shopping-cart",
        "route": "/pos"
      },
      {
        "key": "customers",
        "label": "Clientes",
        "icon": "users",
        "route": "/clientes"
      },
      {
        "key": "employees",
        "label": "Equipo",
        "icon": "user-check",
        "route": "/equipo"
      },
      {
        "key": "inventory",
        "label": "Productos",
        "icon": "package",
        "route": "/inventario"
      },
      {
        "key": "reports",
        "label": "Reportes",
        "icon": "bar-chart",
        "route": "/reportes"
      }
    ],
    "pos": {
      "layout": "service_first",
      "primary_action": "select_service",
      "show_product_images": false,
      "show_stock_badge": false,
      "variant_selector": "none",
      "quick_filters": [
        "gender_target"
      ],
      "keypad": "numeric",
      "require_customer": true,
      "require_employee_per_line": true,
      "allow_tip": true,
      "tip_presets": [
        0,
        10,
        15,
        20
      ]
    },
    "product_form": {
      "groups": [
        "Básico",
        "Servicio",
        "Comercial",
        "Precios"
      ],
      "hidden_fields": [
        "track_lots",
        "track_expiry",
        "track_serials",
        "is_weighted",
        "age_restricted"
      ]
    },
    "dashboard_widgets": [
      "appointments_today",
      "occupancy_rate",
      "revenue_by_barber",
      "commissions_pending",
      "top_services",
      "no_show_rate",
      "avg_ticket",
      "rebooking_rate"
    ]
  },
  "receipt": {
    "width_mm": 58,
    "show_attributes": [
      "duration_min"
    ],
    "show_employee_name": true,
    "footer": "¡Gracias por tu visita! Reserva tu próxima cita por WhatsApp.",
    "show_qr_storefront": true
  },
  "roles": [
    {
      "code": "admin",
      "name": "Administrador",
      "permissions": [
        "*"
      ]
    },
    {
      "code": "barbero",
      "name": "Barbero/Estilista",
      "permissions": [
        "appointments.read_own",
        "appointments.update_own",
        "sales.create",
        "customers.read",
        "customers.update",
        "attendance.clock",
        "commissions.read_own"
      ],
      "constraints": {
        "scope": "own_appointments_only",
        "max_discount_pct": 0
      }
    },
    {
      "code": "recepcion",
      "name": "Recepción",
      "permissions": [
        "appointments.*",
        "sales.create",
        "sales.read",
        "customers.*",
        "cash.open",
        "cash.close",
        "credit.charge",
        "credit.collect"
      ],
      "constraints": {
        "max_discount_pct": 15,
        "requires_supervisor_pin": [
          "sales.void"
        ]
      }
    },
    {
      "code": "contador",
      "name": "Contador",
      "permissions": [
        "reports.*",
        "finance.read",
        "taxes.*",
        "expenses.*",
        "payroll.read"
      ]
    }
  ],
  "automations": [
    {
      "key": "appointment_reminder",
      "enabled": true,
      "config": {
        "offsets_hours": [
          -24,
          -2
        ],
        "channel": "whatsapp"
      }
    },
    {
      "key": "rebooking_nudge",
      "enabled": true,
      "config": {
        "days_after_visit": 21,
        "channel": "whatsapp"
      }
    },
    {
      "key": "birthday_promo",
      "enabled": true,
      "config": {
        "days_before": 3,
        "discount_pct": 20
      }
    },
    {
      "key": "loyalty_stamps",
      "enabled": true,
      "config": {
        "stamps_needed": 10,
        "reward": "corte_gratis"
      }
    },
    {
      "key": "commission_closeout",
      "enabled": true,
      "config": {
        "frequency": "biweekly"
      }
    },
    {
      "key": "collection_reminder",
      "enabled": true,
      "config": {
        "offsets_days": [
          -1,
          5
        ],
        "channel": "whatsapp"
      }
    }
  ],
  "reports": [
    "revenue_by_employee",
    "occupancy_by_hour",
    "service_mix",
    "commission_settlement",
    "customer_retention",
    "no_show_analysis",
    "product_attach_rate"
  ]
}$manifest$::jsonb,
       'published', now(), 'Generado desde config/profiles/barberia.json'
  FROM platform.business_profiles bp WHERE bp.slug = 'barberia'
ON CONFLICT (profile_id, version) DO UPDATE
  SET manifest = EXCLUDED.manifest,
      status = 'published',
      published_at = COALESCE(platform.business_profile_versions.published_at, now()),
      changelog = EXCLUDED.changelog;

-- ── Farmacia / Botica (farmacia) ───────────────────────
INSERT INTO platform.business_profiles
  (slug, name, description, icon, category, primary_mode, is_public, sort_order)
VALUES ('farmacia', 'Farmacia / Botica', 'Catálogo enorme donde todo se busca por nombre o principio activo, con trazabilidad obligatoria de lote y vencimiento.', 'pill',
        'salud', 'search_first', true, 20)
ON CONFLICT (slug) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      icon = EXCLUDED.icon,
      category = EXCLUDED.category,
      primary_mode = EXCLUDED.primary_mode,
      sort_order = EXCLUDED.sort_order;

INSERT INTO platform.business_profile_versions
  (profile_id, version, manifest, status, published_at, changelog)
SELECT bp.id, 1, $manifest${
  "$schema": "../schemas/business-profile.schema.json",
  "profile": {
    "slug": "farmacia",
    "name": "Farmacia / Botica",
    "category": "salud",
    "icon": "pill",
    "version": 1,
    "primary_mode": "search_first",
    "description": "Catálogo enorme donde todo se busca por nombre o principio activo, con trazabilidad obligatoria de lote y vencimiento."
  },
  "modules": {
    "pos": {
      "enabled": true,
      "required": true,
      "layout": "search"
    },
    "inventory": {
      "enabled": true,
      "variants": false,
      "lots": true,
      "expiry": true,
      "serials": false
    },
    "credit": {
      "enabled": true,
      "default_kind": "open_account",
      "label": "Crédito y convenios"
    },
    "customers": {
      "enabled": true
    },
    "loyalty": {
      "enabled": true,
      "default_program": "points"
    },
    "purchasing": {
      "enabled": true
    },
    "expenses": {
      "enabled": true
    },
    "cash": {
      "enabled": true
    },
    "taxes": {
      "enabled": true
    },
    "storefront": {
      "enabled": true,
      "checkout_mode": "whatsapp"
    },
    "appointments": {
      "enabled": false
    },
    "tables": {
      "enabled": false
    },
    "service_orders": {
      "enabled": false
    },
    "employees": {
      "enabled": true,
      "commissions": true,
      "attendance": true
    },
    "agro": {
      "enabled": false
    },
    "lending": {
      "enabled": false
    }
  },
  "operation_modes": [
    "search_first",
    "quick_pos"
  ],
  "compliance": {
    "prescription_required": {
      "enabled": true,
      "prompt": "Este medicamento requiere receta médica. Registre los datos de la receta antes de dispensar.",
      "blocking": true,
      "capture_fields": [
        "medico",
        "matricula",
        "fecha_receta"
      ],
      "applies_to_categories": [
        "medicamentos-controlados",
        "antibioticos"
      ]
    }
  },
  "uoms": [
    {
      "code": "UND",
      "name": "Unidad",
      "dimension": "unit",
      "factor_to_base": 1,
      "is_base": true,
      "precision": 0
    },
    {
      "code": "BLISTER",
      "name": "Blíster",
      "dimension": "unit",
      "factor_to_base": 10,
      "precision": 0
    },
    {
      "code": "CAJA",
      "name": "Caja",
      "dimension": "unit",
      "factor_to_base": 30,
      "precision": 0
    },
    {
      "code": "ML",
      "name": "Mililitro",
      "dimension": "volume",
      "factor_to_base": 0.001,
      "precision": 0
    },
    {
      "code": "L",
      "name": "Litro",
      "dimension": "volume",
      "factor_to_base": 1,
      "is_base": true,
      "precision": 3
    },
    {
      "code": "MG",
      "name": "Miligramo",
      "dimension": "weight",
      "factor_to_base": 0.000001,
      "precision": 0
    },
    {
      "code": "G",
      "name": "Gramo",
      "dimension": "weight",
      "factor_to_base": 0.001,
      "precision": 2
    },
    {
      "code": "KG",
      "name": "Kilogramo",
      "dimension": "weight",
      "factor_to_base": 1,
      "is_base": true,
      "precision": 3
    }
  ],
  "categories": [
    {
      "slug": "medicamentos",
      "name": "Medicamentos de Venta Libre",
      "color": "#0EA5E9",
      "icon": "pill"
    },
    {
      "slug": "antibioticos",
      "name": "Antibióticos",
      "color": "#DC2626",
      "icon": "shield"
    },
    {
      "slug": "medicamentos-controlados",
      "name": "Medicamentos Controlados",
      "color": "#7C2D12",
      "icon": "lock"
    },
    {
      "slug": "cuidado-personal",
      "name": "Cuidado Personal",
      "color": "#EC4899",
      "icon": "heart"
    },
    {
      "slug": "materno-infantil",
      "name": "Materno Infantil",
      "color": "#F472B6",
      "icon": "baby"
    },
    {
      "slug": "vitaminas",
      "name": "Vitaminas y Suplementos",
      "color": "#16A34A",
      "icon": "leaf"
    },
    {
      "slug": "insumos-medicos",
      "name": "Insumos Médicos",
      "color": "#64748B",
      "icon": "stethoscope"
    }
  ],
  "attributes": {
    "product": [
      {
        "key": "principio_activo",
        "label": "Principio activo",
        "data_type": "text",
        "ui_widget": "text",
        "ui_group": "Farmacología",
        "is_filterable": true,
        "show_in_pos": true,
        "is_required": true,
        "position": 10,
        "help_text": "El buscador del POS indexa este campo: el cliente pide 'algo para el dolor', no una marca."
      },
      {
        "key": "concentracion",
        "label": "Concentración",
        "data_type": "text",
        "ui_widget": "text",
        "ui_group": "Farmacología",
        "unit_suffix": "mg/ml",
        "is_variant_axis": true,
        "is_filterable": true,
        "show_in_pos": true,
        "show_in_receipt": true,
        "semantic_role": "potency",
        "position": 20
      },
      {
        "key": "forma_farmaceutica",
        "label": "Forma farmacéutica",
        "data_type": "enum",
        "ui_widget": "select",
        "ui_group": "Farmacología",
        "is_filterable": true,
        "show_in_pos": true,
        "position": 30,
        "options": [
          {
            "value": "tableta",
            "label": "Tableta"
          },
          {
            "value": "capsula",
            "label": "Cápsula"
          },
          {
            "value": "jarabe",
            "label": "Jarabe"
          },
          {
            "value": "suspension",
            "label": "Suspensión"
          },
          {
            "value": "inyectable",
            "label": "Inyectable"
          },
          {
            "value": "crema",
            "label": "Crema / Ungüento"
          },
          {
            "value": "gotas",
            "label": "Gotas"
          },
          {
            "value": "supositorio",
            "label": "Supositorio"
          }
        ]
      },
      {
        "key": "laboratorio",
        "label": "Laboratorio",
        "data_type": "text",
        "ui_widget": "text",
        "ui_group": "Comercial",
        "is_filterable": true,
        "position": 40
      },
      {
        "key": "registro_sanitario",
        "label": "Registro sanitario",
        "data_type": "text",
        "ui_widget": "text",
        "ui_group": "Regulatorio",
        "is_required": true,
        "position": 50
      },
      {
        "key": "condicion_venta",
        "label": "Condición de venta",
        "data_type": "enum",
        "ui_widget": "segmented",
        "ui_group": "Regulatorio",
        "is_filterable": true,
        "show_in_pos": true,
        "position": 60,
        "options": [
          {
            "value": "libre",
            "label": "Venta libre"
          },
          {
            "value": "receta",
            "label": "Con receta"
          },
          {
            "value": "receta_retenida",
            "label": "Receta retenida"
          },
          {
            "value": "controlado",
            "label": "Controlado"
          }
        ],
        "validation": {
          "required": true
        }
      },
      {
        "key": "es_generico",
        "label": "Genérico",
        "data_type": "boolean",
        "ui_widget": "toggle",
        "ui_group": "Comercial",
        "is_filterable": true,
        "position": 70
      },
      {
        "key": "cadena_frio",
        "label": "Requiere cadena de frío",
        "data_type": "boolean",
        "ui_widget": "toggle",
        "ui_group": "Manejo",
        "position": 80
      }
    ],
    "inventory_lot": [
      {
        "key": "expiry_date",
        "label": "Fecha de vencimiento",
        "data_type": "date",
        "ui_widget": "date_picker",
        "semantic_role": "expiry",
        "is_required": true,
        "show_in_receipt": true,
        "position": 10
      },
      {
        "key": "lote_fabricante",
        "label": "Lote del fabricante",
        "data_type": "text",
        "ui_widget": "text",
        "semantic_role": "batch",
        "is_required": true,
        "position": 20
      },
      {
        "key": "temperatura_c",
        "label": "Temp. de conservación",
        "data_type": "number",
        "ui_widget": "number",
        "unit_suffix": "°C",
        "position": 30
      }
    ],
    "customer": [
      {
        "key": "alergias",
        "label": "Alergias conocidas",
        "data_type": "text",
        "ui_widget": "textarea",
        "position": 10
      },
      {
        "key": "seguro",
        "label": "Seguro / ARS",
        "data_type": "text",
        "ui_widget": "text",
        "is_filterable": true,
        "position": 20
      },
      {
        "key": "numero_afiliado",
        "label": "Número de afiliado",
        "data_type": "text",
        "position": 30
      },
      {
        "key": "tratamiento_cronico",
        "label": "Tratamiento crónico",
        "data_type": "boolean",
        "ui_widget": "toggle",
        "is_filterable": true,
        "position": 40,
        "help_text": "Habilita el recordatorio de recompra al agotarse el tratamiento."
      }
    ]
  },
  "product_defaults": {
    "track_inventory": true,
    "track_lots": true,
    "track_expiry": true,
    "track_serials": false,
    "requires_prescription": false,
    "allow_negative_stock": false,
    "reorder_point": 5
  },
  "ui": {
    "navigation": [
      {
        "key": "pos",
        "label": "Vender",
        "icon": "search",
        "route": "/pos",
        "primary": true
      },
      {
        "key": "inventory",
        "label": "Inventario",
        "icon": "package",
        "route": "/inventario"
      },
      {
        "key": "vencimientos",
        "label": "Vencimientos",
        "icon": "calendar-x",
        "route": "/inventario/vencimientos"
      },
      {
        "key": "customers",
        "label": "Clientes",
        "icon": "users",
        "route": "/clientes"
      },
      {
        "key": "credit",
        "label": "Crédito",
        "icon": "notebook",
        "route": "/fiado"
      },
      {
        "key": "compras",
        "label": "Compras",
        "icon": "truck",
        "route": "/compras"
      },
      {
        "key": "reports",
        "label": "Reportes",
        "icon": "bar-chart",
        "route": "/reportes"
      }
    ],
    "pos": {
      "layout": "search_first",
      "primary_action": "search",
      "show_product_images": false,
      "show_stock_badge": true,
      "variant_selector": "inline_list",
      "variant_axes": [
        "concentracion"
      ],
      "quick_filters": [
        "forma_farmaceutica",
        "es_generico",
        "condicion_venta"
      ],
      "keypad": "numeric",
      "allow_price_override": false,
      "require_customer": false
    },
    "product_form": {
      "groups": [
        "Básico",
        "Farmacología",
        "Regulatorio",
        "Comercial",
        "Manejo",
        "Precios"
      ],
      "hidden_fields": [
        "is_weighted",
        "track_serials",
        "age_restricted"
      ]
    },
    "dashboard_widgets": [
      "sales_today",
      "avg_ticket",
      "near_expiry",
      "low_stock",
      "top_products",
      "gross_margin",
      "credit_outstanding",
      "chronic_refills_due"
    ]
  },
  "receipt": {
    "width_mm": 80,
    "show_attributes": [
      "concentracion",
      "expiry_date"
    ],
    "show_lot_traceability": true,
    "show_logo": true,
    "footer": "Conserve este comprobante. Ante cualquier reacción adversa consulte a su médico."
  },
  "roles": [
    {
      "code": "admin",
      "name": "Administrador",
      "permissions": [
        "*"
      ]
    },
    {
      "code": "dependiente",
      "name": "Dependiente",
      "permissions": [
        "sales.create",
        "sales.read_own",
        "sales.reprint",
        "products.read",
        "customers.create",
        "customers.read",
        "credit.charge",
        "credit.collect",
        "cash.open",
        "cash.close",
        "inventory.read",
        "attendance.clock"
      ],
      "constraints": {
        "max_discount_pct": 5,
        "requires_supervisor_pin": [
          "sales.void",
          "sales.refund"
        ]
      }
    },
    {
      "code": "farmaceutico",
      "name": "Farmacéutico Regente",
      "permissions": [
        "sales.create",
        "sales.read",
        "sales.void",
        "sales.refund",
        "products.read",
        "products.create",
        "products.update",
        "inventory.read",
        "inventory.lots",
        "inventory.adjust",
        "inventory.scrap",
        "reports.inventory",
        "customers.read",
        "customers.update"
      ],
      "constraints": {
        "max_discount_pct": 15
      }
    },
    {
      "code": "inventario",
      "name": "Inventariador",
      "permissions": [
        "products.read",
        "inventory.read",
        "inventory.receive",
        "inventory.count",
        "inventory.lots",
        "purchasing.read",
        "purchasing.receive",
        "reports.inventory"
      ]
    },
    {
      "code": "contador",
      "name": "Contador",
      "permissions": [
        "reports.sales",
        "reports.finance",
        "reports.credit",
        "reports.export",
        "finance.read",
        "taxes.read",
        "taxes.issue",
        "expenses.read",
        "credit.read"
      ]
    }
  ],
  "automations": [
    {
      "key": "expiry_alert",
      "enabled": true,
      "config": {
        "days_before": [
          90,
          60,
          30,
          15
        ]
      }
    },
    {
      "key": "low_stock_alert",
      "enabled": true,
      "config": {
        "channel": "whatsapp",
        "threshold_source": "reorder_point"
      }
    },
    {
      "key": "chronic_refill",
      "enabled": true,
      "config": {
        "days_before_runout": 5,
        "channel": "whatsapp"
      }
    },
    {
      "key": "collection_reminder",
      "enabled": true,
      "config": {
        "offsets_days": [
          -2,
          5,
          15
        ],
        "channel": "whatsapp"
      }
    },
    {
      "key": "loyalty_points",
      "enabled": true,
      "config": {
        "earn_per_currency": 1,
        "redeem_value": 0.03
      }
    },
    {
      "key": "restock_forecast",
      "enabled": true,
      "config": {
        "model": "moving_avg_28d"
      }
    }
  ],
  "reports": [
    "near_expiry",
    "expired_losses",
    "sales_by_laboratory",
    "generic_vs_brand",
    "controlled_substances_log",
    "margin_by_category",
    "credit_aging",
    "chronic_patients"
  ]
}$manifest$::jsonb,
       'published', now(), 'Generado desde config/profiles/farmacia.json'
  FROM platform.business_profiles bp WHERE bp.slug = 'farmacia'
ON CONFLICT (profile_id, version) DO UPDATE
  SET manifest = EXCLUDED.manifest,
      status = 'published',
      published_at = COALESCE(platform.business_profile_versions.published_at, now()),
      changelog = EXCLUDED.changelog;

-- ── Ferretería / Materiales (ferreteria) ───────────────
INSERT INTO platform.business_profiles
  (slug, name, description, icon, category, primary_mode, is_public, sort_order)
VALUES ('ferreteria', 'Ferretería / Materiales', 'Venta fraccionada por metro, rollo, quintal o unidad, con crédito a maestros constructores y cotizaciones.', 'hammer',
        'retail', 'variant_inventory', true, 30)
ON CONFLICT (slug) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      icon = EXCLUDED.icon,
      category = EXCLUDED.category,
      primary_mode = EXCLUDED.primary_mode,
      sort_order = EXCLUDED.sort_order;

INSERT INTO platform.business_profile_versions
  (profile_id, version, manifest, status, published_at, changelog)
SELECT bp.id, 1, $manifest${
  "$schema": "../schemas/business-profile.schema.json",
  "profile": {
    "slug": "ferreteria",
    "name": "Ferretería / Materiales",
    "category": "retail",
    "icon": "hammer",
    "version": 1,
    "primary_mode": "variant_inventory",
    "description": "Venta fraccionada por metro, rollo, quintal o unidad, con crédito a maestros constructores y cotizaciones."
  },
  "modules": {
    "pos": {
      "enabled": true,
      "required": true,
      "layout": "search"
    },
    "inventory": {
      "enabled": true,
      "variants": true,
      "lots": false,
      "expiry": false,
      "serials": true
    },
    "credit": {
      "enabled": true,
      "default_kind": "open_account",
      "label": "Crédito a constructores"
    },
    "customers": {
      "enabled": true
    },
    "loyalty": {
      "enabled": true,
      "default_program": "cashback"
    },
    "purchasing": {
      "enabled": true,
      "multi_uom": true
    },
    "expenses": {
      "enabled": true
    },
    "cash": {
      "enabled": true
    },
    "taxes": {
      "enabled": true
    },
    "storefront": {
      "enabled": true,
      "checkout_mode": "whatsapp"
    },
    "appointments": {
      "enabled": false
    },
    "tables": {
      "enabled": false
    },
    "service_orders": {
      "enabled": false
    },
    "employees": {
      "enabled": true,
      "commissions": true,
      "attendance": true
    },
    "agro": {
      "enabled": false
    },
    "lending": {
      "enabled": false
    }
  },
  "operation_modes": [
    "variant_inventory",
    "quick_pos"
  ],
  "uoms": [
    {
      "code": "UND",
      "name": "Unidad",
      "dimension": "unit",
      "factor_to_base": 1,
      "is_base": true,
      "precision": 0
    },
    {
      "code": "DOC",
      "name": "Docena",
      "dimension": "unit",
      "factor_to_base": 12,
      "precision": 0
    },
    {
      "code": "CAJA",
      "name": "Caja",
      "dimension": "unit",
      "factor_to_base": 100,
      "precision": 0
    },
    {
      "code": "M",
      "name": "Metro",
      "dimension": "length",
      "factor_to_base": 1,
      "is_base": true,
      "precision": 2
    },
    {
      "code": "CM",
      "name": "Centímetro",
      "dimension": "length",
      "factor_to_base": 0.01,
      "precision": 0
    },
    {
      "code": "PIE",
      "name": "Pie",
      "dimension": "length",
      "factor_to_base": 0.3048,
      "precision": 2
    },
    {
      "code": "PULG",
      "name": "Pulgada",
      "dimension": "length",
      "factor_to_base": 0.0254,
      "precision": 2
    },
    {
      "code": "ROLLO",
      "name": "Rollo",
      "dimension": "length",
      "factor_to_base": 100,
      "precision": 2
    },
    {
      "code": "KG",
      "name": "Kilogramo",
      "dimension": "weight",
      "factor_to_base": 1,
      "is_base": true,
      "precision": 3
    },
    {
      "code": "LB",
      "name": "Libra",
      "dimension": "weight",
      "factor_to_base": 0.45359237,
      "precision": 2
    },
    {
      "code": "QQ",
      "name": "Quintal",
      "dimension": "weight",
      "factor_to_base": 46,
      "precision": 2
    },
    {
      "code": "SACO",
      "name": "Saco",
      "dimension": "weight",
      "factor_to_base": 42.5,
      "precision": 2
    },
    {
      "code": "L",
      "name": "Litro",
      "dimension": "volume",
      "factor_to_base": 1,
      "is_base": true,
      "precision": 3
    },
    {
      "code": "GAL",
      "name": "Galón",
      "dimension": "volume",
      "factor_to_base": 3.78541,
      "precision": 3
    },
    {
      "code": "CUNETE",
      "name": "Cuñete",
      "dimension": "volume",
      "factor_to_base": 18.9271,
      "precision": 2
    },
    {
      "code": "M2",
      "name": "Metro cuadrado",
      "dimension": "area",
      "factor_to_base": 1,
      "is_base": true,
      "precision": 2
    }
  ],
  "uom_policy": {
    "purchase_default": "CAJA",
    "consumption_default": "UND",
    "sale_defaults": {
      "cables": "M",
      "pinturas": "GAL",
      "cemento": "SACO",
      "hierro": "QQ"
    }
  },
  "categories": [
    {
      "slug": "herramientas",
      "name": "Herramientas",
      "color": "#F59E0B",
      "icon": "hammer"
    },
    {
      "slug": "electricidad",
      "name": "Electricidad",
      "color": "#EAB308",
      "icon": "zap"
    },
    {
      "slug": "cables",
      "name": "Cables y Alambres",
      "color": "#CA8A04",
      "icon": "cable"
    },
    {
      "slug": "plomeria",
      "name": "Plomería",
      "color": "#0EA5E9",
      "icon": "droplet"
    },
    {
      "slug": "pinturas",
      "name": "Pinturas y Solventes",
      "color": "#EC4899",
      "icon": "palette"
    },
    {
      "slug": "cemento",
      "name": "Cemento y Agregados",
      "color": "#64748B",
      "icon": "layers"
    },
    {
      "slug": "hierro",
      "name": "Hierro y Varillas",
      "color": "#78716C",
      "icon": "bar-chart"
    },
    {
      "slug": "tornilleria",
      "name": "Tornillería",
      "color": "#94A3B8",
      "icon": "screw"
    },
    {
      "slug": "seguridad",
      "name": "Seguridad Industrial",
      "color": "#16A34A",
      "icon": "shield"
    }
  ],
  "attributes": {
    "product": [
      {
        "key": "medida",
        "label": "Medida",
        "data_type": "enum",
        "ui_widget": "chips",
        "ui_group": "Especificaciones",
        "is_variant_axis": true,
        "is_filterable": true,
        "show_in_pos": true,
        "show_in_receipt": true,
        "position": 10,
        "options": [
          {
            "value": "1_8",
            "label": "1/8\""
          },
          {
            "value": "1_4",
            "label": "1/4\""
          },
          {
            "value": "3_8",
            "label": "3/8\""
          },
          {
            "value": "1_2",
            "label": "1/2\""
          },
          {
            "value": "3_4",
            "label": "3/4\""
          },
          {
            "value": "1",
            "label": "1\""
          },
          {
            "value": "1_1_2",
            "label": "1 1/2\""
          },
          {
            "value": "2",
            "label": "2\""
          },
          {
            "value": "3",
            "label": "3\""
          },
          {
            "value": "4",
            "label": "4\""
          }
        ]
      },
      {
        "key": "material",
        "label": "Material",
        "data_type": "enum",
        "ui_widget": "select",
        "ui_group": "Especificaciones",
        "is_variant_axis": true,
        "is_filterable": true,
        "position": 20,
        "options": [
          {
            "value": "acero",
            "label": "Acero"
          },
          {
            "value": "acero_inox",
            "label": "Acero inoxidable"
          },
          {
            "value": "galvanizado",
            "label": "Galvanizado"
          },
          {
            "value": "cobre",
            "label": "Cobre"
          },
          {
            "value": "pvc",
            "label": "PVC"
          },
          {
            "value": "aluminio",
            "label": "Aluminio"
          },
          {
            "value": "bronce",
            "label": "Bronce"
          },
          {
            "value": "plastico",
            "label": "Plástico"
          }
        ]
      },
      {
        "key": "color",
        "label": "Color",
        "data_type": "enum",
        "ui_widget": "chips",
        "ui_group": "Especificaciones",
        "is_variant_axis": true,
        "is_filterable": true,
        "position": 30,
        "options": [
          {
            "value": "blanco",
            "label": "Blanco"
          },
          {
            "value": "negro",
            "label": "Negro"
          },
          {
            "value": "gris",
            "label": "Gris"
          },
          {
            "value": "azul",
            "label": "Azul"
          },
          {
            "value": "rojo",
            "label": "Rojo"
          },
          {
            "value": "verde",
            "label": "Verde"
          },
          {
            "value": "amarillo",
            "label": "Amarillo"
          }
        ],
        "applies_to_categories": [
          "pinturas",
          "cables"
        ]
      },
      {
        "key": "calibre",
        "label": "Calibre (AWG)",
        "data_type": "text",
        "ui_widget": "text",
        "ui_group": "Especificaciones",
        "is_filterable": true,
        "position": 40,
        "applies_to_categories": [
          "cables",
          "electricidad"
        ]
      },
      {
        "key": "marca",
        "label": "Marca",
        "data_type": "text",
        "ui_widget": "text",
        "ui_group": "Comercial",
        "is_filterable": true,
        "position": 50
      },
      {
        "key": "se_vende_fraccionado",
        "label": "Se vende fraccionado",
        "data_type": "boolean",
        "ui_widget": "toggle",
        "ui_group": "Comercial",
        "position": 60,
        "help_text": "Habilita cortar del rollo o vender por metro suelto."
      },
      {
        "key": "garantia_meses",
        "label": "Garantía",
        "data_type": "integer",
        "ui_widget": "stepper",
        "ui_group": "Comercial",
        "unit_suffix": "meses",
        "semantic_role": "warranty",
        "position": 70,
        "applies_to_categories": [
          "herramientas"
        ]
      },
      {
        "key": "rendimiento_m2",
        "label": "Rendimiento",
        "data_type": "number",
        "ui_widget": "number",
        "ui_group": "Especificaciones",
        "unit_suffix": "m²/gal",
        "position": 80,
        "applies_to_categories": [
          "pinturas"
        ]
      }
    ],
    "customer": [
      {
        "key": "tipo_cliente",
        "label": "Tipo de cliente",
        "data_type": "enum",
        "ui_widget": "select",
        "is_filterable": true,
        "position": 10,
        "options": [
          {
            "value": "final",
            "label": "Consumidor final"
          },
          {
            "value": "maestro",
            "label": "Maestro constructor"
          },
          {
            "value": "contratista",
            "label": "Contratista"
          },
          {
            "value": "revendedor",
            "label": "Revendedor"
          }
        ]
      },
      {
        "key": "obra_actual",
        "label": "Obra actual",
        "data_type": "text",
        "position": 20
      }
    ]
  },
  "product_defaults": {
    "track_inventory": true,
    "track_lots": false,
    "track_expiry": false,
    "track_serials": false,
    "reorder_point": 5
  },
  "ui": {
    "navigation": [
      {
        "key": "pos",
        "label": "Vender",
        "icon": "search",
        "route": "/pos",
        "primary": true
      },
      {
        "key": "cotizar",
        "label": "Cotizaciones",
        "icon": "file-text",
        "route": "/cotizaciones"
      },
      {
        "key": "inventory",
        "label": "Inventario",
        "icon": "package",
        "route": "/inventario"
      },
      {
        "key": "credit",
        "label": "Crédito",
        "icon": "notebook",
        "route": "/fiado"
      },
      {
        "key": "compras",
        "label": "Compras",
        "icon": "truck",
        "route": "/compras"
      },
      {
        "key": "reports",
        "label": "Reportes",
        "icon": "bar-chart",
        "route": "/reportes"
      }
    ],
    "pos": {
      "layout": "search_first",
      "primary_action": "search",
      "show_product_images": true,
      "show_stock_badge": true,
      "variant_selector": "modal_matrix",
      "variant_axes": [
        "medida",
        "material",
        "color"
      ],
      "quick_filters": [
        "medida",
        "material",
        "marca",
        "calibre"
      ],
      "keypad": "numeric",
      "allow_price_override": true,
      "price_override_permission": "sales.price_override",
      "require_customer": false,
      "default_uom_selector": true
    },
    "product_form": {
      "groups": [
        "Básico",
        "Especificaciones",
        "Comercial",
        "Unidades",
        "Precios"
      ],
      "hidden_fields": [
        "track_lots",
        "track_expiry",
        "requires_prescription",
        "age_restricted"
      ]
    },
    "dashboard_widgets": [
      "sales_today",
      "avg_ticket",
      "top_products",
      "low_stock",
      "gross_margin",
      "credit_outstanding",
      "quotes_pending",
      "dead_stock"
    ]
  },
  "receipt": {
    "width_mm": 80,
    "show_attributes": [
      "medida",
      "material",
      "marca"
    ],
    "show_logo": true,
    "footer": "Mercancía vendida no se devuelve después de 8 días. Conserve su factura."
  },
  "roles": [
    {
      "code": "admin",
      "name": "Administrador",
      "permissions": [
        "*"
      ]
    },
    {
      "code": "vendedor",
      "name": "Vendedor de Mostrador",
      "permissions": [
        "sales.create",
        "sales.read_own",
        "sales.reprint",
        "sales.hold",
        "products.read",
        "inventory.read",
        "customers.create",
        "customers.read",
        "credit.charge",
        "credit.collect",
        "cash.open",
        "cash.close",
        "attendance.clock",
        "commissions.read_own"
      ],
      "constraints": {
        "max_discount_pct": 8,
        "requires_supervisor_pin": [
          "sales.void",
          "sales.price_override"
        ]
      }
    },
    {
      "code": "almacen",
      "name": "Almacenista",
      "permissions": [
        "products.read",
        "inventory.read",
        "inventory.receive",
        "inventory.transfer",
        "inventory.count",
        "purchasing.read",
        "purchasing.receive",
        "reports.inventory",
        "attendance.clock"
      ],
      "constraints": {
        "requires_supervisor_pin": [
          "inventory.adjust"
        ]
      }
    },
    {
      "code": "contador",
      "name": "Contador",
      "permissions": [
        "reports.sales",
        "reports.finance",
        "reports.credit",
        "reports.export",
        "finance.read",
        "taxes.read",
        "taxes.issue",
        "expenses.read",
        "expenses.create",
        "credit.read",
        "commissions.read"
      ]
    }
  ],
  "automations": [
    {
      "key": "low_stock_alert",
      "enabled": true,
      "config": {
        "channel": "whatsapp",
        "threshold_source": "reorder_point"
      }
    },
    {
      "key": "collection_reminder",
      "enabled": true,
      "config": {
        "offsets_days": [
          -3,
          5,
          15,
          30
        ],
        "channel": "whatsapp"
      }
    },
    {
      "key": "quote_followup",
      "enabled": true,
      "config": {
        "days_after": 2,
        "channel": "whatsapp"
      }
    },
    {
      "key": "restock_forecast",
      "enabled": true,
      "config": {
        "model": "moving_avg_28d"
      }
    },
    {
      "key": "loyalty_cashback",
      "enabled": true,
      "config": {
        "pct": 0.02,
        "cap_per_sale": 500
      }
    },
    {
      "key": "dead_stock_report",
      "enabled": true,
      "config": {
        "days": 120,
        "frequency": "monthly"
      }
    }
  ],
  "reports": [
    "sales_by_category",
    "margin_by_product",
    "dead_stock_120d",
    "quote_conversion",
    "credit_aging",
    "top_customers",
    "supplier_price_history",
    "fractional_sales"
  ]
}$manifest$::jsonb,
       'published', now(), 'Generado desde config/profiles/ferreteria.json'
  FROM platform.business_profiles bp WHERE bp.slug = 'ferreteria'
ON CONFLICT (profile_id, version) DO UPDATE
  SET manifest = EXCLUDED.manifest,
      status = 'published',
      published_at = COALESCE(platform.business_profile_versions.published_at, now()),
      changelog = EXCLUDED.changelog;

-- ── Granja Avícola (granja_avicola) ────────────────────
INSERT INTO platform.business_profiles
  (slug, name, description, icon, category, primary_mode, is_public, sort_order)
VALUES ('granja_avicola', 'Granja Avícola', 'Producción pecuaria por lote/camada con mortalidad, conversión alimenticia, faena o recolección diaria y costeo real por kg producido.', 'egg',
        'agro', 'biological_lots', true, 40)
ON CONFLICT (slug) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      icon = EXCLUDED.icon,
      category = EXCLUDED.category,
      primary_mode = EXCLUDED.primary_mode,
      sort_order = EXCLUDED.sort_order;

INSERT INTO platform.business_profile_versions
  (profile_id, version, manifest, status, published_at, changelog)
SELECT bp.id, 1, $manifest${
  "$schema": "../schemas/business-profile.schema.json",
  "profile": {
    "slug": "granja_avicola",
    "name": "Granja Avícola",
    "category": "agro",
    "icon": "egg",
    "version": 1,
    "primary_mode": "biological_lots",
    "description": "Producción pecuaria por lote/camada con mortalidad, conversión alimenticia, faena o recolección diaria y costeo real por kg producido."
  },
  "modules": {
    "pos": {
      "enabled": true,
      "required": true,
      "layout": "weight_first"
    },
    "inventory": {
      "enabled": true,
      "variants": false,
      "lots": true,
      "expiry": true,
      "serials": false
    },
    "credit": {
      "enabled": true,
      "default_kind": "open_account",
      "label": "Fiado a colmados"
    },
    "customers": {
      "enabled": true
    },
    "loyalty": {
      "enabled": false
    },
    "purchasing": {
      "enabled": true,
      "multi_uom": true
    },
    "expenses": {
      "enabled": true,
      "cost_center": "biological_lot"
    },
    "cash": {
      "enabled": true
    },
    "taxes": {
      "enabled": true
    },
    "storefront": {
      "enabled": true,
      "checkout_mode": "whatsapp"
    },
    "appointments": {
      "enabled": false
    },
    "tables": {
      "enabled": false
    },
    "service_orders": {
      "enabled": false
    },
    "employees": {
      "enabled": true,
      "commissions": false,
      "attendance": true
    },
    "agro": {
      "enabled": true,
      "species": [
        "broiler",
        "layer"
      ],
      "production_kinds": [
        "meat",
        "eggs"
      ],
      "daily_record": true,
      "harvest": true,
      "health_schedule": true,
      "cost_allocation": "by_weight"
    },
    "lending": {
      "enabled": false
    }
  },
  "operation_modes": [
    "biological_lots",
    "quick_pos"
  ],
  "uoms": [
    {
      "code": "UND",
      "name": "Unidad",
      "dimension": "unit",
      "factor_to_base": 1,
      "is_base": true,
      "precision": 0
    },
    {
      "code": "DOC",
      "name": "Docena",
      "dimension": "unit",
      "factor_to_base": 12,
      "precision": 0
    },
    {
      "code": "CARTON",
      "name": "Cartón (30 huevos)",
      "dimension": "unit",
      "factor_to_base": 30,
      "precision": 0
    },
    {
      "code": "CUBETA",
      "name": "Cubeta (30 huevos)",
      "dimension": "unit",
      "factor_to_base": 30,
      "precision": 0
    },
    {
      "code": "KG",
      "name": "Kilogramo",
      "dimension": "weight",
      "factor_to_base": 1,
      "is_base": true,
      "precision": 3
    },
    {
      "code": "G",
      "name": "Gramo",
      "dimension": "weight",
      "factor_to_base": 0.001,
      "precision": 0
    },
    {
      "code": "LB",
      "name": "Libra",
      "dimension": "weight",
      "factor_to_base": 0.45359237,
      "precision": 2
    },
    {
      "code": "QQ",
      "name": "Quintal",
      "dimension": "weight",
      "factor_to_base": 46,
      "precision": 2
    },
    {
      "code": "SACO",
      "name": "Saco de alimento",
      "dimension": "weight",
      "factor_to_base": 45.36,
      "precision": 2
    },
    {
      "code": "TON",
      "name": "Tonelada",
      "dimension": "weight",
      "factor_to_base": 1000,
      "precision": 3
    }
  ],
  "uom_policy": {
    "purchase_default": "TON",
    "consumption_default": "KG",
    "sale_defaults": {
      "carne": "LB",
      "huevos": "CARTON",
      "gallinaza": "SACO"
    },
    "scale_integration": {
      "enabled": true,
      "protocols": [
        "cas_ap",
        "toledo_continuous",
        "generic_serial"
      ],
      "barcode_rules": [
        {
          "prefix": "20",
          "code_start": 3,
          "code_len": 5,
          "value_start": 8,
          "value_len": 5,
          "value_kind": "weight_g",
          "value_decimals": 0
        }
      ]
    }
  },
  "categories": [
    {
      "slug": "aves-vivas",
      "name": "Aves Vivas",
      "color": "#F59E0B",
      "icon": "bird"
    },
    {
      "slug": "carne",
      "name": "Carne Procesada",
      "color": "#EF4444",
      "icon": "drumstick"
    },
    {
      "slug": "huevos",
      "name": "Huevos",
      "color": "#FBBF24",
      "icon": "egg"
    },
    {
      "slug": "subproductos",
      "name": "Subproductos",
      "color": "#78716C",
      "icon": "recycle"
    },
    {
      "slug": "alimento",
      "name": "Alimento Balanceado",
      "color": "#84CC16",
      "icon": "wheat",
      "purchasable_only": true
    },
    {
      "slug": "sanidad",
      "name": "Vacunas y Medicamentos",
      "color": "#06B6D4",
      "icon": "syringe",
      "purchasable_only": true
    },
    {
      "slug": "insumos",
      "name": "Insumos de Galpón",
      "color": "#64748B",
      "icon": "package",
      "purchasable_only": true
    }
  ],
  "attributes": {
    "product": [
      {
        "key": "especie",
        "label": "Especie",
        "data_type": "enum",
        "ui_widget": "select",
        "ui_group": "Producción",
        "is_filterable": true,
        "position": 10,
        "options": [
          {
            "value": "broiler",
            "label": "Pollo de engorde"
          },
          {
            "value": "layer",
            "label": "Gallina ponedora"
          },
          {
            "value": "breeder",
            "label": "Reproductora"
          }
        ]
      },
      {
        "key": "presentacion",
        "label": "Presentación",
        "data_type": "enum",
        "ui_widget": "chips",
        "ui_group": "Producción",
        "is_variant_axis": true,
        "is_filterable": true,
        "show_in_pos": true,
        "position": 20,
        "options": [
          {
            "value": "entero",
            "label": "Entero"
          },
          {
            "value": "pechuga",
            "label": "Pechuga"
          },
          {
            "value": "muslo",
            "label": "Muslo/Encuentro"
          },
          {
            "value": "ala",
            "label": "Alas"
          },
          {
            "value": "menudencia",
            "label": "Menudencia"
          }
        ],
        "applies_to_categories": [
          "carne"
        ]
      },
      {
        "key": "clase_huevo",
        "label": "Clasificación",
        "data_type": "enum",
        "ui_widget": "segmented",
        "ui_group": "Producción",
        "is_variant_axis": true,
        "show_in_pos": true,
        "position": 30,
        "options": [
          {
            "value": "AAA",
            "label": "AAA (Jumbo)"
          },
          {
            "value": "AA",
            "label": "AA (Extra)"
          },
          {
            "value": "A",
            "label": "A (Grande)"
          },
          {
            "value": "B",
            "label": "B (Mediano)"
          },
          {
            "value": "sucio",
            "label": "Sucio / 2da"
          }
        ],
        "applies_to_categories": [
          "huevos"
        ]
      },
      {
        "key": "etapa_alimento",
        "label": "Etapa del alimento",
        "data_type": "enum",
        "ui_widget": "select",
        "ui_group": "Nutrición",
        "position": 40,
        "options": [
          {
            "value": "preiniciador",
            "label": "Preiniciador (0-10 d)"
          },
          {
            "value": "iniciador",
            "label": "Iniciador (11-24 d)"
          },
          {
            "value": "engorde",
            "label": "Engorde (25-35 d)"
          },
          {
            "value": "finalizador",
            "label": "Finalizador (36+ d)"
          },
          {
            "value": "postura",
            "label": "Postura"
          }
        ],
        "applies_to_categories": [
          "alimento"
        ]
      },
      {
        "key": "proteina_pct",
        "label": "Proteína",
        "data_type": "number",
        "ui_widget": "number",
        "ui_group": "Nutrición",
        "unit_suffix": "%",
        "position": 50,
        "applies_to_categories": [
          "alimento"
        ]
      },
      {
        "key": "registro_sanitario",
        "label": "Registro sanitario",
        "data_type": "text",
        "ui_widget": "text",
        "ui_group": "Sanidad",
        "position": 60,
        "validation": {
          "required": true
        },
        "applies_to_categories": [
          "sanidad"
        ]
      },
      {
        "key": "periodo_retiro_dias",
        "label": "Período de retiro",
        "data_type": "integer",
        "ui_widget": "number",
        "ui_group": "Sanidad",
        "unit_suffix": "días",
        "help_text": "Días que deben pasar tras aplicar el medicamento antes de faenar.",
        "position": 70,
        "applies_to_categories": [
          "sanidad"
        ]
      }
    ],
    "inventory_lot": [
      {
        "key": "expiry_date",
        "label": "Fecha de vencimiento",
        "data_type": "date",
        "ui_widget": "date_picker",
        "semantic_role": "expiry",
        "is_required": true,
        "position": 10
      },
      {
        "key": "temperatura_c",
        "label": "Temp. de conservación",
        "data_type": "number",
        "ui_widget": "number",
        "unit_suffix": "°C",
        "position": 20
      }
    ],
    "biological_lot": [
      {
        "key": "galpon",
        "label": "Galpón",
        "data_type": "uuid_ref",
        "ui_widget": "select",
        "ui_group": "Ubicación",
        "is_required": true,
        "is_filterable": true,
        "position": 10,
        "ref_entity": "farm_unit"
      },
      {
        "key": "linea_genetica",
        "label": "Línea genética",
        "data_type": "enum",
        "ui_widget": "select",
        "ui_group": "Origen",
        "position": 20,
        "options": [
          {
            "value": "cobb_500",
            "label": "Cobb 500"
          },
          {
            "value": "ross_308",
            "label": "Ross 308"
          },
          {
            "value": "hy_line_brown",
            "label": "Hy-Line Brown"
          },
          {
            "value": "lohmann",
            "label": "Lohmann LSL"
          }
        ]
      },
      {
        "key": "sexado",
        "label": "Sexado",
        "data_type": "enum",
        "ui_widget": "segmented",
        "ui_group": "Origen",
        "position": 30,
        "options": [
          {
            "value": "mixto",
            "label": "Mixto"
          },
          {
            "value": "macho",
            "label": "Machos"
          },
          {
            "value": "hembra",
            "label": "Hembras"
          }
        ]
      },
      {
        "key": "tipo_cama",
        "label": "Tipo de cama",
        "data_type": "enum",
        "ui_widget": "select",
        "ui_group": "Manejo",
        "position": 40,
        "options": [
          {
            "value": "viruta",
            "label": "Viruta de madera"
          },
          {
            "value": "cascarilla",
            "label": "Cascarilla de arroz"
          },
          {
            "value": "reutilizada",
            "label": "Cama reutilizada"
          }
        ]
      },
      {
        "key": "densidad_aves_m2",
        "label": "Densidad",
        "data_type": "number",
        "ui_widget": "number",
        "ui_group": "Manejo",
        "unit_suffix": "aves/m²",
        "position": 50
      }
    ],
    "biological_daily": [
      {
        "key": "temperatura_min_c",
        "label": "Temp. mínima",
        "data_type": "number",
        "unit_suffix": "°C",
        "position": 10
      },
      {
        "key": "temperatura_max_c",
        "label": "Temp. máxima",
        "data_type": "number",
        "unit_suffix": "°C",
        "position": 20
      },
      {
        "key": "consumo_agua_l",
        "label": "Consumo de agua",
        "data_type": "number",
        "unit_suffix": "L",
        "position": 30
      },
      {
        "key": "observacion_sanitaria",
        "label": "Observación sanitaria",
        "data_type": "text",
        "ui_widget": "textarea",
        "position": 40
      }
    ],
    "customer": [
      {
        "key": "tipo_comprador",
        "label": "Tipo de comprador",
        "data_type": "enum",
        "ui_widget": "select",
        "is_filterable": true,
        "position": 10,
        "options": [
          {
            "value": "colmado",
            "label": "Colmado"
          },
          {
            "value": "supermercado",
            "label": "Supermercado"
          },
          {
            "value": "restaurante",
            "label": "Restaurante"
          },
          {
            "value": "mayorista",
            "label": "Distribuidor mayorista"
          },
          {
            "value": "final",
            "label": "Consumidor final"
          }
        ]
      },
      {
        "key": "ruta",
        "label": "Ruta de entrega",
        "data_type": "text",
        "is_filterable": true,
        "position": 20
      }
    ]
  },
  "product_defaults": {
    "track_inventory": true,
    "track_lots": true,
    "track_expiry": true,
    "track_serials": false,
    "is_weighted": true,
    "allow_negative_stock": false
  },
  "agro": {
    "lot_code_pattern": "{especie}-{galpon}-{YYYY}{MM}",
    "cost_types": [
      {
        "code": "livestock",
        "label": "Pollitos BB",
        "capitalizable": true
      },
      {
        "code": "feed",
        "label": "Alimento balanceado",
        "capitalizable": true
      },
      {
        "code": "medicine",
        "label": "Vacunas y medicamentos",
        "capitalizable": true
      },
      {
        "code": "supplies",
        "label": "Cama, gas, desinfectante",
        "capitalizable": true
      },
      {
        "code": "labor",
        "label": "Mano de obra",
        "capitalizable": true
      },
      {
        "code": "utilities",
        "label": "Electricidad y agua",
        "capitalizable": true
      },
      {
        "code": "transport",
        "label": "Transporte",
        "capitalizable": true
      },
      {
        "code": "depreciation",
        "label": "Depreciación de galpón",
        "capitalizable": true
      }
    ],
    "daily_record_fields": [
      "qty_dead",
      "qty_culled",
      "death_causes",
      "feed_qty",
      "avg_weight_g",
      "water_liters",
      "output_qty",
      "output_grade",
      "temperature_c",
      "humidity_pct"
    ],
    "death_causes": [
      "ascitis",
      "muerte_subita",
      "aplastamiento",
      "onfalitis",
      "coccidiosis",
      "problema_locomotor",
      "depredador",
      "descarte_sanitario",
      "otro"
    ],
    "harvest": {
      "kinds": [
        "slaughter",
        "egg_collection",
        "partial"
      ],
      "default_allocation": "by_weight",
      "outputs_template": [
        {
          "category": "carne",
          "presentacion": "entero",
          "expected_yield_pct": 74
        },
        {
          "category": "subproductos",
          "presentacion": "menudencia",
          "expected_yield_pct": 6,
          "is_byproduct": true
        },
        {
          "category": "subproductos",
          "presentacion": "gallinaza",
          "expected_yield_pct": 0,
          "is_byproduct": true
        }
      ]
    },
    "benchmarks": {
      "broiler": {
        "target_fcr": 1.65,
        "max_mortality_pct": 5,
        "target_weight_g_day35": 2400,
        "standard_curve_ref": "cobb500_2022"
      },
      "layer": {
        "target_laying_pct": 92,
        "max_mortality_pct_month": 0.8,
        "target_fcr_per_dozen": 1.45
      }
    },
    "health_schedule_template": [
      {
        "day_offset": 1,
        "task_type": "vaccine",
        "name": "Marek + Bronquitis (aspersión)"
      },
      {
        "day_offset": 7,
        "task_type": "vaccine",
        "name": "Newcastle B1 (ocular)"
      },
      {
        "day_offset": 10,
        "task_type": "feed_change",
        "name": "Cambio a Iniciador"
      },
      {
        "day_offset": 14,
        "task_type": "vaccine",
        "name": "Gumboro"
      },
      {
        "day_offset": 21,
        "task_type": "vaccine",
        "name": "Newcastle refuerzo"
      },
      {
        "day_offset": 24,
        "task_type": "feed_change",
        "name": "Cambio a Engorde"
      },
      {
        "day_offset": 7,
        "task_type": "weighing",
        "name": "Pesaje semanal",
        "repeat_every_days": 7
      },
      {
        "day_offset": 35,
        "task_type": "harvest",
        "name": "Faena programada"
      }
    ]
  },
  "ui": {
    "navigation": [
      {
        "key": "agro",
        "label": "Mis Lotes",
        "icon": "bird",
        "route": "/lotes",
        "primary": true
      },
      {
        "key": "daily",
        "label": "Registro Diario",
        "icon": "clipboard",
        "route": "/lotes/diario"
      },
      {
        "key": "pos",
        "label": "Vender",
        "icon": "shopping-cart",
        "route": "/pos"
      },
      {
        "key": "inventory",
        "label": "Insumos",
        "icon": "package",
        "route": "/inventario"
      },
      {
        "key": "credit",
        "label": "Fiado",
        "icon": "notebook",
        "route": "/fiado"
      },
      {
        "key": "costing",
        "label": "Costos",
        "icon": "calculator",
        "route": "/costos"
      },
      {
        "key": "reports",
        "label": "Reportes",
        "icon": "bar-chart",
        "route": "/reportes"
      }
    ],
    "pos": {
      "layout": "weight_first",
      "primary_action": "scale",
      "show_product_images": false,
      "show_stock_badge": true,
      "variant_selector": "inline_list",
      "variant_axes": [
        "presentacion",
        "clase_huevo"
      ],
      "quick_filters": [
        "presentacion",
        "clase_huevo"
      ],
      "keypad": "weight",
      "allow_price_override": true,
      "price_override_permission": "sales.price_override",
      "require_customer": true,
      "default_uom_selector": true
    },
    "product_form": {
      "groups": [
        "Básico",
        "Producción",
        "Nutrición",
        "Sanidad",
        "Precios",
        "Unidades"
      ],
      "hidden_fields": [
        "age_restricted",
        "requires_prescription"
      ]
    },
    "agro_daily_form": {
      "layout": "single_column_large_touch",
      "offline_first": true,
      "sections": [
        {
          "title": "Bajas",
          "fields": [
            "qty_dead",
            "qty_culled",
            "death_causes"
          ]
        },
        {
          "title": "Alimento",
          "fields": [
            "feed_variant_id",
            "feed_qty"
          ]
        },
        {
          "title": "Producción",
          "fields": [
            "output_qty",
            "output_grade"
          ]
        },
        {
          "title": "Ambiente",
          "fields": [
            "temperature_c",
            "humidity_pct",
            "water_liters"
          ]
        },
        {
          "title": "Pesaje",
          "fields": [
            "avg_weight_g",
            "uniformity_pct"
          ]
        }
      ]
    },
    "dashboard_widgets": [
      "active_lots",
      "mortality_curve",
      "fcr_vs_target",
      "cost_per_kg",
      "feed_stock_days",
      "upcoming_health_tasks",
      "sales_today",
      "credit_outstanding"
    ]
  },
  "receipt": {
    "width_mm": 80,
    "show_attributes": [
      "presentacion",
      "clase_huevo"
    ],
    "show_weight_detail": true,
    "footer": "Producto perecedero. Conservar refrigerado entre 0°C y 4°C.",
    "show_lot_traceability": true
  },
  "roles": [
    {
      "code": "admin",
      "name": "Administrador",
      "permissions": [
        "*"
      ]
    },
    {
      "code": "galponero",
      "name": "Galponero",
      "permissions": [
        "agro.daily_record.create",
        "agro.lots.read",
        "agro.schedule.complete",
        "inventory.consume",
        "attendance.clock"
      ],
      "constraints": {
        "scope": "assigned_farm_units_only"
      }
    },
    {
      "code": "veterinario",
      "name": "Veterinario/Técnico",
      "permissions": [
        "agro.*",
        "inventory.read",
        "reports.agro",
        "products.read"
      ],
      "constraints": {
        "requires_supervisor_pin": [
          "agro.lot.close"
        ]
      }
    },
    {
      "code": "cajero",
      "name": "Cajero",
      "permissions": [
        "sales.create",
        "sales.read",
        "customers.*",
        "credit.charge",
        "credit.collect",
        "cash.open",
        "cash.close"
      ],
      "constraints": {
        "max_discount_pct": 5
      }
    },
    {
      "code": "contador",
      "name": "Contador",
      "permissions": [
        "reports.*",
        "finance.read",
        "taxes.*",
        "expenses.*",
        "credit.read",
        "agro.costing.read"
      ]
    }
  ],
  "automations": [
    {
      "key": "high_mortality_alert",
      "enabled": true,
      "config": {
        "daily_pct_threshold": 0.5,
        "cumulative_pct_threshold": 5,
        "channel": "whatsapp"
      }
    },
    {
      "key": "fcr_deviation_alert",
      "enabled": true,
      "config": {
        "deviation_pct": 8,
        "compare_to": "benchmarks.broiler.target_fcr"
      }
    },
    {
      "key": "feed_stock_alert",
      "enabled": true,
      "config": {
        "days_of_cover_min": 3,
        "channel": "whatsapp"
      }
    },
    {
      "key": "health_task_reminder",
      "enabled": true,
      "config": {
        "offsets_days": [
          -1,
          0
        ],
        "channel": "push"
      }
    },
    {
      "key": "missing_daily_record",
      "enabled": true,
      "config": {
        "hour_local": 19,
        "channel": "whatsapp"
      }
    },
    {
      "key": "collection_reminder",
      "enabled": true,
      "config": {
        "offsets_days": [
          -2,
          1,
          7
        ],
        "channel": "whatsapp"
      }
    },
    {
      "key": "expiry_alert",
      "enabled": true,
      "config": {
        "days_before": [
          7,
          3,
          1
        ]
      }
    }
  ],
  "reports": [
    "lot_closeout",
    "mortality_by_cause",
    "fcr_by_lot",
    "cost_per_kg_produced",
    "laying_percentage",
    "feed_consumption_vs_standard",
    "margin_by_channel",
    "credit_aging"
  ]
}$manifest$::jsonb,
       'published', now(), 'Generado desde config/profiles/granja_avicola.json'
  FROM platform.business_profiles bp WHERE bp.slug = 'granja_avicola'
ON CONFLICT (profile_id, version) DO UPDATE
  SET manifest = EXCLUDED.manifest,
      status = 'published',
      published_at = COALESCE(platform.business_profile_versions.published_at, now()),
      changelog = EXCLUDED.changelog;

-- ── Prestamista / Financiera (prestamista) ─────────────
INSERT INTO platform.business_profiles
  (slug, name, description, icon, category, primary_mode, is_public, sort_order)
VALUES ('prestamista', 'Prestamista / Financiera', 'Colocación de préstamos con cronograma, interés, mora y cobranza en ruta. El inventario no existe: el producto es el dinero.', 'hand-coins',
        'financiero', 'lending', true, 50)
ON CONFLICT (slug) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      icon = EXCLUDED.icon,
      category = EXCLUDED.category,
      primary_mode = EXCLUDED.primary_mode,
      sort_order = EXCLUDED.sort_order;

INSERT INTO platform.business_profile_versions
  (profile_id, version, manifest, status, published_at, changelog)
SELECT bp.id, 1, $manifest${
  "$schema": "../schemas/business-profile.schema.json",
  "profile": {
    "slug": "prestamista",
    "name": "Prestamista / Financiera",
    "category": "financiero",
    "icon": "hand-coins",
    "version": 1,
    "primary_mode": "lending",
    "description": "Colocación de préstamos con cronograma, interés, mora y cobranza en ruta. El inventario no existe: el producto es el dinero."
  },
  "modules": {
    "pos": {
      "enabled": true,
      "required": true,
      "layout": "collection",
      "label": "Caja y cobros"
    },
    "inventory": {
      "enabled": false
    },
    "credit": {
      "enabled": true,
      "required": true,
      "default_kind": "loan"
    },
    "customers": {
      "enabled": true,
      "required": true
    },
    "loyalty": {
      "enabled": false
    },
    "purchasing": {
      "enabled": false
    },
    "expenses": {
      "enabled": true
    },
    "cash": {
      "enabled": true
    },
    "taxes": {
      "enabled": true
    },
    "storefront": {
      "enabled": false
    },
    "appointments": {
      "enabled": false
    },
    "tables": {
      "enabled": false
    },
    "service_orders": {
      "enabled": false
    },
    "employees": {
      "enabled": true,
      "commissions": true,
      "attendance": true
    },
    "agro": {
      "enabled": false
    },
    "lending": {
      "enabled": true,
      "required": true
    }
  },
  "operation_modes": [
    "lending",
    "quick_pos"
  ],
  "uoms": [
    {
      "code": "UND",
      "name": "Unidad",
      "dimension": "unit",
      "factor_to_base": 1,
      "is_base": true,
      "precision": 0
    }
  ],
  "categories": [
    {
      "slug": "prestamos",
      "name": "Productos de Préstamo",
      "color": "#16A34A",
      "icon": "hand-coins",
      "kind": "service"
    },
    {
      "slug": "cargos",
      "name": "Cargos y Comisiones",
      "color": "#DC2626",
      "icon": "percent",
      "kind": "service"
    }
  ],
  "attributes": {
    "product": [
      {
        "key": "tasa_interes",
        "label": "Tasa de interés",
        "data_type": "percent",
        "ui_widget": "number",
        "ui_group": "Condiciones",
        "unit_suffix": "%",
        "is_required": true,
        "show_in_pos": true,
        "position": 10,
        "validation": {
          "min": 0,
          "max": 100
        }
      },
      {
        "key": "periodicidad_interes",
        "label": "Periodicidad",
        "data_type": "enum",
        "ui_widget": "segmented",
        "ui_group": "Condiciones",
        "is_required": true,
        "is_filterable": true,
        "show_in_pos": true,
        "position": 20,
        "options": [
          {
            "value": "daily",
            "label": "Diario"
          },
          {
            "value": "weekly",
            "label": "Semanal"
          },
          {
            "value": "biweekly",
            "label": "Quincenal"
          },
          {
            "value": "monthly",
            "label": "Mensual"
          }
        ]
      },
      {
        "key": "metodo_amortizacion",
        "label": "Método de amortización",
        "data_type": "enum",
        "ui_widget": "select",
        "ui_group": "Condiciones",
        "is_required": true,
        "position": 30,
        "options": [
          {
            "value": "flat",
            "label": "Interés fijo sobre capital inicial"
          },
          {
            "value": "simple",
            "label": "Interés simple sobre saldo"
          },
          {
            "value": "french",
            "label": "Cuota fija (sistema francés)"
          }
        ]
      },
      {
        "key": "plazo_cuotas",
        "label": "Plazo (número de cuotas)",
        "data_type": "integer",
        "ui_widget": "stepper",
        "ui_group": "Condiciones",
        "is_variant_axis": true,
        "show_in_pos": true,
        "position": 40,
        "validation": {
          "min": 1,
          "max": 120
        }
      },
      {
        "key": "monto_min",
        "label": "Monto mínimo",
        "data_type": "money",
        "ui_widget": "number",
        "ui_group": "Límites",
        "position": 50
      },
      {
        "key": "monto_max",
        "label": "Monto máximo",
        "data_type": "money",
        "ui_widget": "number",
        "ui_group": "Límites",
        "position": 60
      },
      {
        "key": "mora_diaria",
        "label": "Mora diaria",
        "data_type": "percent",
        "ui_widget": "number",
        "ui_group": "Penalidades",
        "unit_suffix": "%/día",
        "default_value": 0.5,
        "position": 70
      },
      {
        "key": "dias_gracia",
        "label": "Días de gracia",
        "data_type": "integer",
        "ui_widget": "stepper",
        "ui_group": "Penalidades",
        "default_value": 3,
        "position": 80
      },
      {
        "key": "requiere_garantia",
        "label": "Requiere garantía",
        "data_type": "boolean",
        "ui_widget": "toggle",
        "ui_group": "Requisitos",
        "position": 90
      }
    ],
    "customer": [
      {
        "key": "ocupacion",
        "label": "Ocupación",
        "data_type": "text",
        "ui_widget": "text",
        "ui_group": "Perfil",
        "position": 10
      },
      {
        "key": "ingreso_mensual",
        "label": "Ingreso mensual declarado",
        "data_type": "money",
        "ui_widget": "number",
        "ui_group": "Perfil",
        "position": 20
      },
      {
        "key": "referencia_1_nombre",
        "label": "Referencia 1 — Nombre",
        "data_type": "text",
        "position": 30
      },
      {
        "key": "referencia_1_telefono",
        "label": "Referencia 1 — Teléfono",
        "data_type": "text",
        "position": 40
      },
      {
        "key": "referencia_2_nombre",
        "label": "Referencia 2 — Nombre",
        "data_type": "text",
        "position": 50
      },
      {
        "key": "referencia_2_telefono",
        "label": "Referencia 2 — Teléfono",
        "data_type": "text",
        "position": 60
      },
      {
        "key": "ruta_cobro",
        "label": "Ruta de cobro",
        "data_type": "text",
        "ui_widget": "text",
        "is_filterable": true,
        "position": 70
      },
      {
        "key": "cobrador_asignado",
        "label": "Cobrador asignado",
        "data_type": "uuid_ref",
        "ui_widget": "select",
        "ref_entity": "employee",
        "is_filterable": true,
        "position": 80
      },
      {
        "key": "clasificacion_riesgo",
        "label": "Clasificación de riesgo",
        "data_type": "enum",
        "ui_widget": "segmented",
        "is_filterable": true,
        "position": 90,
        "options": [
          {
            "value": "a",
            "label": "A — Excelente"
          },
          {
            "value": "b",
            "label": "B — Bueno"
          },
          {
            "value": "c",
            "label": "C — Regular"
          },
          {
            "value": "d",
            "label": "D — Riesgoso"
          },
          {
            "value": "e",
            "label": "E — Incobrable"
          }
        ]
      }
    ]
  },
  "product_defaults": {
    "kind": "service",
    "track_inventory": false,
    "track_lots": false,
    "track_expiry": false,
    "is_sellable": true
  },
  "ui": {
    "navigation": [
      {
        "key": "cartera",
        "label": "Cartera",
        "icon": "notebook",
        "route": "/fiado",
        "primary": true
      },
      {
        "key": "colocar",
        "label": "Colocar",
        "icon": "hand-coins",
        "route": "/prestamos/nuevo"
      },
      {
        "key": "cobranza",
        "label": "Cobranza",
        "icon": "phone",
        "route": "/cobranza"
      },
      {
        "key": "rutas",
        "label": "Rutas",
        "icon": "map",
        "route": "/cobranza/rutas"
      },
      {
        "key": "customers",
        "label": "Clientes",
        "icon": "users",
        "route": "/clientes"
      },
      {
        "key": "caja",
        "label": "Caja",
        "icon": "wallet",
        "route": "/caja"
      },
      {
        "key": "reports",
        "label": "Reportes",
        "icon": "bar-chart",
        "route": "/reportes"
      }
    ],
    "pos": {
      "layout": "service_first",
      "primary_action": "search",
      "show_product_images": false,
      "show_stock_badge": false,
      "variant_selector": "inline_list",
      "variant_axes": [
        "plazo_cuotas"
      ],
      "quick_filters": [
        "periodicidad_interes"
      ],
      "keypad": "numeric",
      "allow_price_override": true,
      "price_override_permission": "sales.price_override",
      "require_customer": true
    },
    "product_form": {
      "groups": [
        "Básico",
        "Condiciones",
        "Límites",
        "Penalidades",
        "Requisitos"
      ],
      "hidden_fields": [
        "track_lots",
        "track_expiry",
        "track_serials",
        "is_weighted",
        "reorder_point"
      ]
    },
    "dashboard_widgets": [
      "portfolio_outstanding",
      "collection_rate",
      "overdue_by_bucket",
      "disbursed_today",
      "interest_accrued",
      "collector_performance",
      "at_risk_portfolio"
    ]
  },
  "receipt": {
    "width_mm": 58,
    "show_attributes": [
      "tasa_interes",
      "plazo_cuotas"
    ],
    "show_employee_name": true,
    "show_logo": true,
    "footer": "Este recibo acredita el abono realizado. Consérvelo."
  },
  "roles": [
    {
      "code": "admin",
      "name": "Administrador",
      "permissions": [
        "*"
      ]
    },
    {
      "code": "cobrador",
      "name": "Cobrador",
      "permissions": [
        "credit.read",
        "credit.collect",
        "customers.read",
        "customers.update",
        "sales.create",
        "cash.open",
        "cash.close",
        "attendance.clock",
        "commissions.read_own",
        "messaging.send"
      ],
      "constraints": {
        "scope": "assigned_route_only",
        "max_discount_pct": 0,
        "requires_supervisor_pin": [
          "credit.waive"
        ]
      }
    },
    {
      "code": "analista",
      "name": "Analista de Crédito",
      "permissions": [
        "credit.read",
        "credit.charge",
        "credit.schedule",
        "credit.limit",
        "customers.read",
        "customers.create",
        "customers.update",
        "reports.credit",
        "products.read"
      ],
      "constraints": {
        "requires_supervisor_pin": [
          "credit.limit_override"
        ]
      }
    },
    {
      "code": "supervisor",
      "name": "Supervisor de Cartera",
      "permissions": [
        "credit.read",
        "credit.charge",
        "credit.collect",
        "credit.waive",
        "credit.write_off",
        "credit.schedule",
        "credit.limit",
        "credit.collection",
        "customers.read",
        "customers.update",
        "reports.credit",
        "reports.employees",
        "cash.read",
        "cash.approve_variance",
        "commissions.read",
        "commissions.settle"
      ]
    },
    {
      "code": "contador",
      "name": "Contador",
      "permissions": [
        "reports.finance",
        "reports.credit",
        "reports.export",
        "finance.read",
        "taxes.read",
        "taxes.issue",
        "expenses.read",
        "expenses.create",
        "credit.read"
      ]
    }
  ],
  "automations": [
    {
      "key": "accrue_interest",
      "enabled": true,
      "config": {
        "hour_local": 1
      }
    },
    {
      "key": "accrue_late_fee",
      "enabled": true,
      "config": {
        "hour_local": 1,
        "respect_grace_days": true
      }
    },
    {
      "key": "collection_reminder",
      "enabled": true,
      "config": {
        "offsets_days": [
          -3,
          -1,
          1,
          5,
          10,
          20
        ],
        "channel": "whatsapp",
        "include_payment_link": true
      }
    },
    {
      "key": "route_sheet",
      "enabled": true,
      "config": {
        "hour_local": 7,
        "channel": "push"
      }
    },
    {
      "key": "risk_reclassify",
      "enabled": true,
      "config": {
        "frequency": "weekly"
      }
    },
    {
      "key": "portfolio_summary",
      "enabled": true,
      "config": {
        "hour_local": 20,
        "channel": "whatsapp"
      }
    }
  ],
  "reports": [
    "portfolio_aging",
    "collection_rate_by_collector",
    "disbursement_log",
    "interest_income",
    "write_offs",
    "at_risk_portfolio",
    "route_performance"
  ]
}$manifest$::jsonb,
       'published', now(), 'Generado desde config/profiles/prestamista.json'
  FROM platform.business_profiles bp WHERE bp.slug = 'prestamista'
ON CONFLICT (profile_id, version) DO UPDATE
  SET manifest = EXCLUDED.manifest,
      status = 'published',
      published_at = COALESCE(platform.business_profile_versions.published_at, now()),
      changelog = EXCLUDED.changelog;

-- ── Restaurante / Bar (restaurante) ────────────────────
INSERT INTO platform.business_profiles
  (slug, name, description, icon, category, primary_mode, is_public, sort_order)
VALUES ('restaurante', 'Restaurante / Bar', 'Salón con mesas, comandas a cocina, modificadores por plato y descuento automático de insumos por receta.', 'utensils',
        'alimentos', 'tables', true, 60)
ON CONFLICT (slug) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      icon = EXCLUDED.icon,
      category = EXCLUDED.category,
      primary_mode = EXCLUDED.primary_mode,
      sort_order = EXCLUDED.sort_order;

INSERT INTO platform.business_profile_versions
  (profile_id, version, manifest, status, published_at, changelog)
SELECT bp.id, 1, $manifest${
  "$schema": "../schemas/business-profile.schema.json",
  "profile": {
    "slug": "restaurante",
    "name": "Restaurante / Bar",
    "category": "alimentos",
    "icon": "utensils",
    "version": 1,
    "primary_mode": "tables",
    "description": "Salón con mesas, comandas a cocina, modificadores por plato y descuento automático de insumos por receta."
  },
  "modules": {
    "pos": {
      "enabled": true,
      "required": true,
      "layout": "tables"
    },
    "inventory": {
      "enabled": true,
      "variants": false,
      "lots": true,
      "expiry": true,
      "serials": false,
      "label": "Insumos y almacén"
    },
    "credit": {
      "enabled": true,
      "default_kind": "open_account",
      "label": "Cuentas de casa"
    },
    "customers": {
      "enabled": true
    },
    "loyalty": {
      "enabled": true,
      "default_program": "points"
    },
    "purchasing": {
      "enabled": true,
      "multi_uom": true
    },
    "expenses": {
      "enabled": true
    },
    "cash": {
      "enabled": true
    },
    "taxes": {
      "enabled": true
    },
    "storefront": {
      "enabled": true,
      "checkout_mode": "whatsapp",
      "mode": "menu"
    },
    "appointments": {
      "enabled": false
    },
    "tables": {
      "enabled": true,
      "required": true
    },
    "service_orders": {
      "enabled": false
    },
    "employees": {
      "enabled": true,
      "commissions": true,
      "attendance": true
    },
    "agro": {
      "enabled": false
    },
    "lending": {
      "enabled": false
    }
  },
  "operation_modes": [
    "tables",
    "quick_pos"
  ],
  "uoms": [
    {
      "code": "UND",
      "name": "Unidad",
      "dimension": "unit",
      "factor_to_base": 1,
      "is_base": true,
      "precision": 0
    },
    {
      "code": "PORCION",
      "name": "Porción",
      "dimension": "unit",
      "factor_to_base": 1,
      "precision": 0
    },
    {
      "code": "DOC",
      "name": "Docena",
      "dimension": "unit",
      "factor_to_base": 12,
      "precision": 0
    },
    {
      "code": "KG",
      "name": "Kilogramo",
      "dimension": "weight",
      "factor_to_base": 1,
      "is_base": true,
      "precision": 3
    },
    {
      "code": "G",
      "name": "Gramo",
      "dimension": "weight",
      "factor_to_base": 0.001,
      "precision": 0
    },
    {
      "code": "LB",
      "name": "Libra",
      "dimension": "weight",
      "factor_to_base": 0.45359237,
      "precision": 2
    },
    {
      "code": "L",
      "name": "Litro",
      "dimension": "volume",
      "factor_to_base": 1,
      "is_base": true,
      "precision": 3
    },
    {
      "code": "ML",
      "name": "Mililitro",
      "dimension": "volume",
      "factor_to_base": 0.001,
      "precision": 0
    },
    {
      "code": "BOTELLA",
      "name": "Botella",
      "dimension": "volume",
      "factor_to_base": 0.75,
      "precision": 2
    }
  ],
  "uom_policy": {
    "purchase_default": "KG",
    "consumption_default": "G",
    "sale_defaults": {
      "platos": "PORCION",
      "bebidas": "UND"
    }
  },
  "categories": [
    {
      "slug": "entradas",
      "name": "Entradas",
      "color": "#84CC16",
      "icon": "salad"
    },
    {
      "slug": "platos",
      "name": "Platos Fuertes",
      "color": "#DC2626",
      "icon": "utensils"
    },
    {
      "slug": "acompanantes",
      "name": "Acompañantes",
      "color": "#CA8A04",
      "icon": "bowl"
    },
    {
      "slug": "postres",
      "name": "Postres",
      "color": "#EC4899",
      "icon": "cake"
    },
    {
      "slug": "bebidas",
      "name": "Bebidas",
      "color": "#0EA5E9",
      "icon": "cup"
    },
    {
      "slug": "licores",
      "name": "Licores y Cervezas",
      "color": "#7C2D12",
      "icon": "beer"
    },
    {
      "slug": "insumos",
      "name": "Insumos de Cocina",
      "color": "#64748B",
      "icon": "package",
      "purchasable_only": true
    }
  ],
  "attributes": {
    "product": [
      {
        "key": "estacion_cocina",
        "label": "Estación de cocina",
        "data_type": "enum",
        "ui_widget": "select",
        "ui_group": "Cocina",
        "is_filterable": true,
        "is_required": true,
        "position": 10,
        "options": [
          {
            "value": "caliente",
            "label": "Cocina caliente"
          },
          {
            "value": "fria",
            "label": "Cocina fría"
          },
          {
            "value": "parrilla",
            "label": "Parrilla"
          },
          {
            "value": "barra",
            "label": "Barra"
          },
          {
            "value": "postres",
            "label": "Postres"
          }
        ],
        "help_text": "Determina a qué impresora de comanda se envía el ítem."
      },
      {
        "key": "tiempo_preparacion",
        "label": "Tiempo de preparación",
        "data_type": "integer",
        "ui_widget": "stepper",
        "ui_group": "Cocina",
        "unit_suffix": "min",
        "default_value": 15,
        "show_in_pos": true,
        "position": 20
      },
      {
        "key": "nivel_picante",
        "label": "Nivel de picante",
        "data_type": "enum",
        "ui_widget": "segmented",
        "ui_group": "Descripción",
        "is_filterable": true,
        "show_in_pos": true,
        "position": 30,
        "options": [
          {
            "value": "0",
            "label": "Sin picante"
          },
          {
            "value": "1",
            "label": "Suave"
          },
          {
            "value": "2",
            "label": "Medio"
          },
          {
            "value": "3",
            "label": "Picante"
          }
        ]
      },
      {
        "key": "alergenos",
        "label": "Alérgenos",
        "data_type": "multi_enum",
        "ui_widget": "chips",
        "ui_group": "Descripción",
        "is_filterable": true,
        "show_in_receipt": true,
        "position": 40,
        "options": [
          {
            "value": "gluten",
            "label": "Gluten"
          },
          {
            "value": "lacteos",
            "label": "Lácteos"
          },
          {
            "value": "mani",
            "label": "Maní"
          },
          {
            "value": "mariscos",
            "label": "Mariscos"
          },
          {
            "value": "huevo",
            "label": "Huevo"
          },
          {
            "value": "soya",
            "label": "Soya"
          },
          {
            "value": "frutos_secos",
            "label": "Frutos secos"
          }
        ]
      },
      {
        "key": "apto_vegetariano",
        "label": "Apto vegetariano",
        "data_type": "boolean",
        "ui_widget": "toggle",
        "ui_group": "Descripción",
        "is_filterable": true,
        "position": 50
      },
      {
        "key": "modificadores",
        "label": "Modificadores disponibles",
        "data_type": "multi_enum",
        "ui_widget": "chips",
        "ui_group": "Cocina",
        "position": 60,
        "options": [
          {
            "value": "sin_cebolla",
            "label": "Sin cebolla"
          },
          {
            "value": "sin_sal",
            "label": "Sin sal"
          },
          {
            "value": "termino_medio",
            "label": "Término medio"
          },
          {
            "value": "bien_cocido",
            "label": "Bien cocido"
          },
          {
            "value": "extra_queso",
            "label": "Extra queso"
          },
          {
            "value": "para_llevar",
            "label": "Para llevar"
          }
        ]
      },
      {
        "key": "vende_por_peso",
        "label": "Se cobra por peso",
        "data_type": "boolean",
        "ui_widget": "toggle",
        "ui_group": "Comercial",
        "semantic_role": "weight",
        "position": 70,
        "applies_to_categories": [
          "platos",
          "acompanantes"
        ]
      }
    ],
    "inventory_lot": [
      {
        "key": "expiry_date",
        "label": "Fecha de vencimiento",
        "data_type": "date",
        "ui_widget": "date_picker",
        "semantic_role": "expiry",
        "is_required": true,
        "position": 10
      }
    ],
    "customer": [
      {
        "key": "mesa_preferida",
        "label": "Mesa preferida",
        "data_type": "text",
        "position": 10
      },
      {
        "key": "restricciones",
        "label": "Restricciones alimentarias",
        "data_type": "text",
        "ui_widget": "textarea",
        "position": 20
      }
    ]
  },
  "product_defaults": {
    "track_inventory": false,
    "track_lots": false,
    "track_expiry": false,
    "allow_negative_stock": true,
    "is_sellable": true
  },
  "ui": {
    "navigation": [
      {
        "key": "mesas",
        "label": "Salón",
        "icon": "layout-grid",
        "route": "/mesas",
        "primary": true
      },
      {
        "key": "pos",
        "label": "Barra",
        "icon": "shopping-cart",
        "route": "/pos"
      },
      {
        "key": "cocina",
        "label": "Cocina",
        "icon": "chef-hat",
        "route": "/cocina"
      },
      {
        "key": "inventory",
        "label": "Insumos",
        "icon": "package",
        "route": "/inventario"
      },
      {
        "key": "compras",
        "label": "Compras",
        "icon": "truck",
        "route": "/compras"
      },
      {
        "key": "caja",
        "label": "Caja",
        "icon": "wallet",
        "route": "/caja"
      },
      {
        "key": "reports",
        "label": "Reportes",
        "icon": "bar-chart",
        "route": "/reportes"
      }
    ],
    "pos": {
      "layout": "tables",
      "primary_action": "select_table",
      "show_product_images": true,
      "show_stock_badge": false,
      "variant_selector": "none",
      "quick_filters": [
        "estacion_cocina",
        "apto_vegetariano",
        "nivel_picante"
      ],
      "keypad": "numeric",
      "allow_price_override": false,
      "require_customer": false,
      "require_employee_per_line": true,
      "allow_tip": true,
      "tip_presets": [
        0,
        10,
        15,
        20
      ]
    },
    "product_form": {
      "groups": [
        "Básico",
        "Cocina",
        "Descripción",
        "Comercial",
        "Precios"
      ],
      "hidden_fields": [
        "track_serials",
        "age_restricted",
        "requires_prescription"
      ]
    },
    "dashboard_widgets": [
      "open_tables",
      "sales_today",
      "avg_ticket",
      "top_dishes",
      "table_turnover",
      "peak_hours",
      "waiter_performance",
      "food_cost_pct"
    ]
  },
  "receipt": {
    "width_mm": 80,
    "show_attributes": [
      "alergenos"
    ],
    "show_employee_name": true,
    "show_logo": true,
    "footer": "Propina no incluida. ¡Gracias por visitarnos!"
  },
  "roles": [
    {
      "code": "admin",
      "name": "Administrador",
      "permissions": [
        "*"
      ]
    },
    {
      "code": "mesero",
      "name": "Mesero",
      "permissions": [
        "tables.read",
        "tables.open",
        "tables.order",
        "tables.split",
        "sales.create",
        "sales.read_own",
        "products.read",
        "attendance.clock",
        "commissions.read_own"
      ],
      "constraints": {
        "max_discount_pct": 0,
        "requires_supervisor_pin": [
          "tables.void_item",
          "tables.transfer"
        ]
      }
    },
    {
      "code": "cocina",
      "name": "Cocina",
      "permissions": [
        "tables.read",
        "products.read",
        "inventory.read",
        "attendance.clock"
      ],
      "constraints": {
        "scope": "kitchen_display_only"
      }
    },
    {
      "code": "cajero",
      "name": "Cajero",
      "permissions": [
        "sales.create",
        "sales.read",
        "sales.reprint",
        "tables.read",
        "tables.split",
        "cash.open",
        "cash.close",
        "customers.create",
        "customers.read",
        "credit.charge",
        "credit.collect"
      ],
      "constraints": {
        "max_discount_pct": 10,
        "requires_supervisor_pin": [
          "sales.void"
        ]
      }
    },
    {
      "code": "contador",
      "name": "Contador",
      "permissions": [
        "reports.sales",
        "reports.finance",
        "reports.employees",
        "reports.export",
        "finance.read",
        "taxes.read",
        "taxes.issue",
        "expenses.read",
        "expenses.create",
        "commissions.read"
      ]
    }
  ],
  "automations": [
    {
      "key": "low_stock_alert",
      "enabled": true,
      "config": {
        "channel": "whatsapp",
        "threshold_source": "reorder_point"
      }
    },
    {
      "key": "expiry_alert",
      "enabled": true,
      "config": {
        "days_before": [
          5,
          2,
          1
        ]
      }
    },
    {
      "key": "table_idle_alert",
      "enabled": true,
      "config": {
        "minutes": 25,
        "channel": "push"
      }
    },
    {
      "key": "daily_summary",
      "enabled": true,
      "config": {
        "hour_local": 23,
        "channel": "whatsapp"
      }
    },
    {
      "key": "commission_closeout",
      "enabled": true,
      "config": {
        "frequency": "weekly"
      }
    },
    {
      "key": "loyalty_points",
      "enabled": true,
      "config": {
        "earn_per_currency": 1,
        "redeem_value": 0.05
      }
    }
  ],
  "reports": [
    "sales_by_station",
    "top_dishes",
    "table_turnover",
    "waiter_performance",
    "food_cost_pct",
    "void_analysis",
    "peak_hours",
    "tip_distribution"
  ]
}$manifest$::jsonb,
       'published', now(), 'Generado desde config/profiles/restaurante.json'
  FROM platform.business_profiles bp WHERE bp.slug = 'restaurante'
ON CONFLICT (profile_id, version) DO UPDATE
  SET manifest = EXCLUDED.manifest,
      status = 'published',
      published_at = COALESCE(platform.business_profile_versions.published_at, now()),
      changelog = EXCLUDED.changelog;

-- ── Supermercado / Colmado (supermercado) ──────────────
INSERT INTO platform.business_profiles
  (slug, name, description, icon, category, primary_mode, is_public, sort_order)
VALUES ('supermercado', 'Supermercado / Colmado', 'Alta rotación, venta por peso con balanza, códigos de barra en todo y fiado de barrio.', 'shopping-basket',
        'alimentos', 'quick_pos', true, 70)
ON CONFLICT (slug) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      icon = EXCLUDED.icon,
      category = EXCLUDED.category,
      primary_mode = EXCLUDED.primary_mode,
      sort_order = EXCLUDED.sort_order;

INSERT INTO platform.business_profile_versions
  (profile_id, version, manifest, status, published_at, changelog)
SELECT bp.id, 1, $manifest${
  "$schema": "../schemas/business-profile.schema.json",
  "profile": {
    "slug": "supermercado",
    "name": "Supermercado / Colmado",
    "category": "alimentos",
    "icon": "shopping-basket",
    "version": 1,
    "primary_mode": "quick_pos",
    "description": "Alta rotación, venta por peso con balanza, códigos de barra en todo y fiado de barrio."
  },
  "modules": {
    "pos": {
      "enabled": true,
      "required": true,
      "layout": "quick"
    },
    "inventory": {
      "enabled": true,
      "variants": false,
      "lots": true,
      "expiry": true,
      "serials": false
    },
    "credit": {
      "enabled": true,
      "default_kind": "open_account",
      "label": "Libreta de fiado"
    },
    "customers": {
      "enabled": true
    },
    "loyalty": {
      "enabled": true,
      "default_program": "points"
    },
    "purchasing": {
      "enabled": true,
      "multi_uom": true
    },
    "expenses": {
      "enabled": true
    },
    "cash": {
      "enabled": true
    },
    "taxes": {
      "enabled": true
    },
    "storefront": {
      "enabled": true,
      "checkout_mode": "whatsapp"
    },
    "appointments": {
      "enabled": false
    },
    "tables": {
      "enabled": false
    },
    "service_orders": {
      "enabled": false
    },
    "employees": {
      "enabled": true,
      "commissions": false,
      "attendance": true
    },
    "agro": {
      "enabled": false
    },
    "lending": {
      "enabled": false
    }
  },
  "operation_modes": [
    "quick_pos"
  ],
  "uoms": [
    {
      "code": "UND",
      "name": "Unidad",
      "dimension": "unit",
      "factor_to_base": 1,
      "is_base": true,
      "precision": 0
    },
    {
      "code": "DOC",
      "name": "Docena",
      "dimension": "unit",
      "factor_to_base": 12,
      "precision": 0
    },
    {
      "code": "PAQ",
      "name": "Paquete",
      "dimension": "unit",
      "factor_to_base": 6,
      "precision": 0
    },
    {
      "code": "CAJA",
      "name": "Caja",
      "dimension": "unit",
      "factor_to_base": 24,
      "precision": 0
    },
    {
      "code": "FARDO",
      "name": "Fardo",
      "dimension": "unit",
      "factor_to_base": 12,
      "precision": 0
    },
    {
      "code": "KG",
      "name": "Kilogramo",
      "dimension": "weight",
      "factor_to_base": 1,
      "is_base": true,
      "precision": 3
    },
    {
      "code": "G",
      "name": "Gramo",
      "dimension": "weight",
      "factor_to_base": 0.001,
      "precision": 0
    },
    {
      "code": "LB",
      "name": "Libra",
      "dimension": "weight",
      "factor_to_base": 0.45359237,
      "precision": 2
    },
    {
      "code": "ONZ",
      "name": "Onza",
      "dimension": "weight",
      "factor_to_base": 0.0283495,
      "precision": 2
    },
    {
      "code": "L",
      "name": "Litro",
      "dimension": "volume",
      "factor_to_base": 1,
      "is_base": true,
      "precision": 3
    },
    {
      "code": "ML",
      "name": "Mililitro",
      "dimension": "volume",
      "factor_to_base": 0.001,
      "precision": 0
    },
    {
      "code": "GAL",
      "name": "Galón",
      "dimension": "volume",
      "factor_to_base": 3.78541,
      "precision": 2
    }
  ],
  "uom_policy": {
    "purchase_default": "CAJA",
    "consumption_default": "UND",
    "sale_defaults": {
      "granos": "LB",
      "carnes": "LB",
      "lacteos": "UND"
    },
    "scale_integration": {
      "enabled": true,
      "protocols": [
        "cas_ap",
        "toledo_continuous",
        "generic_serial"
      ],
      "barcode_rules": [
        {
          "prefix": "20",
          "code_start": 3,
          "code_len": 5,
          "value_start": 8,
          "value_len": 5,
          "value_kind": "price",
          "value_decimals": 2
        },
        {
          "prefix": "21",
          "code_start": 3,
          "code_len": 5,
          "value_start": 8,
          "value_len": 5,
          "value_kind": "weight_g",
          "value_decimals": 0
        }
      ]
    }
  },
  "categories": [
    {
      "slug": "granos",
      "name": "Granos y Víveres",
      "color": "#CA8A04",
      "icon": "wheat"
    },
    {
      "slug": "carnes",
      "name": "Carnes y Embutidos",
      "color": "#DC2626",
      "icon": "beef"
    },
    {
      "slug": "lacteos",
      "name": "Lácteos y Huevos",
      "color": "#FBBF24",
      "icon": "milk"
    },
    {
      "slug": "frutas-verduras",
      "name": "Frutas y Verduras",
      "color": "#16A34A",
      "icon": "carrot"
    },
    {
      "slug": "bebidas",
      "name": "Bebidas",
      "color": "#0EA5E9",
      "icon": "cup"
    },
    {
      "slug": "limpieza",
      "name": "Limpieza y Hogar",
      "color": "#8B5CF6",
      "icon": "spray"
    },
    {
      "slug": "cuidado-personal",
      "name": "Cuidado Personal",
      "color": "#EC4899",
      "icon": "heart"
    },
    {
      "slug": "panaderia",
      "name": "Panadería",
      "color": "#D97706",
      "icon": "bread"
    },
    {
      "slug": "congelados",
      "name": "Congelados",
      "color": "#06B6D4",
      "icon": "snowflake"
    }
  ],
  "attributes": {
    "product": [
      {
        "key": "marca",
        "label": "Marca",
        "data_type": "text",
        "ui_widget": "text",
        "ui_group": "Comercial",
        "is_filterable": true,
        "position": 10
      },
      {
        "key": "contenido_neto",
        "label": "Contenido neto",
        "data_type": "number",
        "ui_widget": "number",
        "ui_group": "Presentación",
        "position": 20,
        "validation": {
          "min": 0
        }
      },
      {
        "key": "unidad_contenido",
        "label": "Unidad del contenido",
        "data_type": "enum",
        "ui_widget": "select",
        "ui_group": "Presentación",
        "position": 30,
        "options": [
          {
            "value": "g",
            "label": "gramos"
          },
          {
            "value": "kg",
            "label": "kilogramos"
          },
          {
            "value": "ml",
            "label": "mililitros"
          },
          {
            "value": "l",
            "label": "litros"
          },
          {
            "value": "und",
            "label": "unidades"
          }
        ]
      },
      {
        "key": "requiere_refrigeracion",
        "label": "Requiere refrigeración",
        "data_type": "boolean",
        "ui_widget": "toggle",
        "ui_group": "Manejo",
        "position": 40,
        "applies_to_categories": [
          "carnes",
          "lacteos",
          "congelados"
        ]
      },
      {
        "key": "canasta_basica",
        "label": "Canasta básica",
        "data_type": "boolean",
        "ui_widget": "toggle",
        "ui_group": "Comercial",
        "is_filterable": true,
        "position": 50,
        "help_text": "Los productos de canasta básica suelen estar exentos de impuesto."
      },
      {
        "key": "origen",
        "label": "Origen",
        "data_type": "enum",
        "ui_widget": "select",
        "ui_group": "Comercial",
        "semantic_role": "origin",
        "is_filterable": true,
        "position": 60,
        "options": [
          {
            "value": "nacional",
            "label": "Nacional"
          },
          {
            "value": "importado",
            "label": "Importado"
          }
        ]
      }
    ],
    "inventory_lot": [
      {
        "key": "expiry_date",
        "label": "Fecha de vencimiento",
        "data_type": "date",
        "ui_widget": "date_picker",
        "semantic_role": "expiry",
        "is_required": true,
        "position": 10
      }
    ],
    "customer": [
      {
        "key": "sector",
        "label": "Sector / Barrio",
        "data_type": "text",
        "is_filterable": true,
        "position": 10
      },
      {
        "key": "dia_pago",
        "label": "Día de pago habitual",
        "data_type": "enum",
        "ui_widget": "select",
        "position": 20,
        "options": [
          {
            "value": "quincena",
            "label": "Quincena"
          },
          {
            "value": "fin_mes",
            "label": "Fin de mes"
          },
          {
            "value": "semanal",
            "label": "Semanal"
          }
        ]
      }
    ]
  },
  "product_defaults": {
    "track_inventory": true,
    "track_lots": false,
    "track_expiry": false,
    "track_serials": false,
    "is_weighted": false,
    "reorder_point": 10
  },
  "ui": {
    "navigation": [
      {
        "key": "pos",
        "label": "Vender",
        "icon": "shopping-cart",
        "route": "/pos",
        "primary": true
      },
      {
        "key": "inventory",
        "label": "Inventario",
        "icon": "package",
        "route": "/inventario"
      },
      {
        "key": "credit",
        "label": "Fiado",
        "icon": "notebook",
        "route": "/fiado"
      },
      {
        "key": "compras",
        "label": "Compras",
        "icon": "truck",
        "route": "/compras"
      },
      {
        "key": "caja",
        "label": "Caja",
        "icon": "wallet",
        "route": "/caja"
      },
      {
        "key": "reports",
        "label": "Reportes",
        "icon": "bar-chart",
        "route": "/reportes"
      }
    ],
    "pos": {
      "layout": "grid_with_images",
      "primary_action": "scan",
      "show_product_images": true,
      "show_stock_badge": true,
      "variant_selector": "none",
      "quick_filters": [
        "marca",
        "canasta_basica"
      ],
      "keypad": "numeric",
      "allow_price_override": false,
      "require_customer": false,
      "default_uom_selector": true
    },
    "product_form": {
      "groups": [
        "Básico",
        "Presentación",
        "Comercial",
        "Manejo",
        "Precios"
      ],
      "hidden_fields": [
        "track_serials",
        "age_restricted",
        "requires_prescription"
      ]
    },
    "dashboard_widgets": [
      "sales_today",
      "avg_ticket",
      "top_products",
      "low_stock",
      "near_expiry",
      "credit_outstanding",
      "peak_hours",
      "gross_margin"
    ]
  },
  "receipt": {
    "width_mm": 80,
    "show_attributes": [
      "marca"
    ],
    "show_weight_detail": true,
    "show_logo": true,
    "footer": "¡Gracias por su compra! Conserve su recibo para cualquier reclamo."
  },
  "roles": [
    {
      "code": "admin",
      "name": "Administrador",
      "permissions": [
        "*"
      ]
    },
    {
      "code": "cajero",
      "name": "Cajero",
      "permissions": [
        "sales.create",
        "sales.read_own",
        "sales.reprint",
        "sales.hold",
        "customers.create",
        "customers.read",
        "credit.charge",
        "credit.collect",
        "cash.open",
        "cash.close",
        "products.read",
        "attendance.clock"
      ],
      "constraints": {
        "max_discount_pct": 5,
        "requires_supervisor_pin": [
          "sales.void",
          "sales.refund"
        ]
      }
    },
    {
      "code": "inventario",
      "name": "Inventariador",
      "permissions": [
        "products.read",
        "products.create",
        "products.update",
        "inventory.read",
        "inventory.receive",
        "inventory.count",
        "inventory.lots",
        "purchasing.read",
        "purchasing.receive",
        "reports.inventory"
      ],
      "constraints": {
        "requires_supervisor_pin": [
          "inventory.adjust"
        ]
      }
    },
    {
      "code": "contador",
      "name": "Contador",
      "permissions": [
        "reports.sales",
        "reports.finance",
        "reports.credit",
        "reports.export",
        "finance.read",
        "taxes.read",
        "taxes.issue",
        "expenses.read",
        "expenses.create",
        "credit.read"
      ]
    }
  ],
  "automations": [
    {
      "key": "low_stock_alert",
      "enabled": true,
      "config": {
        "channel": "whatsapp",
        "threshold_source": "reorder_point"
      }
    },
    {
      "key": "expiry_alert",
      "enabled": true,
      "config": {
        "days_before": [
          15,
          7,
          3
        ]
      }
    },
    {
      "key": "collection_reminder",
      "enabled": true,
      "config": {
        "offsets_days": [
          -1,
          7,
          15
        ],
        "channel": "whatsapp"
      }
    },
    {
      "key": "loyalty_points",
      "enabled": true,
      "config": {
        "earn_per_currency": 1,
        "redeem_value": 0.02
      }
    },
    {
      "key": "restock_forecast",
      "enabled": true,
      "config": {
        "model": "moving_avg_28d"
      }
    },
    {
      "key": "daily_summary",
      "enabled": true,
      "config": {
        "hour_local": 21,
        "channel": "whatsapp"
      }
    }
  ],
  "reports": [
    "sales_by_category",
    "top_products",
    "dead_stock_60d",
    "margin_by_category",
    "near_expiry",
    "credit_aging",
    "peak_hours",
    "supplier_price_history"
  ]
}$manifest$::jsonb,
       'published', now(), 'Generado desde config/profiles/supermercado.json'
  FROM platform.business_profiles bp WHERE bp.slug = 'supermercado'
ON CONFLICT (profile_id, version) DO UPDATE
  SET manifest = EXCLUDED.manifest,
      status = 'published',
      published_at = COALESCE(platform.business_profile_versions.published_at, now()),
      changelog = EXCLUDED.changelog;

-- ── Taller / Servicio Técnico (taller) ─────────────────
INSERT INTO platform.business_profiles
  (slug, name, description, icon, category, primary_mode, is_public, sort_order)
VALUES ('taller', 'Taller / Servicio Técnico', 'Recepción de equipos o vehículos, diagnóstico, cotización, repuestos y garantía de la reparación.', 'wrench',
        'servicios', 'appointments', true, 80)
ON CONFLICT (slug) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      icon = EXCLUDED.icon,
      category = EXCLUDED.category,
      primary_mode = EXCLUDED.primary_mode,
      sort_order = EXCLUDED.sort_order;

INSERT INTO platform.business_profile_versions
  (profile_id, version, manifest, status, published_at, changelog)
SELECT bp.id, 1, $manifest${
  "$schema": "../schemas/business-profile.schema.json",
  "profile": {
    "slug": "taller",
    "name": "Taller / Servicio Técnico",
    "category": "servicios",
    "icon": "wrench",
    "version": 1,
    "primary_mode": "appointments",
    "description": "Recepción de equipos o vehículos, diagnóstico, cotización, repuestos y garantía de la reparación."
  },
  "modules": {
    "pos": {
      "enabled": true,
      "required": true,
      "layout": "service"
    },
    "inventory": {
      "enabled": true,
      "variants": true,
      "lots": false,
      "expiry": false,
      "serials": true,
      "label": "Repuestos"
    },
    "credit": {
      "enabled": true,
      "default_kind": "open_account"
    },
    "customers": {
      "enabled": true,
      "required": true
    },
    "loyalty": {
      "enabled": false
    },
    "purchasing": {
      "enabled": true
    },
    "expenses": {
      "enabled": true
    },
    "cash": {
      "enabled": true
    },
    "taxes": {
      "enabled": true
    },
    "storefront": {
      "enabled": true,
      "checkout_mode": "whatsapp",
      "mode": "booking"
    },
    "appointments": {
      "enabled": true,
      "required": true
    },
    "tables": {
      "enabled": false
    },
    "service_orders": {
      "enabled": true,
      "required": true
    },
    "employees": {
      "enabled": true,
      "commissions": true,
      "attendance": true,
      "bookable": true
    },
    "agro": {
      "enabled": false
    },
    "lending": {
      "enabled": false
    }
  },
  "operation_modes": [
    "appointments",
    "quick_pos"
  ],
  "uoms": [
    {
      "code": "UND",
      "name": "Unidad",
      "dimension": "unit",
      "factor_to_base": 1,
      "is_base": true,
      "precision": 0
    },
    {
      "code": "JUEGO",
      "name": "Juego",
      "dimension": "unit",
      "factor_to_base": 4,
      "precision": 0
    },
    {
      "code": "HORA",
      "name": "Hora de trabajo",
      "dimension": "time",
      "factor_to_base": 1,
      "is_base": true,
      "precision": 2
    },
    {
      "code": "MIN",
      "name": "Minuto",
      "dimension": "time",
      "factor_to_base": 0.016666667,
      "precision": 0
    },
    {
      "code": "L",
      "name": "Litro",
      "dimension": "volume",
      "factor_to_base": 1,
      "is_base": true,
      "precision": 3
    },
    {
      "code": "ML",
      "name": "Mililitro",
      "dimension": "volume",
      "factor_to_base": 0.001,
      "precision": 0
    },
    {
      "code": "GAL",
      "name": "Galón",
      "dimension": "volume",
      "factor_to_base": 3.78541,
      "precision": 3
    }
  ],
  "categories": [
    {
      "slug": "diagnostico",
      "name": "Diagnóstico",
      "color": "#0EA5E9",
      "icon": "search",
      "kind": "service"
    },
    {
      "slug": "mano-obra",
      "name": "Mano de Obra",
      "color": "#F59E0B",
      "icon": "wrench",
      "kind": "service"
    },
    {
      "slug": "mantenimiento",
      "name": "Mantenimiento Preventivo",
      "color": "#16A34A",
      "icon": "shield",
      "kind": "service"
    },
    {
      "slug": "repuestos",
      "name": "Repuestos",
      "color": "#64748B",
      "icon": "package"
    },
    {
      "slug": "lubricantes",
      "name": "Lubricantes y Fluidos",
      "color": "#CA8A04",
      "icon": "droplet"
    },
    {
      "slug": "accesorios",
      "name": "Accesorios",
      "color": "#8B5CF6",
      "icon": "sparkles"
    }
  ],
  "attributes": {
    "product": [
      {
        "key": "duration_min",
        "label": "Duración estimada",
        "data_type": "integer",
        "ui_widget": "stepper",
        "ui_group": "Servicio",
        "unit_suffix": "min",
        "default_value": 60,
        "show_in_pos": true,
        "position": 10,
        "validation": {
          "min": 5,
          "max": 960,
          "step": 15
        },
        "applies_to_categories": [
          "diagnostico",
          "mano-obra",
          "mantenimiento"
        ]
      },
      {
        "key": "nivel_tecnico",
        "label": "Nivel técnico requerido",
        "data_type": "enum",
        "ui_widget": "segmented",
        "ui_group": "Servicio",
        "position": 20,
        "options": [
          {
            "value": "auxiliar",
            "label": "Auxiliar"
          },
          {
            "value": "tecnico",
            "label": "Técnico"
          },
          {
            "value": "especialista",
            "label": "Especialista"
          }
        ]
      },
      {
        "key": "garantia_dias",
        "label": "Garantía del trabajo",
        "data_type": "integer",
        "ui_widget": "stepper",
        "ui_group": "Servicio",
        "unit_suffix": "días",
        "semantic_role": "warranty",
        "default_value": 30,
        "show_in_receipt": true,
        "position": 30
      },
      {
        "key": "commission_pct",
        "label": "Comisión del técnico",
        "data_type": "percent",
        "ui_widget": "number",
        "ui_group": "Comercial",
        "unit_suffix": "%",
        "default_value": 25,
        "position": 40
      },
      {
        "key": "compatibilidad",
        "label": "Compatible con",
        "data_type": "text",
        "ui_widget": "textarea",
        "ui_group": "Repuesto",
        "is_filterable": true,
        "position": 50,
        "applies_to_categories": [
          "repuestos",
          "accesorios"
        ]
      },
      {
        "key": "numero_parte",
        "label": "Número de parte (OEM)",
        "data_type": "text",
        "ui_widget": "text",
        "ui_group": "Repuesto",
        "is_filterable": true,
        "show_in_pos": true,
        "position": 60,
        "applies_to_categories": [
          "repuestos"
        ]
      },
      {
        "key": "tipo_repuesto",
        "label": "Tipo de repuesto",
        "data_type": "enum",
        "ui_widget": "segmented",
        "ui_group": "Repuesto",
        "is_variant_axis": true,
        "is_filterable": true,
        "show_in_pos": true,
        "position": 70,
        "options": [
          {
            "value": "original",
            "label": "Original (OEM)"
          },
          {
            "value": "alterno",
            "label": "Alterno"
          },
          {
            "value": "reconstruido",
            "label": "Reconstruido"
          },
          {
            "value": "usado",
            "label": "Usado"
          }
        ],
        "applies_to_categories": [
          "repuestos"
        ]
      },
      {
        "key": "viscosidad",
        "label": "Viscosidad",
        "data_type": "enum",
        "ui_widget": "select",
        "ui_group": "Repuesto",
        "is_filterable": true,
        "position": 80,
        "options": [
          {
            "value": "5w30",
            "label": "5W-30"
          },
          {
            "value": "10w30",
            "label": "10W-30"
          },
          {
            "value": "10w40",
            "label": "10W-40"
          },
          {
            "value": "15w40",
            "label": "15W-40"
          },
          {
            "value": "20w50",
            "label": "20W-50"
          }
        ],
        "applies_to_categories": [
          "lubricantes"
        ]
      }
    ],
    "service_order": [
      {
        "key": "marca",
        "label": "Marca",
        "data_type": "text",
        "ui_widget": "text",
        "ui_group": "Equipo",
        "is_required": true,
        "is_filterable": true,
        "position": 10
      },
      {
        "key": "modelo",
        "label": "Modelo",
        "data_type": "text",
        "ui_widget": "text",
        "ui_group": "Equipo",
        "is_required": true,
        "position": 20
      },
      {
        "key": "anio",
        "label": "Año",
        "data_type": "integer",
        "ui_widget": "number",
        "ui_group": "Equipo",
        "position": 30,
        "validation": {
          "min": 1950,
          "max": 2100
        }
      },
      {
        "key": "placa_serie",
        "label": "Placa / Número de serie",
        "data_type": "text",
        "ui_widget": "text",
        "ui_group": "Equipo",
        "semantic_role": "serial",
        "is_required": true,
        "is_filterable": true,
        "position": 40
      },
      {
        "key": "kilometraje",
        "label": "Kilometraje / Horas de uso",
        "data_type": "integer",
        "ui_widget": "number",
        "ui_group": "Equipo",
        "position": 50
      },
      {
        "key": "nivel_combustible",
        "label": "Nivel de combustible al ingresar",
        "data_type": "enum",
        "ui_widget": "segmented",
        "ui_group": "Recepción",
        "position": 60,
        "options": [
          {
            "value": "vacio",
            "label": "Vacío"
          },
          {
            "value": "1_4",
            "label": "1/4"
          },
          {
            "value": "1_2",
            "label": "1/2"
          },
          {
            "value": "3_4",
            "label": "3/4"
          },
          {
            "value": "lleno",
            "label": "Lleno"
          }
        ]
      },
      {
        "key": "accesorios_recibidos",
        "label": "Accesorios recibidos",
        "data_type": "multi_enum",
        "ui_widget": "chips",
        "ui_group": "Recepción",
        "position": 70,
        "options": [
          {
            "value": "llanta_repuesto",
            "label": "Llanta de repuesto"
          },
          {
            "value": "gato",
            "label": "Gato"
          },
          {
            "value": "herramientas",
            "label": "Herramientas"
          },
          {
            "value": "cargador",
            "label": "Cargador"
          },
          {
            "value": "estuche",
            "label": "Estuche"
          },
          {
            "value": "manual",
            "label": "Manual"
          }
        ]
      },
      {
        "key": "fotos_ingreso",
        "label": "Fotos del estado de ingreso",
        "data_type": "file",
        "ui_widget": "file_upload",
        "ui_group": "Recepción",
        "position": 80,
        "help_text": "Evita disputas por daños preexistentes."
      }
    ],
    "customer": [
      {
        "key": "empresa",
        "label": "Empresa",
        "data_type": "text",
        "is_filterable": true,
        "position": 10
      },
      {
        "key": "flota",
        "label": "Cliente de flota",
        "data_type": "boolean",
        "ui_widget": "toggle",
        "is_filterable": true,
        "position": 20
      }
    ],
    "employee": [
      {
        "key": "especialidad",
        "label": "Especialidad",
        "data_type": "multi_enum",
        "ui_widget": "chips",
        "position": 10,
        "options": [
          {
            "value": "motor",
            "label": "Motor"
          },
          {
            "value": "transmision",
            "label": "Transmisión"
          },
          {
            "value": "electrico",
            "label": "Sistema eléctrico"
          },
          {
            "value": "frenos",
            "label": "Frenos y suspensión"
          },
          {
            "value": "aire",
            "label": "Aire acondicionado"
          },
          {
            "value": "electronica",
            "label": "Electrónica / Diagnóstico"
          }
        ]
      },
      {
        "key": "certificaciones",
        "label": "Certificaciones",
        "data_type": "text",
        "ui_widget": "textarea",
        "position": 20
      }
    ]
  },
  "product_defaults": {
    "kind": "service",
    "track_inventory": false,
    "track_lots": false,
    "track_expiry": false,
    "is_sellable": true
  },
  "appointments": {
    "slot_minutes": 30,
    "advance_booking_days": 45,
    "min_notice_minutes": 120,
    "allow_online_booking": true,
    "require_deposit": false,
    "deposit_pct": 0,
    "no_show_policy": {
      "track": true,
      "block_after": 2
    },
    "reminders": [
      {
        "offset_hours": -24,
        "channel": "whatsapp"
      },
      {
        "offset_hours": -3,
        "channel": "whatsapp"
      }
    ],
    "resources": [
      {
        "kind": "bay",
        "label": "Bahía de trabajo"
      }
    ]
  },
  "ui": {
    "navigation": [
      {
        "key": "ordenes",
        "label": "Órdenes",
        "icon": "clipboard-list",
        "route": "/ordenes",
        "primary": true
      },
      {
        "key": "agenda",
        "label": "Agenda",
        "icon": "calendar",
        "route": "/agenda"
      },
      {
        "key": "pos",
        "label": "Cobrar",
        "icon": "shopping-cart",
        "route": "/pos"
      },
      {
        "key": "inventory",
        "label": "Repuestos",
        "icon": "package",
        "route": "/inventario"
      },
      {
        "key": "customers",
        "label": "Clientes",
        "icon": "users",
        "route": "/clientes"
      },
      {
        "key": "compras",
        "label": "Compras",
        "icon": "truck",
        "route": "/compras"
      },
      {
        "key": "reports",
        "label": "Reportes",
        "icon": "bar-chart",
        "route": "/reportes"
      }
    ],
    "pos": {
      "layout": "service_first",
      "primary_action": "select_service",
      "show_product_images": false,
      "show_stock_badge": true,
      "variant_selector": "inline_list",
      "variant_axes": [
        "tipo_repuesto"
      ],
      "quick_filters": [
        "numero_parte",
        "compatibilidad",
        "tipo_repuesto"
      ],
      "keypad": "numeric",
      "allow_price_override": true,
      "price_override_permission": "sales.price_override",
      "require_customer": true,
      "require_employee_per_line": true
    },
    "product_form": {
      "groups": [
        "Básico",
        "Servicio",
        "Repuesto",
        "Comercial",
        "Precios"
      ],
      "hidden_fields": [
        "track_lots",
        "track_expiry",
        "is_weighted",
        "age_restricted",
        "requires_prescription"
      ]
    },
    "dashboard_widgets": [
      "open_service_orders",
      "orders_by_status",
      "technician_workload",
      "avg_repair_time",
      "quote_approval_rate",
      "parts_low_stock",
      "commissions_pending",
      "warranty_returns"
    ]
  },
  "receipt": {
    "width_mm": 80,
    "show_attributes": [
      "numero_parte",
      "garantia_dias"
    ],
    "show_employee_name": true,
    "show_logo": true,
    "footer": "La garantía cubre exclusivamente el trabajo detallado. Conserve este comprobante."
  },
  "roles": [
    {
      "code": "admin",
      "name": "Administrador",
      "permissions": [
        "*"
      ]
    },
    {
      "code": "recepcion",
      "name": "Recepción",
      "permissions": [
        "service_orders.read",
        "service_orders.create",
        "service_orders.quote",
        "service_orders.deliver",
        "appointments.read",
        "appointments.create",
        "appointments.update",
        "appointments.cancel",
        "customers.create",
        "customers.read",
        "customers.update",
        "sales.create",
        "sales.read",
        "cash.open",
        "cash.close",
        "credit.charge",
        "credit.collect",
        "messaging.send"
      ],
      "constraints": {
        "max_discount_pct": 10,
        "requires_supervisor_pin": [
          "sales.void"
        ]
      }
    },
    {
      "code": "tecnico",
      "name": "Técnico",
      "permissions": [
        "service_orders.read",
        "service_orders.update",
        "appointments.read_own",
        "appointments.update_own",
        "products.read",
        "inventory.read",
        "inventory.consume",
        "attendance.clock",
        "commissions.read_own"
      ],
      "constraints": {
        "scope": "assigned_orders_only",
        "max_discount_pct": 0
      }
    },
    {
      "code": "almacen",
      "name": "Almacenista",
      "permissions": [
        "products.read",
        "products.create",
        "products.update",
        "inventory.read",
        "inventory.receive",
        "inventory.transfer",
        "inventory.count",
        "purchasing.read",
        "purchasing.create",
        "purchasing.receive",
        "reports.inventory",
        "attendance.clock"
      ],
      "constraints": {
        "requires_supervisor_pin": [
          "inventory.adjust"
        ]
      }
    },
    {
      "code": "contador",
      "name": "Contador",
      "permissions": [
        "reports.sales",
        "reports.finance",
        "reports.credit",
        "reports.employees",
        "reports.export",
        "finance.read",
        "taxes.read",
        "taxes.issue",
        "expenses.read",
        "expenses.create",
        "commissions.read",
        "commissions.settle"
      ]
    }
  ],
  "automations": [
    {
      "key": "appointment_reminder",
      "enabled": true,
      "config": {
        "offsets_hours": [
          -24,
          -3
        ],
        "channel": "whatsapp"
      }
    },
    {
      "key": "order_status_update",
      "enabled": true,
      "config": {
        "on_status": [
          "quoted",
          "completed"
        ],
        "channel": "whatsapp"
      }
    },
    {
      "key": "quote_followup",
      "enabled": true,
      "config": {
        "days_after": 1,
        "channel": "whatsapp"
      }
    },
    {
      "key": "maintenance_reminder",
      "enabled": true,
      "config": {
        "days_after_service": 150,
        "channel": "whatsapp"
      }
    },
    {
      "key": "low_stock_alert",
      "enabled": true,
      "config": {
        "channel": "whatsapp",
        "threshold_source": "reorder_point"
      }
    },
    {
      "key": "commission_closeout",
      "enabled": true,
      "config": {
        "frequency": "biweekly"
      }
    },
    {
      "key": "collection_reminder",
      "enabled": true,
      "config": {
        "offsets_days": [
          -2,
          7,
          15
        ],
        "channel": "whatsapp"
      }
    }
  ],
  "reports": [
    "orders_by_status",
    "avg_repair_time",
    "technician_productivity",
    "quote_conversion",
    "parts_vs_labor_mix",
    "warranty_returns",
    "commission_settlement",
    "credit_aging"
  ]
}$manifest$::jsonb,
       'published', now(), 'Generado desde config/profiles/taller.json'
  FROM platform.business_profiles bp WHERE bp.slug = 'taller'
ON CONFLICT (profile_id, version) DO UPDATE
  SET manifest = EXCLUDED.manifest,
      status = 'published',
      published_at = COALESCE(platform.business_profile_versions.published_at, now()),
      changelog = EXCLUDED.changelog;

-- ── Tienda de Vapes (vape_shop) ────────────────────────
INSERT INTO platform.business_profiles
  (slug, name, description, icon, category, primary_mode, is_public, sort_order)
VALUES ('vape_shop', 'Tienda de Vapes', 'Retail con alta variabilidad de SKU por sabor y nicotina, control de edad y garantía de dispositivos.', 'cloud',
        'retail', 'variant_inventory', true, 90)
ON CONFLICT (slug) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      icon = EXCLUDED.icon,
      category = EXCLUDED.category,
      primary_mode = EXCLUDED.primary_mode,
      sort_order = EXCLUDED.sort_order;

INSERT INTO platform.business_profile_versions
  (profile_id, version, manifest, status, published_at, changelog)
SELECT bp.id, 1, $manifest${
  "$schema": "../schemas/business-profile.schema.json",
  "profile": {
    "slug": "vape_shop",
    "name": "Tienda de Vapes",
    "category": "retail",
    "icon": "cloud",
    "version": 1,
    "primary_mode": "variant_inventory",
    "description": "Retail con alta variabilidad de SKU por sabor y nicotina, control de edad y garantía de dispositivos."
  },
  "modules": {
    "pos": {
      "enabled": true,
      "required": true
    },
    "inventory": {
      "enabled": true,
      "variants": true,
      "lots": false,
      "expiry": false,
      "serials": true
    },
    "credit": {
      "enabled": true,
      "default_kind": "open_account"
    },
    "customers": {
      "enabled": true
    },
    "loyalty": {
      "enabled": true,
      "default_program": "points"
    },
    "purchasing": {
      "enabled": true
    },
    "expenses": {
      "enabled": true
    },
    "cash": {
      "enabled": true
    },
    "taxes": {
      "enabled": true
    },
    "storefront": {
      "enabled": true,
      "checkout_mode": "whatsapp"
    },
    "appointments": {
      "enabled": false
    },
    "tables": {
      "enabled": false
    },
    "service_orders": {
      "enabled": true,
      "label": "Garantías y RMA"
    },
    "employees": {
      "enabled": true,
      "commissions": true,
      "attendance": false
    },
    "agro": {
      "enabled": false
    },
    "lending": {
      "enabled": false
    }
  },
  "operation_modes": [
    "variant_inventory",
    "quick_pos"
  ],
  "compliance": {
    "age_verification": {
      "enabled": true,
      "min_age": 18,
      "prompt": "Verificar identificación: producto restringido para mayores de 18 años.",
      "blocking": true,
      "applies_to_categories": [
        "desechables",
        "liquidos",
        "dispositivos"
      ]
    }
  },
  "uoms": [
    {
      "code": "UND",
      "name": "Unidad",
      "dimension": "unit",
      "factor_to_base": 1,
      "is_base": true,
      "precision": 0
    },
    {
      "code": "CAJA",
      "name": "Caja",
      "dimension": "unit",
      "factor_to_base": 10,
      "precision": 0
    },
    {
      "code": "ML",
      "name": "Mililitro",
      "dimension": "volume",
      "factor_to_base": 0.001,
      "precision": 0
    },
    {
      "code": "L",
      "name": "Litro",
      "dimension": "volume",
      "factor_to_base": 1,
      "is_base": true,
      "precision": 3
    }
  ],
  "categories": [
    {
      "slug": "desechables",
      "name": "Vapes Desechables",
      "color": "#8B5CF6",
      "icon": "wind"
    },
    {
      "slug": "liquidos",
      "name": "E-Líquidos",
      "color": "#06B6D4",
      "icon": "droplet"
    },
    {
      "slug": "dispositivos",
      "name": "Dispositivos y Mods",
      "color": "#F59E0B",
      "icon": "battery"
    },
    {
      "slug": "resistencias",
      "name": "Resistencias y Coils",
      "color": "#EF4444",
      "icon": "zap"
    },
    {
      "slug": "accesorios",
      "name": "Accesorios",
      "color": "#64748B",
      "icon": "package"
    }
  ],
  "attributes": {
    "product": [
      {
        "key": "flavor",
        "label": "Sabor",
        "data_type": "enum",
        "ui_widget": "chips",
        "ui_group": "Características",
        "is_variant_axis": true,
        "is_filterable": true,
        "show_in_pos": true,
        "show_in_receipt": true,
        "position": 10,
        "options": [
          {
            "value": "mango_ice",
            "label": "Mango Ice"
          },
          {
            "value": "blue_razz",
            "label": "Blue Razz"
          },
          {
            "value": "mint",
            "label": "Menta"
          },
          {
            "value": "strawberry_kiwi",
            "label": "Fresa Kiwi"
          },
          {
            "value": "tobacco",
            "label": "Tabaco"
          },
          {
            "value": "watermelon",
            "label": "Sandía"
          }
        ],
        "validation": {
          "required": true
        },
        "applies_to_categories": [
          "desechables",
          "liquidos"
        ]
      },
      {
        "key": "nicotine_mg",
        "label": "Nivel de nicotina",
        "data_type": "enum",
        "ui_widget": "segmented",
        "ui_group": "Características",
        "unit_suffix": "mg",
        "is_variant_axis": true,
        "is_filterable": true,
        "show_in_pos": true,
        "semantic_role": "potency",
        "position": 20,
        "options": [
          {
            "value": "0",
            "label": "0 mg (Sin nicotina)"
          },
          {
            "value": "3",
            "label": "3 mg"
          },
          {
            "value": "6",
            "label": "6 mg"
          },
          {
            "value": "20",
            "label": "20 mg"
          },
          {
            "value": "50",
            "label": "50 mg (5%)"
          }
        ],
        "validation": {
          "required": true
        },
        "applies_to_categories": [
          "desechables",
          "liquidos"
        ]
      },
      {
        "key": "puffs",
        "label": "Puffs (caladas)",
        "data_type": "integer",
        "ui_widget": "number",
        "ui_group": "Características",
        "unit_suffix": "puffs",
        "is_filterable": true,
        "show_in_pos": true,
        "position": 30,
        "validation": {
          "min": 100,
          "max": 50000
        },
        "applies_to_categories": [
          "desechables"
        ]
      },
      {
        "key": "volume_ml",
        "label": "Volumen",
        "data_type": "number",
        "ui_widget": "number",
        "ui_group": "Características",
        "unit_suffix": "ml",
        "is_filterable": true,
        "position": 40,
        "validation": {
          "min": 0.5,
          "max": 200
        },
        "applies_to_categories": [
          "desechables",
          "liquidos"
        ]
      },
      {
        "key": "vg_pg_ratio",
        "label": "Ratio VG/PG",
        "data_type": "enum",
        "ui_widget": "select",
        "ui_group": "Características",
        "position": 50,
        "options": [
          {
            "value": "50_50",
            "label": "50/50"
          },
          {
            "value": "70_30",
            "label": "70/30"
          },
          {
            "value": "80_20",
            "label": "80/20"
          }
        ],
        "applies_to_categories": [
          "liquidos"
        ]
      },
      {
        "key": "battery_mah",
        "label": "Batería",
        "data_type": "integer",
        "ui_widget": "number",
        "ui_group": "Especificaciones",
        "unit_suffix": "mAh",
        "position": 60,
        "applies_to_categories": [
          "desechables",
          "dispositivos"
        ]
      },
      {
        "key": "resistance_ohm",
        "label": "Resistencia",
        "data_type": "number",
        "ui_widget": "number",
        "ui_group": "Especificaciones",
        "unit_suffix": "Ω",
        "position": 70,
        "applies_to_categories": [
          "resistencias",
          "dispositivos"
        ]
      },
      {
        "key": "warranty_days",
        "label": "Garantía",
        "data_type": "integer",
        "ui_widget": "number",
        "ui_group": "Comercial",
        "unit_suffix": "días",
        "semantic_role": "warranty",
        "default_value": 30,
        "position": 80,
        "applies_to_categories": [
          "dispositivos"
        ]
      }
    ],
    "customer": [
      {
        "key": "preferred_flavor",
        "label": "Sabor preferido",
        "data_type": "multi_enum",
        "ui_widget": "chips",
        "is_filterable": true,
        "position": 10,
        "options": [
          {
            "value": "mango_ice",
            "label": "Mango Ice"
          },
          {
            "value": "blue_razz",
            "label": "Blue Razz"
          },
          {
            "value": "mint",
            "label": "Menta"
          },
          {
            "value": "strawberry_kiwi",
            "label": "Fresa Kiwi"
          },
          {
            "value": "tobacco",
            "label": "Tabaco"
          },
          {
            "value": "watermelon",
            "label": "Sandía"
          }
        ]
      },
      {
        "key": "id_verified_at",
        "label": "Identificación verificada",
        "data_type": "date",
        "ui_widget": "date_picker",
        "position": 20
      }
    ]
  },
  "product_defaults": {
    "track_inventory": true,
    "track_lots": false,
    "track_expiry": false,
    "track_serials": false,
    "age_restricted": true,
    "reorder_point": 5
  },
  "ui": {
    "navigation": [
      {
        "key": "pos",
        "label": "Vender",
        "icon": "shopping-cart",
        "route": "/pos",
        "primary": true
      },
      {
        "key": "inventory",
        "label": "Inventario",
        "icon": "package",
        "route": "/inventario"
      },
      {
        "key": "credit",
        "label": "Fiado",
        "icon": "notebook",
        "route": "/fiado"
      },
      {
        "key": "customers",
        "label": "Clientes",
        "icon": "users",
        "route": "/clientes"
      },
      {
        "key": "reports",
        "label": "Reportes",
        "icon": "bar-chart",
        "route": "/reportes"
      },
      {
        "key": "storefront",
        "label": "Mi Tienda",
        "icon": "globe",
        "route": "/tienda"
      }
    ],
    "pos": {
      "layout": "grid_with_images",
      "primary_action": "scan",
      "show_product_images": true,
      "show_stock_badge": true,
      "variant_selector": "modal_matrix",
      "variant_axes": [
        "flavor",
        "nicotine_mg"
      ],
      "quick_filters": [
        "flavor",
        "nicotine_mg",
        "puffs"
      ],
      "keypad": "numeric",
      "allow_price_override": false,
      "require_customer": false
    },
    "product_form": {
      "groups": [
        "Básico",
        "Características",
        "Especificaciones",
        "Precios",
        "Comercial"
      ],
      "hidden_fields": [
        "track_lots",
        "track_expiry",
        "biological_lot_id"
      ]
    },
    "dashboard_widgets": [
      "sales_today",
      "avg_ticket",
      "top_flavors",
      "low_stock",
      "gross_margin",
      "credit_outstanding",
      "peak_hours"
    ]
  },
  "receipt": {
    "width_mm": 58,
    "show_attributes": [
      "flavor",
      "nicotine_mg"
    ],
    "footer": "Producto para mayores de 18 años. No se aceptan devoluciones de líquidos abiertos.",
    "show_logo": true,
    "show_qr_storefront": true
  },
  "roles": [
    {
      "code": "admin",
      "name": "Administrador",
      "permissions": [
        "*"
      ]
    },
    {
      "code": "cajero",
      "name": "Cajero",
      "permissions": [
        "sales.create",
        "sales.read",
        "customers.create",
        "customers.read",
        "credit.charge",
        "credit.collect",
        "cash.open",
        "cash.close",
        "products.read"
      ],
      "constraints": {
        "max_discount_pct": 10,
        "requires_supervisor_pin": [
          "sales.void"
        ]
      }
    },
    {
      "code": "inventario",
      "name": "Inventariador",
      "permissions": [
        "products.*",
        "inventory.*",
        "purchasing.read",
        "reports.inventory"
      ],
      "constraints": {
        "requires_supervisor_pin": [
          "inventory.adjust"
        ]
      }
    },
    {
      "code": "contador",
      "name": "Contador",
      "permissions": [
        "reports.*",
        "finance.read",
        "taxes.*",
        "expenses.*",
        "credit.read"
      ]
    }
  ],
  "automations": [
    {
      "key": "low_stock_alert",
      "enabled": true,
      "config": {
        "channel": "whatsapp",
        "threshold_source": "reorder_point"
      }
    },
    {
      "key": "collection_reminder",
      "enabled": true,
      "config": {
        "offsets_days": [
          -1,
          3,
          7
        ],
        "channel": "whatsapp"
      }
    },
    {
      "key": "loyalty_points",
      "enabled": true,
      "config": {
        "earn_per_currency": 1,
        "redeem_value": 0.05
      }
    },
    {
      "key": "restock_forecast",
      "enabled": true,
      "config": {
        "model": "moving_avg_28d"
      }
    }
  ],
  "reports": [
    "sales_by_flavor",
    "nicotine_mix",
    "dead_stock_90d",
    "margin_by_category",
    "credit_aging",
    "top_customers"
  ]
}$manifest$::jsonb,
       'published', now(), 'Generado desde config/profiles/vape_shop.json'
  FROM platform.business_profiles bp WHERE bp.slug = 'vape_shop'
ON CONFLICT (profile_id, version) DO UPDATE
  SET manifest = EXCLUDED.manifest,
      status = 'published',
      published_at = COALESCE(platform.business_profile_versions.published_at, now()),
      changelog = EXCLUDED.changelog;

-- Comprobación: ningún perfil puede quedar sin versión publicada
DO $check$
DECLARE v_orphans int;
BEGIN
  SELECT count(*) INTO v_orphans
    FROM platform.business_profiles bp
   WHERE NOT EXISTS (SELECT 1 FROM platform.business_profile_versions v
                      WHERE v.profile_id = bp.id AND v.status = 'published');
  IF v_orphans > 0 THEN
    RAISE EXCEPTION '% perfil(es) sin versión publicada', v_orphans;
  END IF;
END $check$;

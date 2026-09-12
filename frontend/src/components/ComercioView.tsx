import { useEffect, useRef, useState } from "react";
import { api, ApiError, assetUrl, type Negocio } from "../api";
import { useT } from "../i18n";
import { usePrompt } from "./Ui";

// Módulo POS + Inventario + Caja (rubros de retail/alimentos: supermercado, vape, ferretería, farmacia…).
interface Producto {
  id: string; nombre: string; sku: string | null; categoria: string | null; unidad: string;
  precioVenta: string | number; impuestoPct: string | number; costo: string | number | null;
  stock: string | number; stockMinimo: string | number; activo: boolean;
  // Líquidos de vapeo (opcionales).
  volumenMl: string | number | null; nicotinaMg: string | number | null;
  // Si este producto (p. ej. "Recarga") descuenta stock de OTRO producto (el pote) en vez de
  // llevar stock propio.
  productoFuenteId: string | null; rendimientoPorVenta: string | number | null;
  imagenUrl: string | null;
  tipoProducto: "consumible" | "hardware";
  notasTecnicas: string | null;
  // Trazabilidad de lote/vencimiento (farmacia, panadería, perecederos).
  loteNumero: string | null; fechaVencimiento: string | null;
  // Sabor/variante de una línea (ej. "Recargas": Mango, Fresa...) — apunta al producto base.
  varianteBaseId: string | null;
}
interface Sesion { id: string; montoInicial: string | number; abiertaEn: string; estado: string }
interface LineaVentaRecibo { nombre: string; cantidad: string | number; precioUnit: string | number; subtotal: string | number }
interface Venta {
  id: string; total: string | number; subtotal?: string | number; impuesto?: string | number;
  metodoPago: string; createdAt: string;
  anulada: boolean; anuladaEn: string | null; motivoAnulacion: string | null;
  lineas?: LineaVentaRecibo[];
}

const money = (n: number | string) => `$${Number(n).toFixed(2)}`;
const num = (n: number | string | null) => Number(n ?? 0);

// Unidades de medida más comunes en un negocio dominicano — el que no calce elige "Otra" y
// escribe la que necesite (ej. "QQ" quintal, "RACIMO", lo que sea propio de su rubro).
const UNIDADES_COMUNES = ["UND", "LB", "KG", "G", "L", "ML", "M", "DOCENA", "CAJA", "PAR"];

// Días que faltan para vencer (negativo = ya vencido). Comparación por fecha local, no UTC —
// evita marcar como vencido algo que vence hoy mismo por diferencia de huso horario.
function diasParaVencer(fecha: string): number {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const venc = new Date(fecha); venc.setHours(0, 0, 0, 0);
  return Math.round((venc.getTime() - hoy.getTime()) / 86400000);
}

interface PerfilDispositivo { id: string; nombre: string; capacidadMl: string | number; precio: string | number | null }
// Ícono según la capacidad — puramente visual, no hay foto real de "tamaño genérico de tanque".
function iconoPerfil(ml: number): string {
  if (ml <= 2) return "💧";
  if (ml <= 4) return "🔹";
  if (ml <= 6) return "🔷";
  return "🟪";
}

// ---------- VENDER (POS) ----------
// `esRecarga`: esta línea es una recarga de líquido (cantidad = ml) — permite mostrar el
// selector para cambiar de sabor sin tener que borrar la línea y volver a empezar.
interface LineaCarrito { productoId?: string; nombre: string; cantidad: number; precioUnit: number; impuestoPct: number; esRecarga?: boolean }
interface ClienteLite { id: string; nombre: string; telefono: string | null; saldoFiado: string | number }

export function Vender({ negocio, credit }: { negocio: Negocio; credit: boolean }) {
  const { t } = useT();
  const [busqueda, setBusqueda] = useState("");
  const [resultados, setResultados] = useState<Producto[]>([]);
  // Si se buscó/eligió la LÍNEA (ej. "Recargas", que no se vende directo) en vez de un sabor
  // puntual, primero hay que elegir cuál de sus sabores es — cada uno es un producto real.
  const [lineaSeleccionada, setLineaSeleccionada] = useState<Producto | null>(null);
  const [carrito, setCarrito] = useState<LineaCarrito[]>([]);
  const [metodoPago, setMetodoPago] = useState("efectivo");
  const [clienteQ, setClienteQ] = useState("");
  const [clienteResultados, setClienteResultados] = useState<ClienteLite[]>([]);
  const [clienteSel, setClienteSel] = useState<ClienteLite | null>(null);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [reciboVenta, setReciboVenta] = useState<Venta | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Líquido elegido esperando que el cajero indique cuántos ml se lleva el cliente (el tamaño
  // del tanque varía por cliente: pod de 2ml, tanque de 4ml, 6ml...). precioVenta del líquido
  // es el valor del pote COMPLETO (ej. $900 el pote de 100ml) — el precio por ml y el de la
  // recarga se calculan solos a partir de eso, no hace falta cargarlos a mano cada vez.
  const [recargaPendiente, setRecargaPendiente] = useState<Producto | null>(null);
  const [mlRecarga, setMlRecarga] = useState("");
  // Precio de venta de ESTA recarga: se sugiere proporcional al precio del pote, pero el
  // cajero lo puede ajustar libremente antes de confirmar (el negocio decide cuánto cobrar,
  // el sistema solo calcula el costo/margen de referencia).
  const [precioRecargaEditado, setPrecioRecargaEditado] = useState<string | null>(null);
  // Perfiles de dispositivo (Pod Estándar 2ml, Mod Mediano 5ml...) configurados por el dueño
  // en Inventario — reemplazan tener que escribir los ml cada vez.
  const [perfiles, setPerfiles] = useState<PerfilDispositivo[]>([]);
  useEffect(() => {
    api.get<{ perfiles: PerfilDispositivo[] }>(`/dispositivos?negocioId=${negocio.id}`).then((r) => setPerfiles(r.perfiles)).catch(() => {});
  }, [negocio.id]);
  // Todos los líquidos del negocio (productos con volumenMl) — para poder cambiar de sabor una
  // recarga ya puesta en el carrito sin borrarla y volver a buscar desde cero.
  const [liquidos, setLiquidos] = useState<Producto[]>([]);
  useEffect(() => {
    api.get<{ productos: Producto[] }>(`/inventario?negocioId=${negocio.id}`)
      .then((r) => setLiquidos(r.productos.filter((p) => p.volumenMl != null && num(p.volumenMl) > 0)))
      .catch(() => {});
  }, [negocio.id]);

  // Búsqueda de cliente para fiar la venta (solo si el rubro tiene el módulo de crédito).
  useEffect(() => {
    const necesitaCliente = metodoPago === "fiado" || metodoPago === "apartado";
    if (!credit || !necesitaCliente || !clienteQ.trim()) { setClienteResultados([]); return; }
    const t2 = setTimeout(() => {
      api.get<{ clientes: ClienteLite[] }>(`/clientes?negocioId=${negocio.id}&q=${encodeURIComponent(clienteQ)}`)
        .then((r) => setClienteResultados(r.clientes)).catch(() => {});
    }, 200);
    return () => clearTimeout(t2);
  }, [credit, metodoPago, clienteQ, negocio.id]);

  // Sin nada escrito, muestra todo el catálogo (para que se vea de una qué hay para vender);
  // al escribir, filtra por nombre/código/línea — útil cuando hay demasiados productos para
  // desplazarse a mano. Un escáner escribe el código + Enter.
  useEffect(() => {
    const q = busqueda.trim();
    const t2 = setTimeout(() => {
      api.get<{ productos: Producto[] }>(`/inventario?negocioId=${negocio.id}${q ? `&q=${encodeURIComponent(q)}` : ""}`)
        .then((r) => setResultados(r.productos)).catch(() => {});
    }, 200);
    return () => clearTimeout(t2);
  }, [busqueda, negocio.id]);

function agregar(p: Producto) {
    // "Recargas" (la línea) no se vende directo — es la plantilla. Si tiene sabores
    // vinculados, buscarla y elegirla lleva primero a elegir CUÁL sabor (que sí es un
    // producto real, con su propio stock) antes de seguir con el tanque/ml.
    const saboresDeLaLinea = liquidos.filter((x) => x.varianteBaseId === p.id);
    if (saboresDeLaLinea.length > 0) {
      setLineaSeleccionada(p); setBusqueda(""); setResultados([]);
      return;
    }
    // Un líquido con volumen (ml) no se vende "1 unidad = el pote entero": se pregunta cuántos
    // ml se lleva el cliente y se calcula el precio proporcional al pote.
    if (p.volumenMl != null && num(p.volumenMl) > 0) {
      setRecargaPendiente(p); setMlRecarga(""); setPrecioRecargaEditado(null); setBusqueda(""); setResultados([]);
      return;
    }
    setCarrito((c) => {
      const i = c.findIndex((l) => l.productoId === p.id);
      if (i >= 0) { const cp = [...c]; cp[i] = { ...cp[i], cantidad: cp[i].cantidad + 1 }; return cp; }
      return [...c, { productoId: p.id, nombre: p.nombre, cantidad: 1, precioUnit: num(p.precioVenta), impuestoPct: num(p.impuestoPct) }];
    });
    setBusqueda(""); setResultados([]); inputRef.current?.focus();
  }

  // Precio por ml del pote (valor total del pote / sus ml), y precio de la recarga según los
  // ml que pida el cajero para ESTE cliente puntual.
  function precioPorMl(p: Producto): number {
    const vol = num(p.volumenMl);
    return vol > 0 ? num(p.precioVenta) / vol : 0;
  }
  // Costo por ml (si el dueño cargó el costo del pote) — para ver el costo base de la recarga
  // y calcular la ganancia real, no solo el precio de venta.
  function costoPorMl(p: Producto): number | null {
    const vol = num(p.volumenMl);
    return vol > 0 && p.costo != null ? num(p.costo) / vol : null;
  }

  function confirmarRecarga() {
    if (!recargaPendiente) return;
    const ml = Number(mlRecarga);
    if (!ml || ml <= 0) return;
    const p = recargaPendiente;
    // Si el cajero no tocó el precio sugerido, se usa el proporcional; si lo editó, se usa
    // lo que puso (el negocio decide el precio final de la recarga).
    const precioTotal = precioRecargaEditado != null ? Number(precioRecargaEditado) : ml * precioPorMl(p);
    const precioUnit = precioTotal / ml;
    setCarrito((c) => [...c, {
      productoId: p.id,
      nombre: `${p.nombre} (${ml} ml)`,
      cantidad: ml,
      precioUnit,
      impuestoPct: num(p.impuestoPct),
      esRecarga: true,
    }]);
    setRecargaPendiente(null); setMlRecarga(""); setPrecioRecargaEditado(null); inputRef.current?.focus();
  }

  function setCant(i: number, cantidad: number) {
    const nueva = Math.max(0, cantidad);
    setCarrito((c) => c.map((l, k) => {
      if (k !== i) return l;
      // Si es una recarga, el nombre lleva los ml adentro ("Mango (4 ml)") — hay que
      // actualizarlo para que no quede desincronizado del número real que se va a cobrar.
      if (l.esRecarga) {
        const base = liquidos.find((p) => p.id === l.productoId);
        const nombreBase = base?.nombre ?? l.nombre.replace(/\s*\(\d+(\.\d+)?\s*ml\)$/, "");
        return { ...l, cantidad: nueva, nombre: `${nombreBase} (${nueva} ml)` };
      }
      return { ...l, cantidad: nueva };
    }).filter((l) => l.cantidad > 0));
  }

  // Cambia a qué líquido descuenta una recarga ya puesta en el carrito (se eligió mal el sabor)
  // — mantiene los mismos ml, recalcula el precio proporcional al pote del nuevo líquido.
  function cambiarSaborRecarga(i: number, nuevoProductoId: string) {
    const nuevo = liquidos.find((p) => p.id === nuevoProductoId);
    if (!nuevo) return;
    setCarrito((c) => c.map((l, k) => {
      if (k !== i) return l;
      const precioUnit = precioPorMl(nuevo);
      return { ...l, productoId: nuevo.id, nombre: `${nuevo.nombre} (${l.cantidad} ml)`, precioUnit, impuestoPct: num(nuevo.impuestoPct) };
    }));
  }

  // Al escanear un código de barras, el lector "escribe" el código muy rápido y termina con
  // Enter — mucho más rápido que el debounce de 200ms de arriba, así que acá no confiamos en
  // `resultados` (puede estar vacío o desactualizado): se busca de una y se agrega si hay
  // coincidencia exacta de SKU/código de barras, o si quedó un único resultado.
  async function onEnter(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const codigo = busqueda.trim();
    if (!codigo) return;
    try {
      const r = await api.get<{ productos: Producto[] }>(`/inventario?negocioId=${negocio.id}&q=${encodeURIComponent(codigo)}`);
      const exacto = r.productos.find((p) => p.sku && p.sku.toLowerCase() === codigo.toLowerCase());
      if (exacto) { agregar(exacto); return; }
      if (r.productos.length === 1) { agregar(r.productos[0]); return; }
      setResultados(r.productos);
    } catch {
      // sin conexión momentánea: se deja el texto para reintentar o elegir de la lista ya cargada
    }
  }

  const subtotal = carrito.reduce((s, l) => s + l.cantidad * l.precioUnit, 0);
  const impuesto = carrito.reduce((s, l) => s + (l.cantidad * l.precioUnit * l.impuestoPct) / 100, 0);
  const total = subtotal + impuesto;

  async function cobrar() {
    setError(""); setMsg("");
    if (carrito.length === 0) return;
    if ((metodoPago === "fiado" || metodoPago === "apartado") && !clienteSel) { setError(t("pos.chooseCustomer")); return; }
    try {
      const r = await api.post<{ venta: Venta }>("/pos/ventas", { negocioId: negocio.id, metodoPago, clienteId: clienteSel?.id, lineas: carrito });
      setMsg(`${t("pos.saleRegistered")}: ${money(total)}`);
      setReciboVenta(r.venta);
      setCarrito([]); setClienteSel(null); setClienteQ("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("pos.chargeError"));
    }
  }

  return (
    <div>
      <input ref={inputRef} placeholder={t("pos.searchPh")} value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)} onKeyDown={onEnter} autoFocus />

      {lineaSeleccionada && (
        <div className="card" style={{ background: "var(--surface-2)", marginTop: 6, maxHeight: 300, overflowY: "auto" }}>
          <div className="row spread">
            <strong className="small muted">{t("pos.flavorPickHint")} "{lineaSeleccionada.nombre}"</strong>
            <button type="button" className="ghost small" onClick={() => setLineaSeleccionada(null)}>{t("common.cancel")}</button>
          </div>
          {liquidos.filter((x) => x.varianteBaseId === lineaSeleccionada.id).map((p) => (
            <div className="list-item" key={p.id} style={{ cursor: "pointer" }} onClick={() => { agregar(p); setLineaSeleccionada(null); }}>
              <div className="row" style={{ gap: 10 }}>
                {p.imagenUrl && <img src={assetUrl(p.imagenUrl)} alt="" style={{ width: 40, height: 40, borderRadius: 8, objectFit: "cover" }} />}
                <div>
                  <strong>{p.nombre}</strong><br />
                  <span className="muted small">{t("pos.stock")}: {num(p.stock)} ml · {money(precioPorMl(p))}/ml</span>
                </div>
              </div>
              <strong>{t("pos.refillCta")}</strong>
            </div>
          ))}
        </div>
      )}

      {resultados.length > 0 && (
        <div className="card" style={{ background: "var(--surface-2)", marginTop: 6, maxHeight: 220, overflowY: "auto" }}>
          {resultados.map((p) => {
            const esLiquido = p.volumenMl != null && num(p.volumenMl) > 0;
            const esLinea = liquidos.some((x) => x.varianteBaseId === p.id);
            return (
              <div className="list-item" key={p.id} style={{ cursor: "pointer" }} onClick={() => agregar(p)}>
                <div className="row" style={{ gap: 10 }}>
                  {p.imagenUrl && <img src={assetUrl(p.imagenUrl)} alt="" style={{ width: 36, height: 36, borderRadius: 6, objectFit: "cover" }} />}
                  <div>
                    <strong>{p.nombre}</strong> <span className="muted small">{p.sku ?? ""}</span><br />
                    <span className="muted small">
                      {esLinea
                        ? t("pos.flavorLineHint")
                        : esLiquido
                          ? `${t("pos.stock")}: ${num(p.stock)} ml · ${money(precioPorMl(p))}/ml`
                          : `${t("pos.stock")}: ${num(p.stock)} ${p.unidad}`}
                    </span>
                  </div>
                </div>
                <strong>{esLinea ? t("pos.flavorPickCta") : esLiquido ? t("pos.refillCta") : money(p.precioVenta)}</strong>
              </div>
            );
          })}
        </div>
      )}

      {recargaPendiente && (
        <div className="card" style={{ background: "var(--surface-2)", marginTop: 6 }}>
          <div className="row" style={{ gap: 10, alignItems: "flex-start" }}>
            {recargaPendiente.imagenUrl && (
              <img src={assetUrl(recargaPendiente.imagenUrl)} alt="" style={{ width: 56, height: 56, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />
            )}
            <div>
              <h3 style={{ margin: 0 }}>{t("pos.refillTitle")} {recargaPendiente.nombre}</h3>
              <p className="muted small" style={{ margin: "2px 0 0" }}>
                {t("pos.refillStock")}: {num(recargaPendiente.stock)} ml · {money(precioPorMl(recargaPendiente))}/ml
              </p>
            </div>
          </div>
          {recargaPendiente.notasTecnicas && (
            <p className="small" style={{ marginTop: 8, background: "var(--surface-3)", padding: 8, borderRadius: 8 }}>
              💡 {recargaPendiente.notasTecnicas}
            </p>
          )}

          {/* Vender el pote entero es otra venta distinta a una recarga (no es un servicio
              parcial, es el producto completo) — pero descuenta del MISMO producto: son los
              mismos ml de stock, solo que de una sola vez en vez de a pedacitos. */}
          <button
            type="button" className="ghost" style={{ marginTop: 10, width: "100%" }}
            onClick={() => { setMlRecarga(String(num(recargaPendiente.volumenMl))); setPrecioRecargaEditado(null); }}
          >
            🍾 {t("pos.sellWholeBottle")} ({num(recargaPendiente.volumenMl)}ml) — {money(recargaPendiente.precioVenta)}
          </button>

          <label style={{ marginTop: 10 }}>{t("pos.refillTank")}</label>
          <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
            {perfiles.map((tk) => {
              const ml = num(tk.capacidadMl);
              return (
                <button
                  key={tk.id}
                  type="button"
                  className={`ghost small ${mlRecarga === String(ml) ? "active" : ""}`}
                  style={mlRecarga === String(ml) ? { borderColor: "var(--brand-500)", color: "var(--brand-300)" } : undefined}
                  onClick={() => {
                    setMlRecarga(String(ml));
                    // Si este tamaño tiene precio fijo configurado, se usa ese en vez del
                    // proporcional al ml (el cajero lo puede seguir editando antes de cobrar).
                    setPrecioRecargaEditado(tk.precio != null ? String(num(tk.precio)) : null);
                  }}
                >
                  {iconoPerfil(ml)} {tk.nombre} ({ml}ml{tk.precio != null ? ` · ${money(tk.precio)}` : ""})
                </button>
              );
            })}
          </div>
          <label style={{ marginTop: 10 }}>{t("pos.refillMlCustom")}</label>
          <input
            type="number" min="0" step="0.1" value={mlRecarga}
            onChange={(e) => { setMlRecarga(e.target.value); setPrecioRecargaEditado(null); }}
            onKeyDown={(e) => e.key === "Enter" && confirmarRecarga()}
            placeholder="4"
          />
          {mlRecarga && Number(mlRecarga) > 0 && (() => {
            const ml = Number(mlRecarga);
            const sugerido = ml * precioPorMl(recargaPendiente);
            const costoBase = costoPorMl(recargaPendiente) != null ? ml * costoPorMl(recargaPendiente)! : null;
            const precioActual = precioRecargaEditado != null ? Number(precioRecargaEditado) : sugerido;
            const margen = costoBase != null ? precioActual - costoBase : null;
            return (
              <>
                <label style={{ marginTop: 8 }}>{t("pos.refillPrice")}</label>
                <input
                  type="number" min="0" step="0.01"
                  value={precioRecargaEditado ?? sugerido.toFixed(2)}
                  onChange={(e) => setPrecioRecargaEditado(e.target.value)}
                />
                <p className="small" style={{ marginTop: 4 }}>
                  {costoBase != null && <><span className="muted">{t("pos.refillBaseCost")}: {money(costoBase)}</span>{" · "}</>}
                  {margen != null && <span className={margen >= 0 ? "success" : "error"}>{t("pos.refillMargin")}: {money(margen)}</span>}
                  {Number(mlRecarga) > num(recargaPendiente.stock) && <span className="error"> · {t("pos.refillNotEnough")}</span>}
                </p>
              </>
            );
          })()}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="primary" disabled={!mlRecarga || Number(mlRecarga) <= 0} onClick={confirmarRecarga}>{t("pos.refillAdd")}</button>
            <button className="ghost" onClick={() => { setRecargaPendiente(null); setMlRecarga(""); setPrecioRecargaEditado(null); }}>{t("common.cancel")}</button>
          </div>
        </div>
      )}

      {carrito.length === 0 ? (
        <p className="muted small" style={{ marginTop: 12 }}>{t("pos.emptyCart")}</p>
      ) : (
        <div style={{ marginTop: 12 }}>
          {carrito.map((l, i) => (
            <div className="list-item" key={i} style={{ flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 160 }}>
                {l.esRecarga ? (
                  <>
                    <select value={l.productoId ?? ""} onChange={(e) => cambiarSaborRecarga(i, e.target.value)} style={{ marginBottom: 2 }}>
                      {liquidos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                    </select>
                    <span className="muted small">{t("pos.refillFlavorHint")}</span>
                  </>
                ) : (
                  <strong>{l.nombre}</strong>
                )}
                <br /><span className="muted small">{money(l.precioUnit)} {t("pos.each")}{l.impuestoPct > 0 ? ` · ITBIS ${l.impuestoPct}%` : ""}</span>
              </div>
              <input type="number" min="0" step="1" value={l.cantidad} onChange={(e) => setCant(i, Number(e.target.value))} style={{ width: 70 }} />
              <strong style={{ minWidth: 80, textAlign: "right" }}>{money(l.cantidad * l.precioUnit)}</strong>
            </div>
          ))}
          <div className="card" style={{ background: "var(--surface-2)", marginTop: 8 }}>
            <div className="row spread"><span className="muted small">{t("pos.subtotal")}</span><span>{money(subtotal)}</span></div>
            {impuesto > 0 && <div className="row spread"><span className="muted small">{t("pos.tax")}</span><span>{money(impuesto)}</span></div>}
            <div className="row spread" style={{ fontSize: 20, fontWeight: 800, marginTop: 4 }}><span>{t("pos.total")}</span><span className="grad-text">{money(total)}</span></div>
            <label style={{ marginTop: 10 }}>{t("pos.paymentMethod")}</label>
            <select value={metodoPago} onChange={(e) => { setMetodoPago(e.target.value); if (e.target.value !== "fiado" && e.target.value !== "apartado") { setClienteSel(null); setClienteQ(""); } }}>
              <option value="efectivo">{t("pos.cash")}</option>
              <option value="tarjeta">{t("pos.card")}</option>
              <option value="transferencia">{t("pos.transfer")}</option>
              {credit && <option value="fiado">{t("pos.credit")}</option>}
              {credit && <option value="apartado">{t("pos.layaway")}</option>}
              <option value="otro">{t("pos.other")}</option>
            </select>
            {(metodoPago === "fiado" || metodoPago === "apartado") && (
              <div style={{ marginTop: 8 }}>
                {metodoPago === "apartado" && <p className="muted small">{t("pos.layawayHelp")}</p>}
                {clienteSel ? (
                  <div className="row spread">
                    <span className="small">{t("pos.creditTo")} <strong>{clienteSel.nombre}</strong> {Number(clienteSel.saldoFiado) > 0 && <span className="muted">({t("pos.alreadyOwes")} {money(clienteSel.saldoFiado)})</span>}</span>
                    <button type="button" className="ghost small" onClick={() => setClienteSel(null)}>{t("pos.change")}</button>
                  </div>
                ) : (
                  <>
                    <input placeholder={t("pos.searchCustomerPh")} value={clienteQ} onChange={(e) => setClienteQ(e.target.value)} />
                    {clienteResultados.length > 0 && (
                      <div className="card" style={{ background: "var(--surface-3)", marginTop: 6, maxHeight: 160, overflowY: "auto" }}>
                        {clienteResultados.map((c) => (
                          <div className="list-item" key={c.id} style={{ cursor: "pointer" }} onClick={() => { setClienteSel(c); setClienteQ(""); setClienteResultados([]); }}>
                            <span>{c.nombre}</span>
                            <span className="muted small">{c.telefono ?? ""}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
            <button className="primary" style={{ width: "100%", marginTop: 12 }} onClick={cobrar}>{t("pos.charge")} {money(total)}</button>
          </div>
        </div>
      )}
      {msg && <p className="success" style={{ marginTop: 8 }}>{msg}</p>}
      {error && <p className="error" style={{ marginTop: 8 }}>{error}</p>}
      {reciboVenta && <ReciboModal venta={reciboVenta} negocio={negocio} onClose={() => setReciboVenta(null)} />}
    </div>
  );
}

// Recibo imprimible: se muestra apenas se cobra, con botón de imprimir (usa el diálogo de
// impresión del sistema operativo — funciona con cualquier impresora instalada, térmica o no,
// sin depender de una librería específica). El resto de la app queda oculto al imprimir
// gracias a la clase "no-imprimir" / "recibo-imprimible" en styles.css.
function ReciboModal({ venta, negocio, onClose }: { venta: Venta; negocio: Negocio; onClose: () => void }) {
  const { t } = useT();
  return (
    <div className="modal-overlay no-imprimir" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 340 }} onClick={(e) => e.stopPropagation()}>
        <div className="recibo-imprimible">
          <h3 style={{ margin: 0, textAlign: "center" }}>{negocio.nombreComercial}</h3>
          {negocio.direccion && <p className="small" style={{ textAlign: "center", margin: "2px 0" }}>{negocio.direccion}</p>}
          {negocio.telefonoContacto && <p className="small" style={{ textAlign: "center", margin: "2px 0" }}>{negocio.telefonoContacto}</p>}
          <hr />
          <p className="small" style={{ margin: "4px 0" }}>{new Date(venta.createdAt).toLocaleString()} · #{venta.id.slice(-6)}</p>
          {(venta.lineas ?? []).map((l, i) => (
            <div className="row spread small" key={i}>
              <span>{num(l.cantidad)} × {l.nombre}</span>
              <span>{money(l.subtotal)}</span>
            </div>
          ))}
          <hr />
          {venta.subtotal != null && <div className="row spread small"><span>{t("pos.subtotal")}</span><span>{money(venta.subtotal)}</span></div>}
          {venta.impuesto != null && Number(venta.impuesto) > 0 && <div className="row spread small"><span>{t("pos.tax")}</span><span>{money(venta.impuesto)}</span></div>}
          <div className="row spread" style={{ fontWeight: 800, fontSize: 18 }}><span>{t("pos.total")}</span><span>{money(venta.total)}</span></div>
          <p className="small" style={{ textAlign: "center", marginTop: 8 }}>{t("pos.thanks")}</p>
        </div>
        <div className="row no-imprimir" style={{ marginTop: 12 }}>
          <button className="primary" style={{ flex: 1 }} onClick={() => window.print()}>🖨️ {t("pos.print")}</button>
          <button className="ghost" style={{ flex: 1 }} onClick={onClose}>{t("common.close")}</button>
        </div>
      </div>
    </div>
  );
}

// Campos editables de un producto (todo menos el stock, que se mueve por /stock).
interface FormProducto {
  nombre: string; sku: string; categoria: string; precioVenta: string; impuestoPct: string; stock: string; unidad: string; stockMinimo: string;
  volumenMl: string; nicotinaMg: string; productoFuenteId: string; rendimientoPorVenta: string;
  costo: string; tipoProducto: "consumible" | "hardware"; notasTecnicas: string;
  loteNumero: string; fechaVencimiento: string; varianteBaseId: string;
}
const formVacio: FormProducto = {
  nombre: "", sku: "", categoria: "", precioVenta: "", impuestoPct: "0", stock: "0", unidad: "UND", stockMinimo: "0",
  volumenMl: "", nicotinaMg: "", productoFuenteId: "", rendimientoPorVenta: "",
  costo: "", tipoProducto: "consumible", notasTecnicas: "",
  loteNumero: "", fechaVencimiento: "", varianteBaseId: "",
};
function formDeProducto(p: Producto): FormProducto {
  return {
    nombre: p.nombre, sku: p.sku ?? "", categoria: p.categoria ?? "", precioVenta: String(num(p.precioVenta)), impuestoPct: String(num(p.impuestoPct)), stock: String(num(p.stock)), unidad: p.unidad, stockMinimo: String(num(p.stockMinimo)),
    volumenMl: p.volumenMl != null ? String(num(p.volumenMl)) : "", nicotinaMg: p.nicotinaMg != null ? String(num(p.nicotinaMg)) : "",
    productoFuenteId: p.productoFuenteId ?? "", rendimientoPorVenta: p.rendimientoPorVenta != null ? String(num(p.rendimientoPorVenta)) : "",
    costo: p.costo != null ? String(num(p.costo)) : "", tipoProducto: p.tipoProducto, notasTecnicas: p.notasTecnicas ?? "",
    loteNumero: p.loteNumero ?? "", fechaVencimiento: p.fechaVencimiento ? p.fechaVencimiento.slice(0, 10) : "",
    varianteBaseId: p.varianteBaseId ?? "",
  };
}

// Campos comunes del formulario (nombre/sku/categoría/precio/impuesto/stock mínimo/ml/mg/recarga).
// `incluirStockInicial` solo aplica al crear: al editar el stock se mueve con +Entrada/−Salida.
// `otrosProductos` + `propioId`: para el selector "esto descuenta de" (recargas), excluyéndose
// a sí mismo para no poder apuntar un producto a sí mismo como fuente.
function CamposProducto({ f, onChange, incluirStockInicial, otrosProductos, propioId, esVape }: {
  f: FormProducto; onChange: (f: FormProducto) => void; incluirStockInicial: boolean; otrosProductos: Producto[]; propioId?: string; esVape: boolean;
}) {
  const { t } = useT();
  const candidatosFuente = otrosProductos.filter((p) => p.id !== propioId && !p.productoFuenteId);
  const vol = esVape ? Number(f.volumenMl) : 0;
  const costo = Number(f.costo), precio = Number(f.precioVenta);
  const margenPorMl = vol > 0 && f.costo && f.precioVenta ? (precio - costo) / vol : null;
  return (
    <>
      <label>{t("pos.name")}</label>
      <input value={f.nombre} onChange={(e) => onChange({ ...f, nombre: e.target.value })} required />
      <label>{t("pos.skuOpt")}</label>
      <input value={f.sku} onChange={(e) => onChange({ ...f, sku: e.target.value })} />
      <label>{t("pos.categoryOpt")}</label>
      <input value={f.categoria} onChange={(e) => onChange({ ...f, categoria: e.target.value })} />
      {esVape && (
        <>
          <label style={{ marginTop: 8 }}>{t("pos.productType")}</label>
          <div className="lang-toggle" style={{ margin: "4px 0" }}>
            <button type="button" className={f.tipoProducto === "consumible" ? "on" : ""} onClick={() => onChange({ ...f, tipoProducto: "consumible" })}>{t("pos.typeConsumable")}</button>
            <button type="button" className={f.tipoProducto === "hardware" ? "on" : ""} onClick={() => onChange({ ...f, tipoProducto: "hardware" })}>{t("pos.typeHardware")}</button>
          </div>
        </>
      )}
      <div className="grid grid-2">
        <div><label>{t("pos.salePrice")}</label><input type="number" step="0.01" min="0" value={f.precioVenta} onChange={(e) => onChange({ ...f, precioVenta: e.target.value })} required /></div>
        <div><label>{t("pos.cost")}</label><input type="number" step="0.01" min="0" value={f.costo} onChange={(e) => onChange({ ...f, costo: e.target.value })} placeholder="0.00" /></div>
        <div><label>{t("pos.taxPct")}</label><input type="number" step="0.01" min="0" value={f.impuestoPct} onChange={(e) => onChange({ ...f, impuestoPct: e.target.value })} /></div>
        {!esVape && (
          <div>
            <label>{t("pos.unit")}</label>
            <select
              value={UNIDADES_COMUNES.includes(f.unidad) ? f.unidad : "OTRA"}
              onChange={(e) => onChange({ ...f, unidad: e.target.value === "OTRA" ? "" : e.target.value })}
            >
              {UNIDADES_COMUNES.map((u) => <option key={u} value={u}>{u}</option>)}
              <option value="OTRA">{t("pos.unitOther")}</option>
            </select>
            {!UNIDADES_COMUNES.includes(f.unidad) && (
              <input style={{ marginTop: 6 }} value={f.unidad} onChange={(e) => onChange({ ...f, unidad: e.target.value })} placeholder={t("pos.unitPh")} autoFocus />
            )}
          </div>
        )}
        {esVape && (
          <div><label>{t("pos.volumeMl")}</label><input type="number" step="0.01" min="0" value={f.volumenMl} onChange={(e) => onChange({ ...f, volumenMl: e.target.value })} placeholder="30" /></div>
        )}
        {incluirStockInicial && (
          vol > 0 ? (
            <div>
              <label>{t("pos.initialUnits")}</label>
              <input type="number" step="1" min="0" value={f.stock && Number(f.stock) > 0 ? String(Number(f.stock) / vol) : ""}
                onChange={(e) => onChange({ ...f, stock: String(Number(e.target.value || 0) * vol) })} placeholder="5" />
              <p className="muted small" style={{ margin: "2px 0 0" }}>{t("pos.initialUnitsHint")}: {Number(f.stock || 0)} ml</p>
            </div>
          ) : (
            <div><label>{t("pos.initialStock")}</label><input type="number" step="0.001" value={f.stock} onChange={(e) => onChange({ ...f, stock: e.target.value })} /></div>
          )
        )}
        <div><label>{t("pos.minStock")}</label><input type="number" step="0.001" min="0" value={f.stockMinimo} onChange={(e) => onChange({ ...f, stockMinimo: e.target.value })} /></div>
        {esVape && (
          <div><label>{t("pos.nicotineMg")}</label><input type="number" step="0.01" min="0" value={f.nicotinaMg} onChange={(e) => onChange({ ...f, nicotinaMg: e.target.value })} placeholder="6" /></div>
        )}
      </div>
      {margenPorMl != null && (
        <p className="muted small">
          {t("pos.marginPerMl")}: <strong className={margenPorMl >= 0 ? "" : "error"}>{money(margenPorMl)}/ml</strong>
          {" · "}{t("pos.pricePerMl")}: {money(vol > 0 ? precio / vol : 0)}/ml
        </p>
      )}

      {/* Este mecanismo viejo (una sola fuente, un ML fijo por venta) es para un producto SIN
          volumen propio (ej. una "Recarga" genérica sin stock propio). Si el producto YA tiene
          su propio Volumen (ml) cargado arriba, es al revés: ES un pote — se vende por ml
          libre desde su propio stock, y sus sabores se vinculan desde "Sabores de esta línea"
          en su pantalla de edición (no acá) — mostrar ambos a la vez solo confunde. Es un
          mecanismo específico de líquidos/vapes, no aplica a otros rubros. */}
      {esVape && candidatosFuente.length > 0 && vol === 0 && (
        <>
          <label style={{ marginTop: 8 }}>{t("pos.sourceProduct")}</label>
          <p className="muted small" style={{ margin: "0 0 6px" }}>{t("pos.sourceProductHelp")}</p>
          <select value={f.productoFuenteId} onChange={(e) => onChange({ ...f, productoFuenteId: e.target.value })}>
            <option value="">{t("pos.sourceProductNone")}</option>
            {candidatosFuente.map((p) => <option key={p.id} value={p.id}>{p.nombre}{p.unidad ? ` (${p.unidad})` : ""}</option>)}
          </select>
          {f.productoFuenteId && (
            <div style={{ marginTop: 6 }}>
              <label>{t("pos.yieldPerSale")}</label>
              <input type="number" step="0.001" min="0" value={f.rendimientoPorVenta} onChange={(e) => onChange({ ...f, rendimientoPorVenta: e.target.value })} placeholder="3" />
            </div>
          )}
        </>
      )}

      {esVape && (
        <>
          <label style={{ marginTop: 8 }}>{t("pos.technicalNotes")}</label>
          <p className="muted small" style={{ margin: "0 0 6px" }}>{t("pos.technicalNotesHelp")}</p>
          <textarea rows={3} value={f.notasTecnicas} onChange={(e) => onChange({ ...f, notasTecnicas: e.target.value })} style={{ width: "100%" }} />
        </>
      )}

      <div className="grid grid-2" style={{ marginTop: 8 }}>
        <div><label>{t("pos.batchNumber")}</label><input value={f.loteNumero} onChange={(e) => onChange({ ...f, loteNumero: e.target.value })} /></div>
        <div><label>{t("pos.expiryDate")}</label><input type="date" value={f.fechaVencimiento} onChange={(e) => onChange({ ...f, fechaVencimiento: e.target.value })} /></div>
      </div>
    </>
  );
}

// Sabores de la línea: agregar rápido nuevas variantes de un producto ya creado (ej. "Recargas"
// → Mango, Fresa, Menta), sin volver a llenar todo el formulario — clona categoría, volumen,
// tipo, nicotina y notas técnicas del producto actual; solo pide lo que cambia por sabor.
function SaboresDeLinea({ negocioId, base, todos, onCambio }: { negocioId: string; base: Producto; todos: Producto[]; onCambio: () => void }) {
  const { t } = useT();
  const baseId = base.varianteBaseId ?? base.id;
  const sabores = todos.filter((x) => x.id !== base.id && (x.varianteBaseId === baseId || x.id === baseId));
  const esLiquido = base.volumenMl != null && num(base.volumenMl) > 0;
  const vol = num(base.volumenMl);
  // Sabores = solo otros POTES líquidos (mismo tipo de producto que una recarga descuenta) —
  // no cualquier producto del inventario. Tampoco uno que ya sea "padre" de otra línea propia,
  // para no anidar líneas.
  const vinculables = todos.filter((x) =>
    x.id !== base.id && x.varianteBaseId !== baseId &&
    x.volumenMl != null && num(x.volumenMl) > 0 &&
    !todos.some((y) => y.varianteBaseId === x.id),
  );

  const [nombre, setNombre] = useState("");
  const [precioVenta, setPrecioVenta] = useState(String(num(base.precioVenta)));
  const [costo, setCosto] = useState(base.costo != null ? String(num(base.costo)) : "");
  const [stockInput, setStockInput] = useState("");
  const [aVincular, setAVincular] = useState("");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function agregar(e: React.FormEvent) {
    e.preventDefault(); setError("");
    if (!nombre.trim()) return;
    setGuardando(true);
    try {
      const stock = esLiquido ? Number(stockInput || 0) * vol : Number(stockInput || 0);
      await api.post("/inventario", {
        negocioId, nombre: nombre.trim(), categoria: base.categoria ?? undefined,
        precioVenta, costo: costo || undefined, impuestoPct: String(num(base.impuestoPct)),
        volumenMl: base.volumenMl ?? undefined, nicotinaMg: base.nicotinaMg ?? undefined,
        tipoProducto: base.tipoProducto, notasTecnicas: base.notasTecnicas ?? undefined,
        stock, varianteBaseId: baseId,
      });
      setNombre(""); setStockInput("");
      onCambio();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error"));
    } finally {
      setGuardando(false);
    }
  }

  async function vincular() {
    if (!aVincular) return;
    setError("");
    try {
      await api.patch(`/inventario/${aVincular}`, { varianteBaseId: baseId });
      setAVincular("");
      onCambio();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error"));
    }
  }

  async function desvincular(id: string) {
    await api.patch(`/inventario/${id}`, { varianteBaseId: null });
    onCambio();
  }

  return (
    <div className="card" style={{ background: "var(--surface-3)", marginTop: 10 }}>
      <strong className="small">{t("pos.flavorsTitle")}</strong>
      <p className="muted small" style={{ margin: "2px 0 8px" }}>{t("pos.flavorsHelp")}</p>
      {sabores.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          {sabores.map((s) => (
            <div className="list-item" key={s.id}>
              <span>{s.nombre}</span>
              <div className="row" style={{ alignItems: "center", gap: 8 }}>
                <span className="muted small">{money(s.precioVenta)} · {t("pos.stock")}: {num(s.stock)} {esLiquido ? "ml" : s.unidad}</span>
                {s.id !== base.id && <button type="button" className="ghost small" onClick={() => desvincular(s.id)}>{t("pos.flavorUnlink")}</button>}
              </div>
            </div>
          ))}
        </div>
      )}

      {vinculables.length > 0 && (
        <div className="row" style={{ marginBottom: 10 }}>
          <select value={aVincular} onChange={(e) => setAVincular(e.target.value)} style={{ flex: 1 }}>
            <option value="">{t("pos.flavorLinkPh")}</option>
            {vinculables.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
          <button type="button" className="primary small" disabled={!aVincular} onClick={vincular}>{t("pos.flavorLink")}</button>
        </div>
      )}

      <p className="muted small" style={{ margin: "0 0 6px" }}>{t("pos.flavorOrCreate")}</p>
      <form onSubmit={agregar} className="grid grid-2">
        <div><label>{t("pos.flavorName")}</label><input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder={t("pos.flavorNamePh")} required /></div>
        <div><label>{t("pos.salePrice")}</label><input type="number" step="0.01" min="0" value={precioVenta} onChange={(e) => setPrecioVenta(e.target.value)} required /></div>
        <div><label>{t("pos.cost")}</label><input type="number" step="0.01" min="0" value={costo} onChange={(e) => setCosto(e.target.value)} placeholder="0.00" /></div>
        <div>
          <label>{esLiquido ? t("pos.initialUnits") : t("pos.initialStock")}</label>
          <input type="number" step={esLiquido ? "1" : "0.001"} min="0" value={stockInput} onChange={(e) => setStockInput(e.target.value)} placeholder={esLiquido ? "1" : "0"} />
        </div>
        {error && <p className="error small" style={{ gridColumn: "1 / -1" }}>{error}</p>}
        <button className="primary small" style={{ gridColumn: "1 / -1" }} disabled={guardando}>{t("pos.flavorAdd")}</button>
      </form>
    </div>
  );
}

// Foto del producto (solo aplica a un producto ya creado — como el logo/portada del negocio).
function FotoProducto({ producto, onSubido }: { producto: Producto; onSubido: () => void }) {
  const { t } = useT();
  const [error, setError] = useState("");
  async function subir(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    try {
      await api.upload(`/uploads/producto/${producto.id}`, "imagen", file);
      onSubido();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error"));
    }
  }
  return (
    <div style={{ marginTop: 8 }}>
      <label>{t("pos.photo")}</label>
      <div className="row" style={{ alignItems: "center", gap: 10 }}>
        {producto.imagenUrl && <img src={assetUrl(producto.imagenUrl)} alt="" style={{ width: 48, height: 48, borderRadius: 8, objectFit: "cover" }} />}
        <input type="file" accept="image/*" onChange={subir} />
      </div>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}

// ---------- PRODUCTOS (Inventario) ----------
// Gestión de los perfiles de dispositivo (Pod Estándar, Mod Mediano...) que aparecen como
// botones rápidos al vender una recarga. El dueño los puede editar/sumar/borrar acá.
function PerfilesDispositivo({ negocioId }: { negocioId: string }) {
  const { t } = useT();
  const [perfiles, setPerfiles] = useState<PerfilDispositivo[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState("");
  const [ml, setMl] = useState("");
  const [precio, setPrecio] = useState("");
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [precioEditado, setPrecioEditado] = useState("");
  const [error, setError] = useState("");

  function cargar() { api.get<{ perfiles: PerfilDispositivo[] }>(`/dispositivos?negocioId=${negocioId}`).then((r) => setPerfiles(r.perfiles)).catch(() => {}); }
  useEffect(cargar, [negocioId]);

  async function agregar(e: React.FormEvent) {
    e.preventDefault(); setError("");
    try {
      await api.post("/dispositivos", { negocioId, nombre, capacidadMl: ml, precio: precio || null });
      setNombre(""); setMl(""); setPrecio(""); cargar();
    } catch (err) { setError(err instanceof ApiError ? err.message : t("common.error")); }
  }
  async function quitar(id: string) { await api.del(`/dispositivos/${id}`); cargar(); }

  function empezarEditarPrecio(p: PerfilDispositivo) {
    setEditandoId(editandoId === p.id ? null : p.id);
    setPrecioEditado(p.precio != null ? String(num(p.precio)) : "");
  }
  async function guardarPrecio(p: PerfilDispositivo) {
    await api.patch(`/dispositivos/${p.id}`, { precio: precioEditado === "" ? null : precioEditado });
    setEditandoId(null); cargar();
  }

  return (
    <div className="card">
      <div className="row spread">
        <h2>{t("devices.title")}</h2>
        <button className="ghost small" onClick={() => setAbierto((v) => !v)}>{abierto ? "▲" : "▼"}</button>
      </div>
      <p className="muted small">{t("devices.help")}</p>
      {abierto && (
        <>
          <p className="muted small">{t("devices.priceHelp")}</p>
          {perfiles.map((p) => (
            <div key={p.id}>
              <div className="list-item">
                <span>{iconoPerfil(num(p.capacidadMl))} {p.nombre}</span>
                <div className="row" style={{ alignItems: "center", gap: 6 }}>
                  <span className="muted small">{num(p.capacidadMl)} ml{p.precio != null ? ` · ${money(p.precio)}` : ""}</span>
                  <button className="ghost small" onClick={() => empezarEditarPrecio(p)}>{t("devices.editPrice")}</button>
                  <button className="ghost small" onClick={() => quitar(p.id)}>{t("common.delete")}</button>
                </div>
              </div>
              {editandoId === p.id && (
                <div className="row" style={{ gap: 6, padding: "0 4px 8px" }}>
                  <input type="number" min="0" step="0.01" placeholder={t("devices.priceAutoPh")} value={precioEditado} onChange={(e) => setPrecioEditado(e.target.value)} style={{ flex: 1 }} />
                  <button type="button" className="primary small" onClick={() => guardarPrecio(p)}>{t("common.save")}</button>
                </div>
              )}
            </div>
          ))}
          <form onSubmit={agregar} className="row" style={{ marginTop: 8 }}>
            <input placeholder={t("devices.namePh")} value={nombre} onChange={(e) => setNombre(e.target.value)} required style={{ flex: 2 }} />
            <input type="number" min="0" step="0.1" placeholder="ml" value={ml} onChange={(e) => setMl(e.target.value)} required style={{ flex: 1 }} />
            <input type="number" min="0" step="0.01" placeholder={t("devices.priceAutoPh")} value={precio} onChange={(e) => setPrecio(e.target.value)} style={{ flex: 1 }} />
            <button className="primary small">{t("common.add")}</button>
          </form>
          {error && <p className="error small">{error}</p>}
        </>
      )}
    </div>
  );
}

export function Productos({ negocio }: { negocio: Negocio }) {
  const { t } = useT();
  const esVape = negocio.perfil === "vape_shop";
  const [productos, setProductos] = useState<Producto[]>([]);
  const [nuevo, setNuevo] = useState(false);
  const [f, setF] = useState<FormProducto>(formVacio);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [fe, setFe] = useState<FormProducto>(formVacio);
  const [error, setError] = useState("");
  const [verInactivos, setVerInactivos] = useState(false);
  const { promptValor, promptConfirmar, modal } = usePrompt();

  function cargar() {
    api.get<{ productos: Producto[] }>(`/inventario?negocioId=${negocio.id}${verInactivos ? "&todos=1" : ""}`)
      .then((r) => setProductos(r.productos)).catch(() => {});
  }
  useEffect(cargar, [negocio.id, verInactivos]);

  async function eliminar(p: Producto) {
    if (!(await promptConfirmar(`${t("pos.deleteConfirm")} "${p.nombre}"?`))) return;
    try { await api.del(`/inventario/${p.id}`); cargar(); }
    catch (err) { setError(err instanceof ApiError ? err.message : t("common.error")); }
  }

  async function reactivar(p: Producto) {
    await api.patch(`/inventario/${p.id}`, { activo: true });
    cargar();
  }

  // Los campos opcionales llegan como string vacío desde el form (input vacío) — hay que
  // mandarlos como null, si no z.coerce.number() del backend falla al intentar convertir "".
  function paraEnviar(datos: FormProducto) {
    return {
      ...datos,
      volumenMl: datos.volumenMl === "" ? null : datos.volumenMl,
      nicotinaMg: datos.nicotinaMg === "" ? null : datos.nicotinaMg,
      productoFuenteId: datos.productoFuenteId === "" ? null : datos.productoFuenteId,
      rendimientoPorVenta: datos.rendimientoPorVenta === "" ? null : datos.rendimientoPorVenta,
      costo: datos.costo === "" ? null : datos.costo,
      notasTecnicas: datos.notasTecnicas === "" ? null : datos.notasTecnicas,
      loteNumero: datos.loteNumero === "" ? null : datos.loteNumero,
      fechaVencimiento: datos.fechaVencimiento === "" ? null : datos.fechaVencimiento,
      varianteBaseId: datos.varianteBaseId === "" ? null : datos.varianteBaseId,
    };
  }

  function validarFuente(datos: FormProducto): string | null {
    if (datos.productoFuenteId && !datos.rendimientoPorVenta) return t("pos.yieldRequired");
    return null;
  }

  async function crear(e: React.FormEvent) {
    e.preventDefault(); setError("");
    const err0 = validarFuente(f);
    if (err0) { setError(err0); return; }
    try { await api.post("/inventario", { ...paraEnviar(f), negocioId: negocio.id }); setF(formVacio); setNuevo(false); cargar(); }
    catch (err) { setError(err instanceof ApiError ? err.message : t("common.error")); }
  }

  function empezarEdicion(p: Producto) { setEditandoId(p.id); setFe(formDeProducto(p)); setError(""); }

  async function guardarEdicion(e: React.FormEvent) {
    e.preventDefault();
    if (!editandoId) return;
    setError("");
    const err0 = validarFuente(fe);
    if (err0) { setError(err0); return; }
    try {
      const { stock: _stock, ...cambios } = paraEnviar(fe); // el stock no se toca por acá
      await api.patch(`/inventario/${editandoId}`, cambios);
      setEditandoId(null); cargar();
    } catch (err) { setError(err instanceof ApiError ? err.message : t("common.error")); }
  }

  async function ajustar(p: Producto, tipo: "entrada" | "salida") {
    const vol = num(p.volumenMl);
    const esLiquido = p.volumenMl != null && vol > 0;
    const etiqueta = tipo === "entrada" ? t("pos.stockInPrompt") : t("pos.stockOutPrompt");
    // Un líquido se maneja por botellas enteras, no ml sueltos — se pregunta cuántas unidades
    // (entran o salen) y se calculan solos los ml reales (unidades × ml por botella), en vez
    // de obligar a hacer la cuenta a mano cada vez.
    if (esLiquido) {
      const v = await promptValor(`${etiqueta} "${p.nombre}" — ${t("pos.unitsBottlesPrompt")} (${vol} ml ${t("pos.each")}):`);
      if (!v || !Number(v)) return;
      const cantidad = Number(v) * vol;
      await api.post(`/inventario/${p.id}/stock`, { tipo, cantidad, motivo: `${tipo}: ${v} ${t("pos.unitsShort")}` });
      cargar();
      return;
    }
    const v = await promptValor(`${etiqueta} ${t("pos.stockPromptSuffix")} "${p.nombre}" (${t("pos.quantity")}):`);
    if (!v) return;
    await api.post(`/inventario/${p.id}/stock`, { tipo, cantidad: Number(v), motivo: tipo });
    cargar();
  }

  return (
    <div>
      {negocio.perfil === "vape_shop" && <PerfilesDispositivo negocioId={negocio.id} />}
      <div className="row spread" style={{ marginTop: 12 }}>
        <span className="muted small">{productos.length} {t("pos.products")}</span>
        <div className="row" style={{ gap: 8 }}>
          <button className="ghost small" onClick={() => setVerInactivos((v) => !v)}>{verInactivos ? t("pos.hideInactive") : t("pos.showInactive")}</button>
          <button className={nuevo ? "ghost small" : "primary small"} onClick={() => { setNuevo((v) => !v); setEditandoId(null); }}>{nuevo ? t("common.cancel") : t("pos.newProduct")}</button>
        </div>
      </div>
      {nuevo && (
        <form onSubmit={crear} className="card" style={{ background: "var(--surface-2)", marginTop: 8 }}>
          <CamposProducto f={f} onChange={setF} incluirStockInicial otrosProductos={productos} esVape={esVape} />
          {error && <p className="error small">{error}</p>}
          <button className="primary" style={{ marginTop: 10 }}>{t("pos.saveProduct")}</button>
        </form>
      )}
      {productos.length === 0 ? (
        <p className="muted small" style={{ marginTop: 10 }}>{t("pos.noProducts")}</p>
      ) : (
        productos.map((p) => {
          const bajo = num(p.stock) <= num(p.stockMinimo);
          if (editandoId === p.id) {
            return (
              <div key={p.id}>
                <form onSubmit={guardarEdicion} className="card" style={{ background: "var(--surface-2)", marginTop: 8 }}>
                  <CamposProducto f={fe} onChange={setFe} incluirStockInicial={false} otrosProductos={productos} propioId={p.id} esVape={esVape} />
                  <FotoProducto producto={p} onSubido={cargar} />
                  {error && <p className="error small">{error}</p>}
                  <div className="row" style={{ marginTop: 10 }}>
                    <button className="primary">{t("pos.saveChanges")}</button>
                    <button type="button" className="ghost" onClick={() => setEditandoId(null)}>{t("common.cancel")}</button>
                  </div>
                </form>
                {/* Sabores solo aplica a recargas (potes líquidos) — no tiene sentido para
                    hardware ni otros productos sin volumen. */}
                {p.volumenMl != null && num(p.volumenMl) > 0 && (
                  <SaboresDeLinea negocioId={negocio.id} base={p} todos={productos} onCambio={cargar} />
                )}
              </div>
            );
          }
          const fuente = p.productoFuenteId ? productos.find((x) => x.id === p.productoFuenteId) : null;
          // El stock de un líquido siempre se lleva en ml (no importa qué diga p.unidad, que
          // por defecto queda en "UND") — mostrar "UND" ahí confunde: 300 no son 300 potes,
          // son 300 ml sueltos (equivalentes a 3 potes de 100ml).
          const esLiquido = p.volumenMl != null && num(p.volumenMl) > 0;
          const atributos = [p.volumenMl != null ? `${num(p.volumenMl)}ml` : null, p.nicotinaMg != null ? `${num(p.nicotinaMg)}mg` : null].filter(Boolean).join(" · ");
          const dias = p.fechaVencimiento ? diasParaVencer(p.fechaVencimiento) : null;
          return (
            <div className="list-item" key={p.id}>
              <div className="row" style={{ gap: 10 }}>
                {p.imagenUrl && <img src={assetUrl(p.imagenUrl)} alt="" style={{ width: 40, height: 40, borderRadius: 6, objectFit: "cover", flexShrink: 0 }} />}
                <div>
                  <strong>{p.nombre}</strong> <span className="muted small">{p.sku ?? ""}</span>
                  {p.tipoProducto === "hardware" && <span className="badge" style={{ marginLeft: 4 }}>{t("pos.typeHardware")}</span>}
                  {!p.activo && <span className="badge err" style={{ marginLeft: 4 }}>{t("pos.inactive")}</span>}
                  {atributos && <span className="muted small"> · {atributos}</span>}<br />
                  {fuente ? (
                    <span className="badge">{t("pos.refillOf")} {fuente.nombre}</span>
                  ) : (
                    <span className={`badge ${bajo ? "err" : "ok"}`}>
                      {esLiquido
                        ? `${t("pos.stock")}: ${(num(p.stock) / num(p.volumenMl)).toFixed(2).replace(/\.?0+$/, "")} ${t("pos.unitsShort")} (${num(p.stock)} ml)`
                        : `${t("pos.stock")}: ${num(p.stock)} ${p.unidad}`}
                    </span>
                  )}
                  <span className="muted small"> · {money(p.precioVenta)}</span>
                  {dias != null && (
                    <span className={`badge ${dias < 0 ? "err" : dias <= 7 ? "err" : dias <= 30 ? "warn" : ""}`} style={{ marginLeft: 4 }}>
                      {dias < 0 ? t("pos.expired") : `${t("pos.expiresIn")} ${dias}d`}
                    </span>
                  )}
                </div>
              </div>
              <div className="row">
                {p.activo ? (
                  <>
                    <button className="ghost small" onClick={() => empezarEdicion(p)}>{t("pos.edit")}</button>
                    {!fuente && <button className="ghost small" onClick={() => ajustar(p, "entrada")}>{t("pos.stockIn")}</button>}
                    {!fuente && <button className="ghost small" onClick={() => ajustar(p, "salida")}>{t("pos.stockOut")}</button>}
                    <button className="ghost small" onClick={() => eliminar(p)}>{t("common.delete")}</button>
                  </>
                ) : (
                  <button className="ghost small" onClick={() => reactivar(p)}>{t("pos.reactivate")}</button>
                )}
              </div>
            </div>
          );
        })
      )}
      {modal}
    </div>
  );
}

// ---------- CAJA ----------
export function Caja({ negocio }: { negocio: Negocio }) {
  const { t } = useT();
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [ventas, setVentas] = useState<Venta[]>([]);
  const [resumen, setResumen] = useState<{ conteo: number; total: number; porMetodo: Record<string, number> } | null>(null);
  const [monto, setMonto] = useState("");
  const [msg, setMsg] = useState("");
  // Anulación: se pide el motivo antes de confirmar (queda en el historial de la venta).
  const [anulando, setAnulando] = useState<string | null>(null);
  const [motivoAnular, setMotivoAnular] = useState("");

  function cargar() {
    api.get<{ sesion: Sesion | null }>(`/pos/caja/actual?negocioId=${negocio.id}`).then((r) => setSesion(r.sesion)).catch(() => {});
    api.get<{ ventas: Venta[]; resumen: { conteo: number; total: number; porMetodo: Record<string, number> } }>(`/pos/ventas?negocioId=${negocio.id}`)
      .then((r) => { setVentas(r.ventas); setResumen(r.resumen); }).catch(() => {});
  }
  useEffect(cargar, [negocio.id]);

  async function abrir() { await api.post("/pos/caja/abrir", { negocioId: negocio.id, montoInicial: monto || 0 }); setMonto(""); setMsg(t("pos.cashOpened")); cargar(); }
  async function cerrar() {
    const r = await api.post<{ esperado: number; descuadre: number }>("/pos/caja/cerrar", { negocioId: negocio.id, montoFinal: monto || 0 });
    setMsg(`${t("pos.cashClosed")} ${t("pos.expected")}: ${money(r.esperado)} · ${t("pos.discrepancy")}: ${money(r.descuadre)}`); setMonto(""); cargar();
  }

  async function confirmarAnular(id: string) {
    await api.post(`/pos/ventas/${id}/anular`, { motivo: motivoAnular || undefined });
    setAnulando(null); setMotivoAnular(""); cargar();
  }

  return (
    <div>
      {resumen && (
        <div className="card" style={{ background: "var(--surface-2)" }}>
          <div className="row spread"><strong>{t("pos.salesToday")}</strong><span className="grad-text" style={{ fontWeight: 800 }}>{money(resumen.total)}</span></div>
          <span className="muted small">{resumen.conteo} {t("pos.sales")} · {Object.entries(resumen.porMetodo).map(([m, t2]) => `${m}: ${money(t2)}`).join(" · ") || "—"}</span>
        </div>
      )}
      <div className="card" style={{ marginTop: 10 }}>
        {sesion ? (
          <>
            <p className="small">🟢 {t("pos.cashOpenSince")} <strong>{t("pos.open")}</strong> {t("pos.since")} {new Date(sesion.abiertaEn).toLocaleString()} · {t("pos.initial")} {money(sesion.montoInicial)}</p>
            <label>{t("pos.finalAmountCount")}</label>
            <input type="number" step="0.01" min="0" value={monto} onChange={(e) => setMonto(e.target.value)} />
            <button className="primary" style={{ marginTop: 10 }} onClick={cerrar}>{t("pos.closeCash")}</button>
          </>
        ) : (
          <>
            <p className="small">🔴 {t("pos.noOpenCash")}</p>
            <label>{t("pos.initialAmount")}</label>
            <input type="number" step="0.01" min="0" value={monto} onChange={(e) => setMonto(e.target.value)} />
            <button className="primary" style={{ marginTop: 10 }} onClick={abrir}>{t("pos.openCash")}</button>
          </>
        )}
        {msg && <p className="success small" style={{ marginTop: 8 }}>{msg}</p>}
      </div>
      {ventas.length > 0 && (
        <div className="card" style={{ marginTop: 10 }}>
          <strong className="small">{t("pos.recentSales")}</strong>
          {ventas.slice(0, 10).map((v) => (
            <div key={v.id}>
              <div className="list-item">
                <span className="muted small" style={v.anulada ? { textDecoration: "line-through" } : undefined}>
                  {new Date(v.createdAt).toLocaleTimeString()} · {v.metodoPago}
                  {v.anulada && <span className="error"> · {t("pos.voided")}</span>}
                </span>
                <div className="row" style={{ gap: 8 }}>
                  <strong style={v.anulada ? { textDecoration: "line-through", opacity: .6 } : undefined}>{money(v.total)}</strong>
                  {!v.anulada && (
                    <button type="button" className="ghost small" onClick={() => { setAnulando(anulando === v.id ? null : v.id); setMotivoAnular(""); }}>
                      {t("pos.void")}
                    </button>
                  )}
                </div>
              </div>
              {anulando === v.id && (
                <div className="row" style={{ gap: 6, padding: "0 4px 8px" }}>
                  <input placeholder={t("pos.voidReason")} value={motivoAnular} onChange={(e) => setMotivoAnular(e.target.value)} style={{ flex: 1 }} />
                  <button type="button" className="primary small" onClick={() => confirmarAnular(v.id)}>{t("pos.voidConfirm")}</button>
                  <button type="button" className="ghost small" onClick={() => setAnulando(null)}>{t("common.cancel")}</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

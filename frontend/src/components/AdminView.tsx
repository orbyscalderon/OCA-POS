import { useEffect, useState } from "react";
import { api, ApiError, assetUrl, descargarCSV, puedeNegocio, rolNegocioLabel, ROLES_ASIGNABLES, GRUPOS_PERMISOS, PLANTILLAS_PERMISOS, type Negocio, type Perfil, type RolNegocio, type Permiso } from "../api";
import { useT } from "../i18n";
import { COMPANY } from "../company";
import { Stat, usePrompt } from "./Ui";
import { MapaUbicacion } from "./MapaUbicacion";
import { PrestamosView } from "./PrestamosView";
import { Vender, Productos, Caja } from "./ComercioView";
import { AgroView } from "./AgroView";
import { MesasView } from "./MesasView";
import { ServiceOrdersView } from "./ServiceOrdersView";
import { GastosView } from "./GastosView";
import { ClientesView } from "./ClientesView";
import { ComprasView } from "./ComprasView";
import { ImpuestosView } from "./ImpuestosView";

// App de escritorio: el negocio ya vive dentro de una instalación con licencia propia, así que
// no tiene sentido ofrecerle "pasarse" a un plan de suscripción en la nube desde acá adentro.
const DESKTOP_MODE = ((import.meta.env.VITE_DESKTOP_MODE as string | undefined) ?? "").trim() === "true";

interface Miembro {
  id: number;
  estadoAprobacion: "pendiente" | "aceptado" | "rechazado";
  usuario: { id: number; nombre: string; email: string; telefono: string };
}

// El panel de un negocio (con su menú lateral) trae su propio pie de página bajo el menú, así
// que el layout general no debe repetir el footer centrado flotando debajo de todo — avisa al
// padre cuándo está mostrando ese panel para que oculte el suyo.
export function AdminView({ onPanelActivo }: { onPanelActivo?: (activo: boolean) => void } = {}) {
  const { t } = useT();
  const [negocios, setNegocios] = useState<Negocio[]>([]);
  const [negocio, setNegocio] = useState<Negocio | null>(null);
  const [cargado, setCargado] = useState(false);
  const [mostrarCrear, setMostrarCrear] = useState(false);

  function cargar() {
    api.get<{ negocios: Negocio[] }>("/negocios/mios").then((r) => {
      setNegocios(r.negocios);
      setCargado(true);
      // Si el usuario ya tiene un solo negocio, entra directo — no tiene sentido hacerlo
      // elegir entre las opciones cuando solo hay una.
      if (r.negocios.length === 1) setNegocio((actual) => actual ?? r.negocios[0]);
    });
  }
  useEffect(cargar, []);
  useEffect(() => { onPanelActivo?.(!!negocio); return () => onPanelActivo?.(false); }, [negocio]);

  if (negocio) {
    return (
      <div className="container-wide">
        {/* "Volver" solo tiene sentido si hay otro negocio al que cambiar — con uno solo,
            volver a una lista de un único ítem no lleva a ningún lado útil. */}
        <GestionEquipo negocio={negocio} onVolver={negocios.length > 1 ? () => setNegocio(null) : undefined} />
      </div>
    );
  }

  return (
    <div className="container">
      {!cargado ? (
        <p className="muted small">{t("common.loading")}</p>
      ) : negocios.length > 0 ? (
        <div className="card">
          <h2>{t("own.selectBusiness")}</h2>
          <p className="muted small">{t("own.selectHelp")}</p>
          {negocios.map((n) => (
            <div className="list-item" key={n.id}>
              <div>
                <h3>{n.nombreComercial}</h3>
                <span className="muted small">{n.direccion}</span>
                {n.miRol && n.miRol !== "dueno" && <> · <span className="badge">{rolNegocioLabel(n.miRol, t)}</span></>}
              </div>
              <button className="primary" onClick={() => setNegocio(n)}>{t("own.manage")}</button>
            </div>
          ))}
          {!mostrarCrear ? (
            <button className="ghost" style={{ marginTop: 10 }} onClick={() => setMostrarCrear(true)}>{t("own.createAnother")}</button>
          ) : (
            <CrearNegocio onCreado={() => { setMostrarCrear(false); cargar(); }} />
          )}
        </div>
      ) : (
        <CrearNegocio onCreado={cargar} />
      )}
    </div>
  );
}

function CrearNegocio({ onCreado }: { onCreado: () => void }) {
  const { t } = useT();
  const [form, setForm] = useState({ nombreComercial: "", direccion: "", telefonoContacto: "" });
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [msg, setMsg] = useState("");
  const [ubicando, setUbicando] = useState(false);
  const [perfiles, setPerfiles] = useState<Perfil[]>([]);
  const [moduloLabels, setModuloLabels] = useState<Record<string, string>>({});
  const [disponibles, setDisponibles] = useState<string[]>([]);
  // Preselecciona el rubro si el usuario llegó desde una landing por rubro.
  const [perfilSel, setPerfilSel] = useState(() => {
    try { const p = localStorage.getItem("turno_perfil_preferido"); if (p) { localStorage.removeItem("turno_perfil_preferido"); return p; } } catch { /* ignore */ }
    return "";
  });

  // Catálogo de rubros (motor de nicho). En modo "rubro fijo" llega uno solo → se auto-selecciona.
  useEffect(() => {
    api.get<{ perfiles: Perfil[]; moduloLabels: Record<string, string>; modulosDisponibles: string[] }>("/perfiles")
      .then((r) => {
        setPerfiles(r.perfiles); setModuloLabels(r.moduloLabels); setDisponibles(r.modulosDisponibles);
        const listos = r.perfiles.filter((p) => p.modulos.every((m) => r.modulosDisponibles.includes(m)));
        if (listos.length === 1) setPerfilSel((s) => s || listos[0].slug);
      })
      .catch(() => {});
  }, []);

  // Solo se puede elegir un rubro con TODOS sus módulos ya funcionando: no tiene sentido
  // dejar crear un negocio que después muestre secciones a medio construir.
  const perfilesListos = perfiles.filter((p) => p.modulos.every((m) => disponibles.includes(m)));
  const perfilObj = perfilesListos.find((p) => p.slug === perfilSel);

  function usarUbicacion() {
    if (!navigator.geolocation) return;
    setUbicando(true);
    navigator.geolocation.getCurrentPosition(
      (p) => { setCoords({ lat: p.coords.latitude, lng: p.coords.longitude }); setUbicando(false); },
      () => setUbicando(false),
    );
  }

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    if (!perfilSel) { setMsg(t("own.pickBusinessFirst")); return; }
    try {
      // El rubro elegido activa sus módulos; también sirve de categoría en el directorio.
      await api.post("/negocios", { ...form, perfil: perfilSel, categoria: perfilSel, ...(coords ?? {}) });
      setForm({ nombreComercial: "", direccion: "", telefonoContacto: "" });
      setPerfilSel(""); setCoords(null);
      setMsg(t("own.created"));
      onCreado();
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : t("common.error"));
    }
  }

  return (
    <div className="card">
      <h2>{t("own.createBusiness")}</h2>

      {/* Paso 1: elegir el rubro → activa sus módulos */}
      <label>{t("own.whatBusiness")}</label>
      <p className="muted small" style={{ margin: "0 0 10px" }}>{t("own.whatBusinessHelp")}</p>
      <div className="rubro-grid">
        {perfilesListos.map((p) => (
          <button
            type="button"
            key={p.slug}
            className={`rubro-card ${perfilSel === p.slug ? "on" : ""}`}
            onClick={() => setPerfilSel(p.slug)}
            title={p.descripcion}
          >
            <span className="rubro-emoji">{p.emoji}</span>
            <span className="rubro-name">{p.nombre}</span>
          </button>
        ))}
      </div>

      {perfilObj && (
        <div className="card pop" style={{ background: "var(--surface-2)", marginTop: 12, borderColor: "var(--brand-600)" }}>
          <p className="small muted" style={{ margin: "0 0 8px" }}>{perfilObj.descripcion}</p>
          <strong className="small">{t("own.modulesActivated")}</strong>
          <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            {perfilObj.modulos.map((m) => {
              const ok = disponibles.includes(m);
              return (
                <span key={m} className={`badge ${ok ? "ok" : ""}`} title={ok ? t("own.available") : t("own.soon")}>
                  {ok ? "✓" : "🔜"} {moduloLabels[m] ?? m}
                </span>
              );
            })}
          </div>
          <p className="muted small" style={{ margin: "8px 0 0" }}>✓ {t("own.available")} · 🔜 {t("own.soon")}</p>
        </div>
      )}

      {/* Paso 2: datos del negocio */}
      <form onSubmit={crear}>
        <label>{t("own.commercialName")}</label>
        <input value={form.nombreComercial} onChange={(e) => setForm({ ...form, nombreComercial: e.target.value })} required />
        <label>{t("own.address")}</label>
        <input value={form.direccion} onChange={(e) => setForm({ ...form, direccion: e.target.value })} required />
        <label>{t("own.locationLabel")}</label>
        <MapaUbicacion lat={coords?.lat ?? null} lng={coords?.lng ?? null} onChange={(la, ln) => setCoords({ lat: la, lng: ln })} />
        <div className="row" style={{ marginTop: 6 }}>
          <button type="button" className="ghost small" onClick={usarUbicacion} disabled={ubicando}>
            📍 {ubicando ? t("own.locating") : t("own.useLocationOpt")}
          </button>
        </div>
        <label>{t("own.phone")}</label>
        <input value={form.telefonoContacto} onChange={(e) => setForm({ ...form, telefonoContacto: e.target.value })} required />
        <button className="primary" style={{ marginTop: 12 }} disabled={!perfilSel}>{t("own.create")}</button>
      </form>
      {msg && <p className="success">{msg}</p>}
    </div>
  );
}

// Tienda online: enlace público para compartir (módulo storefront).
function TiendaLink({ slug }: { slug: string }) {
  const { t } = useT();
  // App de escritorio: 127.0.0.1 (el origen de esta ventana) solo funciona en ESTA PC — para
  // que un cliente en el mismo WiFi lo pueda abrir hace falta la IP real de la PC en la red.
  const [lanUrl, setLanUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!DESKTOP_MODE) return;
    api.get<{ lanUrl: string | null }>("/system/lan-url").then((r) => setLanUrl(r.lanUrl)).catch(() => {});
  }, []);
  const base = DESKTOP_MODE ? lanUrl : window.location.origin;
  const url = base ? `${base}/tienda/${slug}` : null;
  const [copiado, setCopiado] = useState(false);
  return (
    <div className="card">
      <h2>{t("admin.storeTitle")}</h2>
      <p className="muted small">{DESKTOP_MODE ? t("admin.storeShareLan") : t("admin.storeShare")}</p>
      {url ? (
        <div className="row" style={{ marginTop: 8 }}>
          <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
          <button className="ghost" onClick={() => { navigator.clipboard?.writeText(url); setCopiado(true); setTimeout(() => setCopiado(false), 1500); }}>{copiado ? t("admin.copied") : t("admin.copy")}</button>
          <a href={url} target="_blank" rel="noreferrer"><button className="ghost">{t("admin.open")}</button></a>
        </div>
      ) : (
        <p className="muted small">{t("admin.storeNoLan")}</p>
      )}
    </div>
  );
}

function GestionEquipo({ negocio, onVolver }: { negocio: Negocio; onVolver?: () => void }) {
  const { t } = useT();
  const [miembros, setMiembros] = useState<Miembro[]>([]);
  const [activos, setActivos] = useState(0);
  const [limite, setLimite] = useState(5);
  const [error, setError] = useState("");
  // Módulos activos del negocio según su rubro (motor de nicho).
  const [modulos, setModulos] = useState<string[]>([]);
  useEffect(() => {
    if (!negocio.perfil) { setModulos([]); return; }
    api.get<{ perfiles: Perfil[] }>("/perfiles")
      .then((r) => setModulos(r.perfiles.find((p) => p.slug === negocio.perfil)?.modulos ?? []))
      .catch(() => {});
  }, [negocio.perfil]);

  function cargar() {
    api
      .get<{ miembros: Miembro[]; activos: number; limite: number }>(`/negocios/${negocio.id}/equipo`)
      .then((r) => { setMiembros(r.miembros); setActivos(r.activos); setLimite(r.limite); })
      .catch((e) => setError(e instanceof ApiError ? e.message : t("common.error")));
  }
  useEffect(cargar, [negocio.id]);

  async function decidir(solicitudId: number, decision: "aceptado" | "rechazado") {
    setError("");
    try {
      await api.patch(`/negocios/${negocio.id}/equipo/${solicitudId}`, { decision });
      cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error"));
    }
  }

  const pendientes = miembros.filter((m) => m.estadoAprobacion === "pendiente");
  const equipo = miembros.filter((m) => m.estadoAprobacion === "aceptado");
  // Rol funcional de ESTE usuario en este negocio (undefined = dueño → acceso total).
  const miRol = negocio.miRol;
  const esAdmin = puedeNegocio(negocio, ["equipo.ver", "equipo.crear", "equipo.editar", "equipo.eliminar"]);
  // Cobros, suscripción y datos del negocio siguen siendo SOLO del dueño en el backend (cuentas
  // bancarias, facturación, cancelar plan) — el frontend refleja lo mismo.
  const esDueno = !miRol || miRol === "dueno";
  // Contabilidad se muestra si tiene AL MENOS uno de los permisos que agrupa adentro — igual
  // que el backend exige para el PIN (ver PERMISOS_CONTABILIDAD en lib/acceso.ts).
  const puedeContabilidad = esDueno || puedeNegocio(negocio, ["ventas.caja", "gastos.ver", "compras.ver", "impuestos.gestionar", "reportes.ver", "equipo.ver"]);
  const [seccionActiva, setSeccionActiva] = useState("");

  // Cada sección se muestra sola en el panel de la derecha (en vez de todo apilado en una
  // sola pantalla larga) — se arma según los mismos permisos/módulos de antes, solo que ahora
  // cada bloque es un destino del menú lateral en lugar de una tarjeta más en la lista.
  const secciones: { key: string; label: string; icon: string; content: React.ReactNode }[] = [];

  if (modulos.includes("pos") && puedeNegocio(negocio, ["ventas.vender", "inventario.ver"])) {
    secciones.push({ key: "ventas", label: t("nav.sales"), icon: "🛒", content: <Vender negocio={negocio} credit={modulos.includes("credit")} /> });
  }
  if (modulos.includes("pos") && puedeNegocio(negocio, ["inventario.ver", "inventario.crear", "inventario.editar", "inventario.eliminar"])) {
    secciones.push({ key: "inventario", label: t("nav.inventory"), icon: "📦", content: <Productos negocio={negocio} /> });
  }
  if (modulos.includes("agro") && puedeNegocio(negocio, "agro.gestionar")) {
    secciones.push({ key: "agro", label: t("nav.agro"), icon: "🐔", content: <AgroView negocio={negocio} miRol={miRol} /> });
  }
  if (esDueno && modulos.includes("lending")) {
    secciones.push({ key: "prestamos", label: t("nav.lending"), icon: "💵", content: <PrestamosView negocio={negocio} /> });
  }
  if (esDueno && modulos.includes("tables")) {
    secciones.push({ key: "mesas", label: t("nav.tables"), icon: "🍽️", content: <MesasView negocio={negocio} /> });
  }
  if (esDueno && modulos.includes("service_orders")) {
    secciones.push({ key: "ordenes", label: t("nav.orders"), icon: "🔧", content: <ServiceOrdersView negocio={negocio} /> });
  }
  if (modulos.includes("customers") && puedeNegocio(negocio, ["clientes.ver", "clientes.crear", "clientes.editar", "clientes.eliminar"])) {
    secciones.push({ key: "clientes", label: t("nav.customers"), icon: "👤", content: <ClientesView negocio={negocio} loyalty={modulos.includes("loyalty")} credit={modulos.includes("credit")} puedeEditar={puedeNegocio(negocio, ["clientes.crear", "clientes.editar"])} puedeEliminar={puedeNegocio(negocio, "clientes.eliminar")} /> });
  }
  if (modulos.includes("storefront") && esAdmin) {
    secciones.push({ key: "tienda", label: t("nav.store"), icon: "🌐", content: <TiendaLink slug={negocio.slug} /> });
  }

  // Contabilidad agrupa todo lo sensible (equipo/roles, caja, compras, gastos, impuestos,
  // analítica) detrás de un PIN aparte del login — así un cajero con sesión iniciada no puede
  // ver quién gana qué, cuánto hay en caja, ni los números del negocio sin que el dueño
  // autorice esa pantalla puntual. Se muestra a cualquiera con al menos un permiso de esa
  // área — adentro, cada bloque igual se filtra por su propio permiso.
  if (puedeContabilidad) {
    secciones.push({
      key: "contabilidad",
      label: t("nav.accounting"),
      icon: "🔒",
      content: (
        <ContabilidadPanel negocio={negocio}>
          {esAdmin && (
            <div className="card">
              <div className="row spread">
                <h2>{t("own.activeTeam")}</h2>
                <span className={`badge ${activos >= limite ? "err" : "ok"}`}>{activos} / {limite} {t("own.professionals")}</span>
              </div>
              {error && <p className="error">{error}</p>}
              {equipo.map((m) => (
                <div className="list-item" key={m.id}>
                  <div><h3>{m.usuario.nombre}</h3><span className="muted small">{m.usuario.email}</span></div>
                  <button className="ghost" onClick={() => decidir(m.id, "rechazado")}>{t("own.remove")}</button>
                </div>
              ))}
              {equipo.length === 0 && <p className="muted small">{t("own.noActivePros")}</p>}
            </div>
          )}

          {esAdmin && (
            <div className="card">
              <h2>{t("own.pendingRequests")} ({pendientes.length})</h2>
              {pendientes.map((m) => (
                <div className="list-item" key={m.id}>
                  <div><h3>{m.usuario.nombre}</h3><span className="muted small">{m.usuario.email} · {m.usuario.telefono}</span></div>
                  <div className="row">
                    <button className="primary" disabled={activos >= limite} onClick={() => decidir(m.id, "aceptado")}>{t("own.accept")}</button>
                    <button className="ghost" onClick={() => decidir(m.id, "rechazado")}>{t("own.reject")}</button>
                  </div>
                </div>
              ))}
              {pendientes.length === 0 && <p className="muted small">{t("own.noPending")}</p>}
              {activos >= limite && pendientes.length > 0 && <p className="error">{t("own.limitReached")}</p>}
            </div>
          )}

          {esAdmin && <PersonalNegocio negocioId={negocio.id} modulos={modulos} />}
          {/* El "equipo de profesionales" con agenda solo aplica a rubros con citas — un
              comercio minorista como una tienda de vapes no tiene profesionales que reservan. */}
          {modulos.includes("appointments") && esAdmin && <Invitacion negocioId={negocio.id} />}

          {modulos.includes("pos") && puedeNegocio(negocio, "ventas.caja") && <Caja negocio={negocio} />}
          {modulos.includes("purchasing") && puedeNegocio(negocio, "compras.ver") && (
            <ComprasView negocio={negocio} puedeCrear={puedeNegocio(negocio, "compras.crear")} puedeEliminar={puedeNegocio(negocio, "compras.eliminar")} />
          )}
          {modulos.includes("expenses") && puedeNegocio(negocio, "gastos.ver") && (
            <GastosView negocio={negocio} puedeCrear={puedeNegocio(negocio, "gastos.crear")} puedeEliminar={puedeNegocio(negocio, "gastos.eliminar")} />
          )}
          {modulos.includes("taxes") && puedeNegocio(negocio, "impuestos.gestionar") && <ImpuestosView negocio={negocio} />}
          {modulos.includes("pos") && puedeNegocio(negocio, "reportes.ver") && <Rentabilidad negocioId={negocio.id} />}
          {/* La analítica de citas/profesionales solo tiene datos reales en rubros con
              agenda — en un comercio minorista sin citas siempre da todo en cero. */}
          {modulos.includes("appointments") && puedeNegocio(negocio, "reportes.ver") && <Analitica negocioId={negocio.id} />}
        </ContabilidadPanel>
      ),
    });
  }
  if (esDueno) {
    secciones.push({
      key: "config",
      label: t("nav.settings"),
      icon: "⚙️",
      content: (
        <>
          <Ubicacion negocio={negocio} />
          <ImagenNegocio negocioId={negocio.id} tipo="cover" />
          <ImagenNegocio negocioId={negocio.id} tipo="logo" />
          {modulos.includes("loyalty") && <ConfigLealtad negocio={negocio} />}
          {/* Cobrar la fianza de una reserva solo aplica a rubros con citas (barbería, taller,
              veterinaria...) — un comercio minorista como una tienda de vapes no toma reservas. */}
          {modulos.includes("appointments") && <Cobros negocioId={negocio.id} />}
          {DESKTOP_MODE && <Respaldo />}
          <Suscripcion negocioId={negocio.id} />
        </>
      ),
    });
  }

  const activa = secciones.find((s) => s.key === seccionActiva) ?? secciones[0];

  return (
    <div>
      <div className="row spread">
        <h1>{negocio.nombreComercial}</h1>
        {onVolver && <button className="ghost" onClick={onVolver}>{t("common.back")}</button>}
      </div>

      {miRol && miRol !== "dueno" && (
        <p className="muted small">{t("admin.enteredAs")} <strong>{rolNegocioLabel(miRol, t)}</strong> {t("admin.roleRestriction")}</p>
      )}

      <div className="biz-layout">
        <nav className="biz-sidebar">
          {secciones.map((s) => (
            <button
              key={s.key}
              className={`biz-sidebar-btn ${activa?.key === s.key ? "active" : ""}`}
              onClick={() => setSeccionActiva(s.key)}
            >
              <span className="icon">{s.icon}</span> {s.label}
            </button>
          ))}
          <div className="biz-sidebar-footer">
            <div>
              <a href="/terminos" target="_blank" rel="noreferrer">{t("footer.terms")}</a> · <a href="/privacidad" target="_blank" rel="noreferrer">{t("footer.privacy")}</a>
            </div>
            <div>{t("footer.operatedBy")} {COMPANY.nombre}</div>
            <div>© {new Date().getFullYear()} OCA POS</div>
          </div>
        </nav>
        <div className="biz-content">{activa?.content}</div>
      </div>
    </div>
  );
}

// ---------- Contabilidad: gastos/impuestos/compras/analítica detrás de un PIN aparte ----------
function ContabilidadPanel({ negocio, children }: { negocio: Negocio; children: React.ReactNode }) {
  const { t } = useT();
  const [configurado, setConfigurado] = useState<boolean | null>(null);
  const [desbloqueado, setDesbloqueado] = useState(false);
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    api.get<{ configurado: boolean }>(`/negocios/${negocio.id}/pin-contabilidad`)
      .then((r) => setConfigurado(r.configurado))
      .catch(() => setConfigurado(false));
  }, [negocio.id]);

  async function definirPin() {
    setError("");
    if (pin.length < 4) { setError(t("pin.tooShort")); return; }
    if (pin !== pin2) { setError(t("pin.mismatch")); return; }
    setCargando(true);
    try {
      await api.post(`/negocios/${negocio.id}/pin-contabilidad`, { pin });
      setConfigurado(true);
      setDesbloqueado(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.error"));
    } finally {
      setCargando(false);
    }
  }

  async function verificarPin() {
    setError("");
    setCargando(true);
    try {
      await api.post(`/negocios/${negocio.id}/pin-contabilidad/verificar`, { pin });
      setDesbloqueado(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.error"));
    } finally {
      setCargando(false);
    }
  }

  if (configurado === null) return <p className="muted small">{t("common.loading")}</p>;

  if (desbloqueado) return <>{children}</>;

  const esDueno = !negocio.miRol || negocio.miRol === "dueno";

  if (!configurado) {
    // Solo el dueño puede definir el PIN (el backend también lo exige) — el personal con
    // acceso a Contabilidad tiene que esperar a que lo configure, no tiene sentido mostrarle
    // un formulario que va a fallar al guardar.
    if (!esDueno) return <p className="muted small">{t("pin.waitingOwner")}</p>;
    return (
      <div className="card pin-gate">
        <h2>{t("pin.setTitle")}</h2>
        <p className="muted small">{t("pin.setDesc")}</p>
        <input type="password" inputMode="numeric" maxLength={20} value={pin} onChange={(e) => setPin(e.target.value)} placeholder="••••" />
        <input type="password" inputMode="numeric" maxLength={20} value={pin2} onChange={(e) => setPin2(e.target.value)} placeholder={t("pin.repeat")} style={{ marginTop: 8 }} />
        {error && <p className="error">{error}</p>}
        <button className="primary" style={{ width: "100%", marginTop: 12 }} disabled={cargando} onClick={definirPin}>{t("pin.setBtn")}</button>
      </div>
    );
  }

  return (
    <div className="card pin-gate">
      <h2>{t("pin.enterTitle")}</h2>
      <p className="muted small">{t("pin.enterDesc")}</p>
      <input
        type="password" inputMode="numeric" maxLength={20} value={pin} autoFocus
        onChange={(e) => setPin(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && verificarPin()}
        placeholder="••••"
      />
      {error && <p className="error">{error}</p>}
      <button className="primary" style={{ width: "100%", marginTop: 12 }} disabled={cargando} onClick={verificarPin}>{t("pin.unlock")}</button>
    </div>
  );
}

// ---------- Personal del negocio: permisos granulares, función por función ----------
interface MiembroFuncional {
  id: string; rol: RolNegocio; permisos: Permiso[]; activo: boolean;
  usuario: { id: number; nombre: string; email: string; telefono: string };
}

// Si la lista de permisos coincide exactamente con una plantilla, se usa su nombre para la
// etiqueta (badge); si no, es una combinación armada a mano.
function nombrePlantilla(permisos: Permiso[]): string {
  const set = new Set(permisos);
  for (const [nombre, lista] of Object.entries(PLANTILLAS_PERMISOS)) {
    if (lista.length === set.size && lista.every((p) => set.has(p))) return nombre;
  }
  return "personalizado";
}

// Checkboxes de permisos agrupados por área + botones de plantilla rápida para no tener que
// tildar las 24 casillas una por una. Se reutiliza tanto para dar de alta a alguien como para
// editar los permisos de alguien que ya está.
function SelectorPermisos({ modulos, value, onChange }: { modulos: string[]; value: Permiso[]; onChange: (p: Permiso[]) => void }) {
  const { t } = useT();
  function toggle(p: Permiso) {
    onChange(value.includes(p) ? value.filter((x) => x !== p) : [...value, p]);
  }
  const grupos = GRUPOS_PERMISOS.filter((g) => !g.modulo || modulos.includes(g.modulo));
  return (
    <div>
      <div className="row" style={{ flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        <span className="muted small" style={{ alignSelf: "center" }}>{t("staff.template")}:</span>
        {ROLES_ASIGNABLES.map((r) => (
          <button key={r.value} type="button" className="ghost small" onClick={() => onChange(PLANTILLAS_PERMISOS[r.value] ?? [])}>
            {t(r.shortKey)}
          </button>
        ))}
        <button type="button" className="ghost small" onClick={() => onChange([])}>{t("staff.templateNone")}</button>
      </div>
      <div className="grid grid-2">
        {grupos.map((g) => (
          <div key={g.grupo} style={{ background: "var(--surface-2)", borderRadius: 10, padding: 10 }}>
            <strong className="small">{t(g.grupo)}</strong>
            {g.permisos.map((p) => (
              <label key={p.value} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, cursor: "pointer" }}>
                <input type="checkbox" checked={value.includes(p.value)} onChange={() => toggle(p.value)} style={{ width: 16, height: 16, padding: 0, flexShrink: 0 }} />
                <span className="small">{t(p.labelKey)}</span>
              </label>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function PersonalNegocio({ negocioId, modulos }: { negocioId: string; modulos: string[] }) {
  const { t } = useT();
  const [miembros, setMiembros] = useState<MiembroFuncional[]>([]);
  const [permisosInvitar, setPermisosInvitar] = useState<Permiso[]>(PLANTILLAS_PERMISOS.cajero);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [editando, setEditando] = useState<string | null>(null);
  const [permisosEditar, setPermisosEditar] = useState<Permiso[]>([]);
  const { promptConfirmar, modal } = usePrompt();

  // App de escritorio: crea la cuenta directo, ya que un link de invitación no le llegaría a
  // nadie (el servidor solo es alcanzable en esta misma PC).
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [nuevoEmail, setNuevoEmail] = useState("");
  const [nuevoTelefono, setNuevoTelefono] = useState("");
  const [nuevaClave, setNuevaClave] = useState("");
  const [creando, setCreando] = useState(false);

  function cargar() {
    api.get<{ miembros: MiembroFuncional[] }>(`/negocios/${negocioId}/miembros`)
      .then((r) => setMiembros(r.miembros)).catch((e) => setError(e instanceof ApiError ? e.message : t("common.error")));
  }
  useEffect(cargar, [negocioId]);

  async function invitar() {
    setError(""); setUrl("");
    try {
      const r = await api.post<{ url: string }>(`/negocios/${negocioId}/invitaciones`, { rol: nombrePlantilla(permisosInvitar), permisos: permisosInvitar });
      setUrl(r.url);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.error"));
    }
  }

  async function crearDirecto() {
    setError("");
    setCreando(true);
    try {
      await api.post(`/negocios/${negocioId}/miembros/crear-directo`, {
        nombre: nuevoNombre, email: nuevoEmail, telefono: nuevoTelefono, password: nuevaClave,
        rol: nombrePlantilla(permisosInvitar), permisos: permisosInvitar,
      });
      setNuevoNombre(""); setNuevoEmail(""); setNuevoTelefono(""); setNuevaClave("");
      cargar();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.error"));
    } finally {
      setCreando(false);
    }
  }

  function empezarEditar(m: MiembroFuncional) {
    setEditando(editando === m.id ? null : m.id);
    setPermisosEditar(m.permisos ?? []);
  }

  async function guardarPermisos(m: MiembroFuncional) {
    await api.patch(`/negocios/${negocioId}/miembros/${m.id}`, { rol: nombrePlantilla(permisosEditar), permisos: permisosEditar });
    setEditando(null);
    cargar();
  }

  async function quitar(m: MiembroFuncional) {
    if (!(await promptConfirmar(`${t("admin.removeConfirm")} ${m.usuario.nombre} ${t("admin.removeConfirmSuffix")}`))) return;
    await api.del(`/negocios/${negocioId}/miembros/${m.id}`);
    cargar();
  }

  return (
    <div className="card">
      <h2>{t("admin.staffTitle")}</h2>
      <p className="muted small">{t("admin.staffIntro")}</p>
      {error && <p className="error small">{error}</p>}

      {miembros.map((m) => (
        <div key={m.id} style={{ borderBottom: "1px solid var(--border)", paddingBottom: 8, marginBottom: 8 }}>
          <div className="list-item" style={{ borderBottom: "none", padding: "8px 0" }}>
            <div>
              <h3>{m.usuario.nombre}</h3>
              <span className="muted small">{m.usuario.email} · <span className="badge">{rolNegocioLabel(m.rol, t)}</span> · {(m.permisos ?? []).length} {t("staff.permCount")}</span>
            </div>
            <div className="row">
              <button className="ghost small" onClick={() => empezarEditar(m)}>{editando === m.id ? t("common.cancel") : t("staff.editPerms")}</button>
              <button className="ghost small" onClick={() => quitar(m)}>{t("admin.remove")}</button>
            </div>
          </div>
          {editando === m.id && (
            <div style={{ marginTop: 6 }}>
              <SelectorPermisos modulos={modulos} value={permisosEditar} onChange={setPermisosEditar} />
              <button className="primary small" style={{ marginTop: 8 }} onClick={() => guardarPermisos(m)}>{t("common.save")}</button>
            </div>
          )}
        </div>
      ))}
      {miembros.length === 0 && <p className="muted small">{t("admin.noStaffYet")}</p>}

      <div style={{ marginTop: 14 }}>
        <strong className="small">{t("staff.newStaff")}</strong>
        <SelectorPermisos modulos={modulos} value={permisosInvitar} onChange={setPermisosInvitar} />
      </div>

      {DESKTOP_MODE ? (
        <div style={{ marginTop: 10 }}>
          <div className="grid grid-2">
            <input placeholder={t("staff.name")} value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} />
            <input placeholder={t("staff.phone")} value={nuevoTelefono} onChange={(e) => setNuevoTelefono(e.target.value)} />
            <input placeholder={t("staff.email")} value={nuevoEmail} onChange={(e) => setNuevoEmail(e.target.value)} />
            <input type="password" placeholder={t("staff.password")} value={nuevaClave} onChange={(e) => setNuevaClave(e.target.value)} />
          </div>
          <button className="primary" style={{ marginTop: 8 }} disabled={creando} onClick={crearDirecto}>{t("staff.create")}</button>
        </div>
      ) : (
        <>
          <button className="primary" style={{ marginTop: 10 }} onClick={invitar}>{t("admin.generateInvite")}</button>
          {url && (
            <div className="row" style={{ marginTop: 10 }}>
              <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
              <button className="ghost" onClick={() => navigator.clipboard?.writeText(url)}>{t("admin.copy")}</button>
            </div>
          )}
        </>
      )}
      {modal}
    </div>
  );
}

interface Split { fianzaUsd: number; alNegocioUsd: number; turnoNetoUsd: number; feeStripeUsd: number; }
interface Liq { desde: string; empleados: { peluquero: string; reservasPagadas: number; fianzaNegocioUsd: number }[]; totalReservas: number; totalNegocioUsd: number; }

// Onboarding de Stripe Connect + desglose del reparto + liquidación por empleado.
function Cobros({ negocioId }: { negocioId: string }) {
  const { t } = useT();
  const [estado, setEstado] = useState<{ conectado: boolean; cobrosActivos: boolean; payout?: { intervalo: string; anchor: number } } | null>(null);
  const [split, setSplit] = useState<Split | null>(null);
  const [liq, setLiq] = useState<Liq | null>(null);
  const [msg, setMsg] = useState("");

  function cargar() {
    api.get<{ conectado: boolean; cobrosActivos: boolean; payout?: { intervalo: string; anchor: number } }>(`/connect/estado/${negocioId}`).then(setEstado).catch(() => {});
    api.get<Liq>(`/negocios/${negocioId}/liquidacion`).then(setLiq).catch(() => {});
  }
  useEffect(cargar, [negocioId]);
  useEffect(() => { api.get<Split>("/reservas/split").then(setSplit).catch(() => {}); }, []);

  async function conectar() {
    setMsg("");
    const r = await api.post<{ onboardingUrl: string | null; mensaje?: string }>("/connect/onboard", { negocioId });
    if (r.onboardingUrl) window.location.href = r.onboardingUrl;
    else { setMsg(r.mensaje ?? "OK"); cargar(); }
  }

  async function cambiarPayout(intervalo: string) {
    setMsg("");
    await api.post("/connect/payout-schedule", { negocioId, intervalo, anchor: 1 });
    setMsg(t("own.payoutSaved"));
    cargar();
  }

  return (
    <div className="card">
      <h2>{t("own.payouts")}</h2>
      <p className="muted small">{t("own.payoutsHelp")}</p>
      {estado?.cobrosActivos ? (
        <p className="success">{t("own.payoutsActive")}</p>
      ) : (
        <>
          <button className="primary" onClick={conectar}>{t("own.payoutsConnect")}</button>
          {estado?.conectado && !estado.cobrosActivos && <p className="small" style={{ color: "var(--amber)" }}>{t("own.payoutsPending")}</p>}
        </>
      )}

      {/* Calendario de depósitos */}
      {estado && (
        <div className="row" style={{ marginTop: 10 }}>
          <span className="muted small">{t("own.payoutSchedule")}:</span>
          {(["daily", "weekly", "monthly"] as const).map((iv) => (
            <button key={iv} className={estado.payout?.intervalo === iv ? "selected small" : "ghost small"} onClick={() => cambiarPayout(iv)}>
              {iv === "daily" ? t("own.daily") : iv === "weekly" ? t("own.weekly") : t("own.monthly")}
            </button>
          ))}
        </div>
      )}
      {msg && <p className="success">{msg}</p>}

      {/* Desglose de cada fianza (contando la comisión de Stripe) */}
      {split && (
        <div className="card" style={{ background: "var(--surface-2)", marginTop: 14, marginBottom: 0 }}>
          <h3 style={{ marginBottom: 8 }}>{t("own.splitTitle")}: ${split.fianzaUsd.toFixed(2)}</h3>
          <div className="row" style={{ gap: 8 }}>
            <span className="badge ok">{t("own.splitBusiness")}: ${split.alNegocioUsd.toFixed(2)}</span>
            <span className="badge">{t("own.splitPlatform")}: ${split.turnoNetoUsd.toFixed(2)}</span>
            <span className="badge warn">{t("own.splitStripe")}: ${split.feeStripeUsd.toFixed(2)}</span>
          </div>
        </div>
      )}

      {/* Liquidación por empleado */}
      {liq && (
        <div style={{ marginTop: 16 }}>
          <div className="row spread">
            <h3>{t("own.settlement")}</h3>
            {liq.empleados.length > 0 && liq.totalReservas > 0 && (
              <button className="ghost small" onClick={() => descargarCSV(
                `liquidacion-${liq.desde}.csv`,
                ["Empleado", "Reservas pagadas", "Para el negocio (USD)"],
                liq.empleados.map((e) => [e.peluquero, e.reservasPagadas, e.fianzaNegocioUsd.toFixed(2)]),
              )}>⬇ {t("common.download")}</button>
            )}
          </div>
          <p className="muted small">{t("own.settlementHelp")}</p>
          {liq.empleados.length === 0 || liq.totalReservas === 0 ? (
            <p className="muted small">{t("own.noSettlement")}</p>
          ) : (
            <>
              {liq.empleados.map((e) => (
                <div className="list-item" key={e.peluquero}>
                  <div><h3>{e.peluquero}</h3><span className="muted small">{e.reservasPagadas} {t("own.bookings")}</span></div>
                  <strong>${e.fianzaNegocioUsd.toFixed(2)}</strong>
                </div>
              ))}
              <div className="row spread" style={{ marginTop: 8 }}>
                <span className="muted small">{t("own.forBusiness")} · {liq.totalReservas} {t("own.bookings")}</span>
                <strong className="grad-text" style={{ fontSize: 16 }}>${liq.totalNegocioUsd.toFixed(2)}</strong>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Invitacion({ negocioId }: { negocioId: string }) {
  const { t } = useT();
  const [url, setUrl] = useState("");
  async function generar() {
    const r = await api.post<{ url: string }>(`/negocios/${negocioId}/invitaciones`);
    setUrl(r.url);
  }
  return (
    <div className="card">
      <h2>{t("own.inviteTitle")}</h2>
      <p className="muted small">{t("own.inviteHelp")}</p>
      <button onClick={generar}>{t("own.inviteGen")}</button>
      {url && (
        <div className="row" style={{ marginTop: 10 }}>
          <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
          <button className="ghost" onClick={() => navigator.clipboard?.writeText(url)}>{t("own.copy")}</button>
        </div>
      )}
    </div>
  );
}

interface Plan {
  id: string; nombre: string; tipo: "suscripcion" | "pago_unico";
  mensualUsd?: number; anualUsd?: number; anualPorMes?: number; ahorroAnualUsd?: number;
  maxNegocios: number; maxPeluqueros: number;
}
interface EstadoSub { estadoSuscripcion: string; plan: string | null; intervaloPlan: string | null; suscripcionHasta: string | null; }

function Suscripcion({ negocioId }: { negocioId: string }) {
  const { t } = useT();
  const [estado, setEstado] = useState<EstadoSub | null>(null);
  const [planes, setPlanes] = useState<Plan[]>([]);
  const [intervalo, setIntervalo] = useState<"mensual" | "anual">("anual");
  const [msg, setMsg] = useState("");

  function cargar() {
    api.get<EstadoSub>(`/suscripcion/estado/${negocioId}`).then(setEstado);
  }
  useEffect(cargar, [negocioId]);
  useEffect(() => { api.get<{ planes: Plan[] }>("/suscripcion/planes").then((r) => setPlanes(r.planes)); }, []);

  async function elegir(plan: string) {
    setMsg("");
    const r = await api.post<{ modo: string; checkoutUrl: string | null; mensaje?: string }>("/suscripcion/checkout", { negocioId, plan, intervalo });
    if (r.checkoutUrl) window.location.href = r.checkoutUrl;
    else { setMsg(r.mensaje ?? "OK"); cargar(); }
  }

  // Suscripciones de la nube (Básico/Pro): no tienen sentido dentro de la app de escritorio,
  // que ya corre bajo su propia licencia — ahí solo se muestra el estado y el pedido a medida.
  const planesSuscripcion = planes.filter((p) => p.tipo === "suscripcion");

  return (
    <div className="card">
      <h2>{t("own.subscription")}</h2>
      {estado && (
        <p className="small">
          {t("own.subStatus")}: <span className={`badge ${estado.estadoSuscripcion === "activo" ? "ok" : estado.estadoSuscripcion === "vencido" ? "err" : "warn"}`}>{estado.estadoSuscripcion}</span>
          {estado.plan && <> · {t("own.currentPlan")}: <strong>{estado.plan}</strong> ({estado.intervaloPlan})</>}
          {estado.suscripcionHasta && <> · {t("own.subUntil")} {new Date(estado.suscripcionHasta).toLocaleDateString()}</>}
        </p>
      )}

      {!DESKTOP_MODE && (
        <>
          {/* Toggle mensual / anual */}
          <div className="lang-toggle" style={{ margin: "10px 0 16px" }}>
            <button className={intervalo === "mensual" ? "on" : ""} onClick={() => setIntervalo("mensual")}>{t("own.monthly")}</button>
            <button className={intervalo === "anual" ? "on" : ""} onClick={() => setIntervalo("anual")}>{t("own.annual")} · {t("own.save2months")}</button>
          </div>

          <div className="grid grid-2">
            {planesSuscripcion.map((p) => {
              const activo = estado?.plan === p.id && estado?.estadoSuscripcion === "activo";
              return (
                <div className="card" key={p.id} style={{ margin: 0, borderColor: activo ? "var(--brand-500)" : undefined }}>
                  <div className="row spread">
                    <h3>{p.nombre}</h3>
                    {intervalo === "anual" && <span className="badge ok">-${p.ahorroAnualUsd}</span>}
                  </div>
                  {intervalo === "mensual" ? (
                    <div style={{ margin: "8px 0" }}><span style={{ fontSize: 30, fontWeight: 800 }}>${p.mensualUsd}</span><span className="muted">{t("own.perMonth")}</span></div>
                  ) : (
                    <div style={{ margin: "8px 0" }}>
                      <span style={{ fontSize: 30, fontWeight: 800 }}>${p.anualUsd}</span><span className="muted">{t("own.perYear")}</span>
                      <div className="muted small">${p.anualPorMes}{t("own.perMonth")} · {t("own.annualBilled")}</div>
                    </div>
                  )}
                  <ul className="muted small" style={{ margin: "8px 0 10px", paddingLeft: 18 }}>
                    <li>✅ {p.maxNegocios} {t("plan.businessesLabel")}</li>
                    <li>✅ {t("plan.upTo")} {p.maxPeluqueros} {t("plan.prosLabel")}</li>
                  </ul>
                  <button className={activo ? "ghost" : "primary"} style={{ width: "100%", marginTop: 6 }} onClick={() => elegir(p.id)}>
                    {activo ? `✓ ${t("own.currentPlan")}` : t("own.choosePlan")}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}

      <SolicitarFuncion negocioId={negocioId} />
      {msg && <p className="success">{msg}</p>}
    </div>
  );
}

// Ya con un plan/licencia activo, este es el canal para pedir algo puntual para TU sistema
// (no es un catálogo — se cotiza aparte). Va por email a soporte, sin flujo de pago acá.
function SolicitarFuncion({ negocioId }: { negocioId: string }) {
  const { t } = useT();
  const [abierto, setAbierto] = useState(false);
  const [descripcion, setDescripcion] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  async function enviar() {
    setError(""); setMsg("");
    if (descripcion.trim().length < 10) { setError(t("feature.tooShort")); return; }
    setEnviando(true);
    try {
      await api.post(`/negocios/${negocioId}/solicitar-funcion`, { descripcion });
      setMsg(t("feature.sent"));
      setDescripcion(""); setAbierto(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.error"));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h3 style={{ marginTop: 0 }}>{t("feature.title")}</h3>
      <p className="muted small">{t("feature.desc")}</p>
      {!abierto ? (
        <button className="ghost" onClick={() => setAbierto(true)}>{t("feature.cta")}</button>
      ) : (
        <>
          <textarea
            rows={4}
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            placeholder={t("feature.placeholder")}
            style={{ width: "100%" }}
          />
          {error && <p className="error">{error}</p>}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="primary" disabled={enviando} onClick={enviar}>{t("feature.send")}</button>
            <button className="ghost" onClick={() => setAbierto(false)}>{t("common.cancel")}</button>
          </div>
        </>
      )}
      {msg && <p className="success small">{msg}</p>}
    </div>
  );
}

// Regla de fidelización: cuántos puntos da cada venta y cuántos hacen falta para el premio
// (ej. "cada 10 recargas, la próxima gratis" = 1 punto por venta, 10 para el premio).
function ConfigLealtad({ negocio }: { negocio: Negocio }) {
  const { t } = useT();
  const [porVenta, setPorVenta] = useState(String(negocio.puntosPorVenta ?? 1));
  const [paraPremio, setParaPremio] = useState(String(negocio.puntosParaPremio ?? 10));
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  async function guardar(e: React.FormEvent) {
    e.preventDefault(); setError(""); setMsg("");
    try {
      await api.patch(`/negocios/${negocio.id}`, { puntosPorVenta: Number(porVenta), puntosParaPremio: Number(paraPremio) });
      setMsg(t("loyalty.saved"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error"));
    }
  }

  return (
    <form onSubmit={guardar} className="card">
      <h2>{t("loyalty.title")}</h2>
      <p className="muted small">{t("loyalty.help")}</p>
      <div className="grid grid-2">
        <div><label>{t("loyalty.perSale")}</label><input type="number" min="0" step="1" value={porVenta} onChange={(e) => setPorVenta(e.target.value)} /></div>
        <div><label>{t("loyalty.forReward")}</label><input type="number" min="1" step="1" value={paraPremio} onChange={(e) => setParaPremio(e.target.value)} /></div>
      </div>
      {msg && <p className="success small">{msg}</p>}
      {error && <p className="error small">{error}</p>}
      <button className="primary" style={{ marginTop: 10 }}>{t("common.save")}</button>
    </form>
  );
}

// Backup local: dos formas, gratis (este archivo, lo guarda el dueño donde quiera — USB, disco
// externo, Google Drive de la PC) y en la nube (función paga, todavía no disponible — se pide
// por el mismo canal que las demás funciones a medida).
declare global {
  interface Window {
    ocapos?: {
      crearBackup: () => Promise<{ ok: boolean; path?: string; error?: string; cancelado?: boolean }>;
      restaurarBackup: () => Promise<{ ok: boolean; error?: string; cancelado?: boolean }>;
    };
  }
}

function Respaldo() {
  const { t } = useT();
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);

  async function crear() {
    if (!window.ocapos) return;
    setMsg(""); setError(""); setOcupado(true);
    const r = await window.ocapos.crearBackup();
    setOcupado(false);
    if (r.ok) setMsg(`${t("backup.created")} ${r.path ?? ""}`);
    else if (!r.cancelado) setError(r.error || t("common.error"));
  }

  async function restaurar() {
    if (!window.ocapos) return;
    setMsg(""); setError(""); setOcupado(true);
    const r = await window.ocapos.restaurarBackup();
    // Si tuvo éxito, la app se relanza sola (no hace falta mostrar nada acá).
    setOcupado(false);
    if (!r.ok && !r.cancelado) setError(r.error || t("common.error"));
  }

  return (
    <div className="card">
      <h2>{t("backup.title")}</h2>
      <p className="muted small">{t("backup.localHelp")}</p>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button className="primary" disabled={ocupado} onClick={crear}>💾 {t("backup.create")}</button>
        <button className="ghost" disabled={ocupado} onClick={restaurar}>♻️ {t("backup.restore")}</button>
      </div>
      {msg && <p className="success small" style={{ marginTop: 8 }}>{msg}</p>}
      {error && <p className="error small" style={{ marginTop: 8 }}>{error}</p>}
      <hr style={{ margin: "14px 0" }} />
      <div className="row spread">
        <div>
          <strong className="small">{t("backup.cloudTitle")}</strong>
          <p className="muted small" style={{ margin: "2px 0 0" }}>{t("backup.cloudHelp")}</p>
        </div>
        <span className="badge">{t("backup.cloudBadge")}</span>
      </div>
    </div>
  );
}

function Ubicacion({ negocio }: { negocio: Negocio }) {
  const { t } = useT();
  const [direccion, setDireccion] = useState(negocio.direccion);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    negocio.lat != null && negocio.lng != null ? { lat: negocio.lat, lng: negocio.lng } : null,
  );
  const [msg, setMsg] = useState("");
  const [ubicando, setUbicando] = useState(false);

  function usarUbicacion() {
    if (!navigator.geolocation) return;
    setUbicando(true);
    navigator.geolocation.getCurrentPosition(
      (p) => { setCoords({ lat: p.coords.latitude, lng: p.coords.longitude }); setUbicando(false); },
      () => setUbicando(false),
    );
  }

  async function guardar() {
    setMsg("");
    try {
      await api.patch(`/negocios/${negocio.id}`, { direccion, ...(coords ?? {}) });
      setMsg(t("own.locationSaved"));
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : t("common.error"));
    }
  }

  return (
    <div className="card">
      <h2>{t("own.locationTitle")}</h2>
      <p className="muted small">{t("own.locationHelp")}</p>
      <label>{t("own.address")}</label>
      <input value={direccion} onChange={(e) => setDireccion(e.target.value)} />

      <MapaUbicacion lat={coords?.lat ?? null} lng={coords?.lng ?? null} onChange={(la, ln) => setCoords({ lat: la, lng: ln })} />

      <div className="row" style={{ marginTop: 6 }}>
        <button type="button" className="ghost small" onClick={usarUbicacion} disabled={ubicando}>
          📍 {ubicando ? t("own.locating") : t("own.useLocationOpt")}
        </button>
        {coords && <a href={`https://www.google.com/maps/search/?api=1&query=${coords.lat},${coords.lng}`} target="_blank" rel="noreferrer">{t("mkt.viewMap")}</a>}
      </div>
      <button className="primary" style={{ marginTop: 12 }} onClick={guardar}>{t("own.saveLocation")}</button>
      {msg && <p className="success">{msg}</p>}
    </div>
  );
}

function ImagenNegocio({ negocioId, tipo }: { negocioId: string; tipo: "logo" | "cover" }) {
  const { t } = useT();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const esCover = tipo === "cover";
  async function subir(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    try {
      const r = await api.upload<{ logoUrl?: string; coverUrl?: string }>(`/uploads/${tipo}/${negocioId}`, "imagen", file);
      setUrl(r.coverUrl ?? r.logoUrl ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error"));
    }
  }
  return (
    <div className="card">
      <h2>{esCover ? t("own.coverPhoto") : t("own.logo")}</h2>
      <p className="muted small">{esCover ? t("own.coverHelp") : t("own.logoHelp")}</p>
      <input type="file" accept="image/*" onChange={subir} />
      {error && <p className="error">{error}</p>}
      {url && <div style={{ marginTop: 10 }}><img src={assetUrl(url)} alt={tipo} style={{ height: esCover ? 120 : 64, width: esCover ? "100%" : 64, objectFit: "cover", borderRadius: esCover ? 12 : "50%" }} /></div>}
    </div>
  );
}

interface AnaliticaData {
  totalReservas: number;
  porEstado: { estado: string; total: number }[];
  ingresoServiciosUsd: number;
  porPeluquero: { peluquero: string; reservas: number }[];
}

function Analitica({ negocioId }: { negocioId: string }) {
  const { t } = useT();
  const [data, setData] = useState<AnaliticaData | null>(null);
  useEffect(() => {
    api.get<AnaliticaData>(`/negocios/${negocioId}/analitica`).then(setData).catch(() => {});
  }, [negocioId]);

  if (!data) return null;
  return (
    <div className="card">
      <h2>{t("own.analytics")}</h2>
      <div className="grid grid-2">
        <Stat label={t("own.totalBookings")} value={data.totalReservas} icon="📅" />
        <Stat label={t("own.incomeCompleted")} value={`$${data.ingresoServiciosUsd.toFixed(2)}`} icon="💰" variant="green" />
      </div>
      {data.porEstado.length > 0 && (
        <div className="row" style={{ marginTop: 8 }}>
          {data.porEstado.map((e) => <span className="badge" key={e.estado}>{e.estado}: {e.total}</span>)}
        </div>
      )}
      {data.porPeluquero.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <h3>{t("own.bookingsByPro")}</h3>
          {data.porPeluquero.map((p) => (
            <div className="list-item" key={p.peluquero}><span>{p.peluquero}</span><strong>{p.reservas}</strong></div>
          ))}
        </div>
      )}
    </div>
  );
}

interface RentabilidadData {
  dias: number; ingresoTotal: number; costoTotal: number; margenTotal: number; ingresoSinCosto: number;
  productos: { nombre: string; tipoProducto: string; unidades: number; ingreso: number; costo: number; margen: number }[];
}

// Qué producto deja más plata de verdad (ingreso menos costo), no solo cuál vende más —
// distinto de "Analitica" (esa es del módulo de citas, no de ventas de comercio).
function Rentabilidad({ negocioId }: { negocioId: string }) {
  const { t } = useT();
  const [dias, setDias] = useState(30);
  const [data, setData] = useState<RentabilidadData | null>(null);
  useEffect(() => {
    api.get<RentabilidadData>(`/negocios/${negocioId}/rentabilidad?dias=${dias}`).then(setData).catch(() => {});
  }, [negocioId, dias]);
  if (!data) return null;
  return (
    <div className="card">
      <div className="row spread">
        <h2>{t("profit.title")}</h2>
        <select value={dias} onChange={(e) => setDias(Number(e.target.value))}>
          <option value={7}>{t("profit.last7")}</option>
          <option value={30}>{t("profit.last30")}</option>
          <option value={90}>{t("profit.last90")}</option>
        </select>
      </div>
      <div className="grid grid-2" style={{ marginTop: 8 }}>
        <Stat label={t("profit.income")} value={`$${data.ingresoTotal.toFixed(2)}`} icon="💰" />
        <Stat label={t("profit.margin")} value={`$${data.margenTotal.toFixed(2)}`} icon="📈" variant="green" />
      </div>
      {data.ingresoSinCosto > 0 && (
        <p className="muted small" style={{ marginTop: 8 }}>
          {t("profit.noCostWarning")} ${data.ingresoSinCosto.toFixed(2)}
        </p>
      )}
      {data.productos.length > 0 ? (
        <div style={{ marginTop: 12 }}>
          <h3>{t("profit.byProduct")}</h3>
          {data.productos.map((p) => (
            <div className="list-item" key={p.nombre}>
              <div>
                <strong>{p.nombre}</strong> {p.tipoProducto === "hardware" && <span className="badge">{t("pos.typeHardware")}</span>}<br />
                <span className="muted small">{p.unidades} {t("profit.units")} · {t("profit.income")}: ${p.ingreso.toFixed(2)}</span>
              </div>
              <strong className={p.margen >= 0 ? "" : "error"}>${p.margen.toFixed(2)}</strong>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted small" style={{ marginTop: 10 }}>{t("profit.empty")}</p>
      )}
    </div>
  );
}

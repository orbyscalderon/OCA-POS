import { useEffect, useState } from "react";
import { api, ApiError, assetUrl, descargarCSV, puedeNegocio, rolNegocioLabel, ROLES_ASIGNABLES, type Negocio, type Perfil, type RolNegocio } from "../api";
import { useT } from "../i18n";
import { Stat } from "./Ui";
import { MapaUbicacion } from "./MapaUbicacion";
import { PrestamosView } from "./PrestamosView";
import { ComercioView } from "./ComercioView";
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

export function AdminView() {
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

  if (negocio) {
    return (
      <div className="container-wide">
        <GestionEquipo negocio={negocio} onVolver={() => setNegocio(null)} />
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
  const url = `${window.location.origin}/tienda/${slug}`;
  const [copiado, setCopiado] = useState(false);
  return (
    <div className="card">
      <h2>{t("admin.storeTitle")}</h2>
      <p className="muted small">{t("admin.storeShare")}</p>
      <div className="row" style={{ marginTop: 8 }}>
        <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
        <button className="ghost" onClick={() => { navigator.clipboard?.writeText(url); setCopiado(true); setTimeout(() => setCopiado(false), 1500); }}>{copiado ? t("admin.copied") : t("admin.copy")}</button>
        <a href={url} target="_blank" rel="noreferrer"><button className="ghost">{t("admin.open")}</button></a>
      </div>
    </div>
  );
}

function GestionEquipo({ negocio, onVolver }: { negocio: Negocio; onVolver: () => void }) {
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
  const esAdmin = puedeNegocio(miRol, "equipo"); // dueño o gerente: gestión de personal y equipo
  // Cobros, suscripción, analítica y datos del negocio siguen siendo SOLO del dueño en el
  // backend (cuentas bancarias, facturación, cancelar plan) — el frontend refleja lo mismo.
  const esDueno = !miRol || miRol === "dueno";
  const [seccionActiva, setSeccionActiva] = useState("");

  // Cada sección se muestra sola en el panel de la derecha (en vez de todo apilado en una
  // sola pantalla larga) — se arma según los mismos permisos/módulos de antes, solo que ahora
  // cada bloque es un destino del menú lateral en lugar de una tarjeta más en la lista.
  const secciones: { key: string; label: string; icon: string; content: React.ReactNode }[] = [];

  if (esAdmin) {
    secciones.push({
      key: "equipo",
      label: t("nav.team"),
      icon: "👥",
      content: (
        <>
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

          <PersonalNegocio negocioId={negocio.id} />
          {/* El "equipo de profesionales" con agenda solo aplica a rubros con citas — un
              comercio minorista como una tienda de vapes no tiene profesionales que reservan. */}
          {modulos.includes("appointments") && <Invitacion negocioId={negocio.id} />}
        </>
      ),
    });
  }

  // Solo "pos" y "agro" tienen el permiso reforzado también en el backend (lib/acceso.ts),
  // así que son los únicos módulos que el personal con rol puede abrir. El resto (préstamos,
  // mesas, taller, clientes) siguen siendo del dueño únicamente en el backend — mostrarlos a
  // personal daría una pantalla que solo falla al guardar, así que quedan reservados a
  // "esDueno" hasta que se refuerce cada uno.
  if (modulos.includes("pos") && (puedeNegocio(miRol, "pos") || puedeNegocio(miRol, "inventario"))) {
    secciones.push({ key: "comercio", label: t("nav.commerce"), icon: "🛒", content: <ComercioView negocio={negocio} miRol={miRol} credit={modulos.includes("credit")} /> });
  }
  if (modulos.includes("agro") && puedeNegocio(miRol, "agro")) {
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
  if (esDueno && modulos.includes("customers")) {
    secciones.push({ key: "clientes", label: t("nav.customers"), icon: "👤", content: <ClientesView negocio={negocio} loyalty={modulos.includes("loyalty")} credit={modulos.includes("credit")} /> });
  }
  if (modulos.includes("storefront") && esAdmin) {
    secciones.push({ key: "tienda", label: t("nav.store"), icon: "🌐", content: <TiendaLink slug={negocio.slug} /> });
  }

  // Contabilidad agrupa lo financiero (compras, gastos, impuestos, analítica) detrás de un PIN
  // aparte del login — así un cajero con sesión iniciada no puede entrar a ver los números.
  if (esDueno) {
    secciones.push({
      key: "contabilidad",
      label: t("nav.accounting"),
      icon: "🔒",
      content: (
        <ContabilidadPanel negocio={negocio}>
          {modulos.includes("purchasing") && <ComprasView negocio={negocio} />}
          {modulos.includes("expenses") && <GastosView negocio={negocio} />}
          {modulos.includes("taxes") && <ImpuestosView negocio={negocio} />}
          <Analitica negocioId={negocio.id} />
        </ContabilidadPanel>
      ),
    });
    secciones.push({
      key: "config",
      label: t("nav.settings"),
      icon: "⚙️",
      content: (
        <>
          <Ubicacion negocio={negocio} />
          <ImagenNegocio negocioId={negocio.id} tipo="cover" />
          <ImagenNegocio negocioId={negocio.id} tipo="logo" />
          {/* Cobrar la fianza de una reserva solo aplica a rubros con citas (barbería, taller,
              veterinaria...) — un comercio minorista como una tienda de vapes no toma reservas. */}
          {modulos.includes("appointments") && <Cobros negocioId={negocio.id} />}
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
        <button className="ghost" onClick={onVolver}>{t("common.back")}</button>
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

  if (!configurado) {
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

// ---------- Personal del negocio (roles funcionales: gerente / cajero / inventario / contador) ----------
interface MiembroFuncional {
  id: string; rol: RolNegocio; activo: boolean;
  usuario: { id: number; nombre: string; email: string; telefono: string };
}

function PersonalNegocio({ negocioId }: { negocioId: string }) {
  const { t } = useT();
  const [miembros, setMiembros] = useState<MiembroFuncional[]>([]);
  const [rolInvitar, setRolInvitar] = useState<(typeof ROLES_ASIGNABLES)[number]["value"]>("cajero");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");

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
      const r = await api.post<{ url: string }>(`/negocios/${negocioId}/invitaciones`, { rol: rolInvitar });
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
        nombre: nuevoNombre, email: nuevoEmail, telefono: nuevoTelefono, password: nuevaClave, rol: rolInvitar,
      });
      setNuevoNombre(""); setNuevoEmail(""); setNuevoTelefono(""); setNuevaClave("");
      cargar();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.error"));
    } finally {
      setCreando(false);
    }
  }

  async function cambiarRol(m: MiembroFuncional, rol: RolNegocio) {
    await api.patch(`/negocios/${negocioId}/miembros/${m.id}`, { rol });
    cargar();
  }

  async function quitar(m: MiembroFuncional) {
    if (!confirm(`${t("admin.removeConfirm")} ${m.usuario.nombre} ${t("admin.removeConfirmSuffix")}`)) return;
    await api.del(`/negocios/${negocioId}/miembros/${m.id}`);
    cargar();
  }

  return (
    <div className="card">
      <h2>{t("admin.staffTitle")}</h2>
      <p className="muted small">{t("admin.staffIntro")}</p>
      {error && <p className="error small">{error}</p>}

      {miembros.map((m) => (
        <div className="list-item" key={m.id}>
          <div><h3>{m.usuario.nombre}</h3><span className="muted small">{m.usuario.email}</span></div>
          <div className="row">
            <select value={m.rol} onChange={(e) => cambiarRol(m, e.target.value as RolNegocio)}>
              {ROLES_ASIGNABLES.map((r) => <option key={r.value} value={r.value}>{t(r.labelKey)}</option>)}
            </select>
            <button className="ghost small" onClick={() => quitar(m)}>{t("admin.remove")}</button>
          </div>
        </div>
      ))}
      {miembros.length === 0 && <p className="muted small">{t("admin.noStaffYet")}</p>}

      {DESKTOP_MODE ? (
        <div style={{ marginTop: 10 }}>
          <div className="grid grid-2">
            <input placeholder={t("staff.name")} value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} />
            <input placeholder={t("staff.phone")} value={nuevoTelefono} onChange={(e) => setNuevoTelefono(e.target.value)} />
            <input placeholder={t("staff.email")} value={nuevoEmail} onChange={(e) => setNuevoEmail(e.target.value)} />
            <input type="password" placeholder={t("staff.password")} value={nuevaClave} onChange={(e) => setNuevaClave(e.target.value)} />
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <select value={rolInvitar} onChange={(e) => setRolInvitar(e.target.value as typeof rolInvitar)}>
              {ROLES_ASIGNABLES.map((r) => <option key={r.value} value={r.value}>{t(r.labelKey)}</option>)}
            </select>
            <button className="primary" disabled={creando} onClick={crearDirecto}>{t("staff.create")}</button>
          </div>
        </div>
      ) : (
        <>
          <div className="row" style={{ marginTop: 10 }}>
            <select value={rolInvitar} onChange={(e) => setRolInvitar(e.target.value as typeof rolInvitar)}>
              {ROLES_ASIGNABLES.map((r) => <option key={r.value} value={r.value}>{t(r.labelKey)}</option>)}
            </select>
            <button className="primary" onClick={invitar}>{t("admin.generateInvite")}</button>
          </div>
          {url && (
            <div className="row" style={{ marginTop: 10 }}>
              <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
              <button className="ghost" onClick={() => navigator.clipboard?.writeText(url)}>{t("admin.copy")}</button>
            </div>
          )}
        </>
      )}
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

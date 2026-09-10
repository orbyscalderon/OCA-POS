import { useState } from "react";
import { api, ApiError, formatPrecio, mapsUrl } from "../api";

interface ProductoResultado { id: string; nombre: string; sku: string | null; categoria: string | null; unidad: string; precioVenta: string | number; stock: string | number }
interface NegocioResultado { id: string; nombreComercial: string; slug: string; categoria?: string; perfil?: string | null; telefonoContacto: string; direccion: string; logoUrl?: string | null }
interface Resultado { negocio: NegocioResultado; productos: ProductoResultado[] }

// Buscador público: el cliente escribe un producto y ve QUIÉN lo tiene disponible ahora
// mismo (negocio, precio, stock) — el mismo catálogo que alimenta el punto de venta de cada
// negocio, así que si se vendió no aparece.
export function Buscador() {
  const [q, setQ] = useState("");
  const [resultados, setResultados] = useState<Resultado[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState("");

  async function buscar(e?: React.FormEvent) {
    e?.preventDefault();
    setError("");
    if (q.trim().length < 2) { setError("Escribe al menos 2 letras."); return; }
    setBuscando(true);
    try {
      const r = await api.get<{ resultados: Resultado[] }>(`/storefront/buscar?q=${encodeURIComponent(q.trim())}`);
      setResultados(r.resultados);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo buscar ahora mismo.");
    } finally {
      setBuscando(false);
    }
  }

  const totalProductos = resultados?.reduce((s, r) => s + r.productos.length, 0) ?? 0;

  return (
    <div className="container" style={{ maxWidth: 780 }}>
      <div className="mkt-hero">
        <h1 className="grad-text">¿Qué estás buscando?</h1>
        <p className="sub">Busca un producto y te decimos quién lo tiene disponible ahora mismo, con precio y stock real.</p>
      </div>

      <form onSubmit={buscar} className="row" style={{ marginTop: 4 }}>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ej: arroz, filtro de aceite, paracetamol…"
          style={{ flex: 1 }}
        />
        <button className="primary" disabled={buscando}>{buscando ? "Buscando…" : "Buscar"}</button>
      </form>
      {error && <p className="error small" style={{ marginTop: 8 }}>{error}</p>}

      {resultados !== null && (
        <div style={{ marginTop: 18 }}>
          {totalProductos === 0 ? (
            <p className="muted">Nadie tiene "{q}" disponible en este momento.</p>
          ) : (
            <p className="muted small">{totalProductos} resultado(s) en {resultados.length} negocio(s).</p>
          )}
          {resultados.map(({ negocio, productos }) => (
            <div className="card" key={negocio.id} style={{ marginTop: 10 }}>
              <div className="row spread">
                <div>
                  <h3 style={{ margin: 0 }}>{negocio.nombreComercial}</h3>
                  <span className="muted small">{negocio.direccion}</span>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <a href={mapsUrl(negocio)} target="_blank" rel="noreferrer"><button className="ghost small">📍 Cómo llegar</button></a>
                  <a href={`https://wa.me/${negocio.telefonoContacto.replace(/\D/g, "")}`} target="_blank" rel="noreferrer"><button className="ghost small">💬 WhatsApp</button></a>
                  <a href={`/tienda/${negocio.slug}`}><button className="ghost small">Ver tienda</button></a>
                </div>
              </div>
              <div style={{ marginTop: 8 }}>
                {productos.map((p) => (
                  <div className="list-item" key={p.id}>
                    <div><strong>{p.nombre}</strong> {p.sku && <span className="muted small">· {p.sku}</span>}</div>
                    <div className="row" style={{ gap: 8 }}>
                      <span className="badge ok">Stock: {Number(p.stock)} {p.unidad}</span>
                      <strong>{formatPrecio(p.precioVenta)}</strong>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

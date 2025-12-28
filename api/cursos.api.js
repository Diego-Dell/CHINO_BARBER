// api/cursos.api.js
import { fetchJSON } from "./http.js";

const BASE = "/api/cursos";

function qs(params = {}) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null) continue;

    if (k === "withStats") {
      const val = v === true || v === 1 || String(v).trim() === "1" ? "1" : "0";
      sp.set(k, val);
      continue;
    }

    const s = String(v).trim();
    if (!s) continue;
    sp.set(k, s);
  }
  const q = sp.toString();
  return q ? `?${q}` : "";
}

function assertId(id) {
  const n = Number(id);
  if (!Number.isFinite(n) || n <= 0) throw new Error("ID inválido");
  return n;
}

function assertPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Payload inválido");
  }
  return payload;
}

// 5.1 Listar cursos
export async function list({ q, estado, instructor_id, limit, offset, withStats } = {}) {
  const query = qs({ q, estado, instructor_id, limit, offset, withStats });
  return fetchJSON(`${BASE}${query}`, { method: "GET" });
}

// 5.2 Obtener por id
export async function getById(id) {
  const safeId = assertId(id);
  return fetchJSON(`${BASE}/${safeId}`, { method: "GET" });
}

// 5.3 Crear curso
export async function create(payload) {
  const body = assertPayload(payload);
  return fetchJSON(`${BASE}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// 5.4 Actualizar curso
export async function update(id, payload) {
  const safeId = assertId(id);
  const body = assertPayload(payload);
  return fetchJSON(`${BASE}/${safeId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// 5.5 Eliminar (soft delete)
export async function remove(id) {
  const safeId = assertId(id);
  return fetchJSON(`${BASE}/${safeId}`, { method: "DELETE" });
}

// 6.1 Ver inscritos del curso
router.get("/", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const estado = String(req.query.estado || "").trim();

    const where = [];
    const params = [];

    if (q) {
      where.push("(c.nombre LIKE ?)");
      params.push(`%${q}%`);
    }
    if (estado) {
      where.push("c.estado = ?");
      params.push(estado);
    }

    const rows = await dbAll(
      `
      SELECT 
        c.*,
        COALESCE(i.nombre, '') AS instructor_nombre,
        (
          SELECT COUNT(*)
          FROM inscripciones x
          WHERE x.curso_id = c.id AND x.estado = 'Activa'
        ) AS inscritos
      FROM cursos c
      LEFT JOIN instructores i ON i.id = c.instructor_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY c.id DESC
      LIMIT 200
      `,
      params
    );

    const out = rows.map((c) => {
      const { fecha_inicio, hora_inicio, duracion } = parseHorarioPorDia(c.horario_por_dia);
      return {
        ...c,
        fecha_inicio,
        hora_inicio,
        duracion: duracion ? toNum(duracion, 0) : 0,
      };
    });

    return res.json(out);
  } catch (err) {
    console.error("[CURSOS][GET]", err);
    return res.status(500).json({ ok: false, error: "Error al listar cursos" });
  }
});


// 6.2 Ver cupo del curso (stats)
export async function getCupo(id) {
  const safeId = assertId(id);
  return fetchJSON(`${BASE}/${safeId}/cupo`, { method: "GET" });
}

// Ejemplo:
// import { list, create, getCupo } from "../../api/cursos.api.js";
// const { data } = await list({ withStats: true });
// await create({ nombre:"Fade Pro", precio:500, cupo:20, instructor_id:2, estado:"Activo" });
// const cupo = await getCupo(3);

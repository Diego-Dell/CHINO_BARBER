// api/index.js
// Barrel file (frontend) para re-exportar todos los módulos API (ESM).
// No contiene lógica ni fetch directo; solo re-exporta.

export * as AuthAPI from "./auth.api.js";
export * as AlumnosAPI from "./alumnos.api.js";
export * as InstructoresAPI from "./instructores.api.js";
export * as CursosAPI from "./cursos.api.js";
export * as InscripcionesAPI from "./inscripciones.api.js";
export * as AsistenciaAPI from "./asistencia.api.js";
export * as PagosAPI from "./pagos.api.js";
export * as EgresosAPI from "./egresos.api.js";
export * as InventarioAPI from "./inventario.api.js";
export * as AgendaAPI from "./agenda.api.js";
export * as ReportesAPI from "./reportes.api.js";
export * as SettingsAPI from "./settings.api.js";

export { fetchJSON } from "./http.js";

// Ejemplo:
// import { AuthAPI, AlumnosAPI } from "../../api/index.js";
// const user = await AuthAPI.me({ silent: true });
// const { data } = await AlumnosAPI.list({ q: "juan" });

/** Fecha negocio Bolivia (UTC-4): equivalente a DATE('now','-4 hours') en SQLite. */
const DATE_HOY_BO = "date('now', '-4 hours')";

module.exports = {
  DATE_HOY_BO,
  /** Expresión: alumno activo por fecha_vencimiento (solo backend). */
  sqlAlumnoEstado: `CASE
    WHEN a.fecha_vencimiento IS NULL OR trim(a.fecha_vencimiento) = '' THEN 'Inactivo'
    WHEN date(a.fecha_vencimiento) >= ${DATE_HOY_BO} THEN 'Activo'
    ELSE 'Inactivo'
  END`,
};

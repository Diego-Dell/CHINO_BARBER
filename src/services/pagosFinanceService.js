/**
 * Cálculos financieros de inscripción (única fuente de verdad en backend).
 */
const { sqlPagoCuentaFinanciera } = require("../lib/pagosSql");

function buildResumenQuery() {
  return `
    SELECT
      i.id AS inscripcion_id,
      COALESCE(
        c.precio_centavos,
        CAST(ROUND(COALESCE(c.precio, 0) * 100) AS INTEGER)
      ) AS precio_centavos,
      COALESCE(SUM(
        CASE WHEN ${sqlPagoCuentaFinanciera("p")}
          THEN COALESCE(p.monto_centavos, CAST(ROUND(p.monto * 100) AS INTEGER))
          ELSE 0 END
      ), 0) AS pagado_centavos
    FROM inscripciones i
    INNER JOIN cursos c ON c.id = i.curso_id
    LEFT JOIN pagos p ON p.inscripcion_id = i.id
    WHERE i.id = ?
    GROUP BY i.id, c.precio_centavos, c.precio
  `;
}

module.exports = {
  buildResumenQuery,
};

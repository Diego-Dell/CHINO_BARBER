function toCentavos(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(Math.round(n * 100));
}

function fromCentavos(centavos) {
  const n = Number(centavos);
  if (!Number.isFinite(n)) return 0;
  return n / 100;
}

module.exports = { toCentavos, fromCentavos };


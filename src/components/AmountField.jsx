import { formatMoney, priceBreakdown } from '../lib/format.js'

/**
 * Monto de un comprobante. Vacío = se usa el calculado con la promo;
 * con un valor = monto corregido (p. ej. pagó de más por ser una rifa benéfica).
 */
export function AmountField({ value, onChange, auto, count, config, label = 'Monto pagado' }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="money-input">
        <span aria-hidden="true">$</span>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={String(auto)}
        />
      </span>
      <span className="field-hint">
        Calculado: <strong>{formatMoney(auto)}</strong> ({priceBreakdown(count, config)}). Dejalo vacío para usar ese
        monto; cambialo si la persona pagó otro valor.
      </span>
    </label>
  )
}

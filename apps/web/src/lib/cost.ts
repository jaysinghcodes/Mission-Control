/**
 * The one cost display for System and Usage. Both pages read GET /usage,
 * which prices every line with config/prices.json, and both format the
 * result here so the numbers and the note always agree.
 *
 * totalCost is the known total. When any model in the period has no price,
 * the API sets priceNote to exactly "Price not set for some models" and the
 * page shows that note next to the known total. When no model is priced the
 * total reads "Price not set". A plain $0.00 means every model is priced or
 * local.
 */

export const PRICE_NOT_SET = 'Price not set'
export const PRICE_NOT_SET_SOME = 'Price not set for some models'

interface PricedRow {
  priceLabel?: string | null
}

export interface CostUsage {
  totalCost?: number | null
  priceLabel?: string | null
  priceNote?: string | null
  providers?: PricedRow[] | Record<string, PricedRow> | null
  groups?: PricedRow[] | null
}

/** One dollar amount. A missing number reads as `missing`. */
export function costText(cost: number | null | undefined, label?: string | null, missing: string = PRICE_NOT_SET): string {
  if (label === PRICE_NOT_SET) return PRICE_NOT_SET
  if (typeof cost !== 'number' || !Number.isFinite(cost)) return missing
  if (cost === 0) return '$0.00'
  if (Math.abs(cost) < 0.01) return `$${cost.toFixed(4)}`
  return `$${cost.toFixed(2)}`
}

function rows(usage: CostUsage): PricedRow[] {
  const providers = usage.providers
  const list = Array.isArray(providers) ? providers : providers ? Object.values(providers) : []
  return [...list, ...(usage.groups ?? [])]
}

/** The note for a period, or null when every model is priced or local. */
export function priceNote(usage: CostUsage | null | undefined): string | null {
  if (!usage) return null
  if (usage.priceNote) return PRICE_NOT_SET_SOME
  if (usage.priceLabel === PRICE_NOT_SET) return PRICE_NOT_SET_SOME
  return rows(usage).some((row) => row.priceLabel === PRICE_NOT_SET) ? PRICE_NOT_SET_SOME : null
}

export interface CostDay {
  totalCost: number
  priceLabel?: string | null
  priceNote?: string | null
}

/**
 * One day of the spend bars, for the chart's accessible label. A day with no
 * priced model reads "Price not set", never $0.00. A day with some unpriced
 * models keeps its known total and says so.
 */
export function dayCostText(day: CostDay): string {
  if (day.priceLabel === PRICE_NOT_SET) return PRICE_NOT_SET
  const text = costText(day.totalCost, null, 'No data')
  return day.priceNote ? `${text}, ${PRICE_NOT_SET_SOME.toLowerCase()}` : text
}

/** The period total and its note, as System and Usage show them. */
export function costSummary(usage: CostUsage | null | undefined): { text: string; note: string | null } {
  if (!usage) return { text: 'No data', note: null }
  return { text: costText(usage.totalCost, usage.priceLabel), note: priceNote(usage) }
}

/**
 * The spend part of the System header: "$1.32 spent today", plus the note
 * when some models have no price. With nothing priced the total reads
 * "Price not set for today", still followed by the note.
 */
export function spendPhrase(cost: { text: string; note: string | null }, periodName: string): string {
  const lead = cost.text === PRICE_NOT_SET ? `${PRICE_NOT_SET} for ${periodName}` : `${cost.text} spent ${periodName}`
  return ` · ${lead}${cost.note ? ` · ${cost.note}` : ''}`
}

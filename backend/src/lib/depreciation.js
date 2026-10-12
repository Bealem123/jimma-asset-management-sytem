/**
 * Straight-line depreciation from the acquisition cost, salvage value and useful life.
 * Returns null when the asset lacks the inputs (cost, acquisition date and useful life).
 */
export function depreciation(asset, asOf = new Date()) {
  const cost = Number(asset.acquisition_cost);
  const life = Number(asset.useful_life_years);
  if (!asset.acquisition_cost || !life || !asset.acquisition_date) return null;
  const salvage = Math.min(Number(asset.salvage_value || 0), cost);
  const start = new Date(`${String(asset.acquisition_date).slice(0, 10)}T00:00:00Z`);
  const years = Math.max(0, (asOf.getTime() - start.getTime()) / (365.25 * 86400000));
  const annual = (cost - salvage) / life;
  const accumulated = Math.min(cost - salvage, annual * years);
  return {
    method: 'STRAIGHT_LINE',
    annual: round(annual),
    years_elapsed: Math.round(years * 100) / 100,
    accumulated: round(accumulated),
    book_value: round(cost - accumulated),
    fully_depreciated: years >= life,
  };
}

const round = (n) => Math.round(n * 100) / 100;

type FractionOptions = {
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
};

const defaultMoneyOptions = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 5,
} satisfies Required<FractionOptions>;

export function formatMoney(value: number, options: FractionOptions = {}) {
  return new Intl.NumberFormat('en-US', {
    ...defaultMoneyOptions,
    ...options,
  }).format(Number.isFinite(value) ? value : 0);
}

export function formatCurrency(value: number, options: FractionOptions = {}) {
  return `$${formatMoney(value, options)}`;
}

export function formatInteger(value: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(
    Number.isFinite(value) ? value : 0,
  );
}

export function formatPercentage(value: number, options: FractionOptions = {}) {
  return `${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
    ...options,
  }).format(Number.isFinite(value) ? value : 0)}%`;
}

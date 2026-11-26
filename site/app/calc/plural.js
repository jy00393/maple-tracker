// The noun that goes with a count: plural(1, 'boss', 'bosses') is 'boss', anything else 'bosses'.
// Pass the number as it is shown (rounded first when the page rounds it), so "1 flame" never reads "1 flames".
export function plural(n, one, many = one + 's') {
  return Number(n) === 1 ? one : many;
}

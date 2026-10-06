/**
 * Сколько USDC кошелька не хватает, чтобы погасить долг в голове вывода.
 *
 * @remarks Вывод при долге гасит его из USDC кошелька (`RepayBuilder` SDK),
 * и при пустом кошельке транзакция откатывалась «for an unknown reason»
 * (TRM-29). Оба числа — WAD: долг протокола и `useDepositableBalance().token`.
 *
 * Баланс, которого ещё нет, — не повод гасить кнопку: молчащий RPC отдаёт
 * нули, и ложная блокировка вывода хуже ревёрта с понятным текстом.
 *
 * @returns недостачу (`> 0n`) или `null`, когда гасить вывод не нужно.
 */
export function repayShortfall(
  debt: bigint | undefined,
  walletToken: bigint | undefined,
): bigint | null {
  if (debt === undefined || debt <= 0n || walletToken === undefined) {
    return null;
  }
  return walletToken < debt ? debt - walletToken : null;
}

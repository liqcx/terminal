import { useState } from "react";

import {
  type HeldFigures,
  holdPreviewStep,
  type PreviewFigures,
  type ShownFigures,
} from "./orderMarginView";

/**
 * {@link holdPreviewStep} вокруг состояния React: цифры стороны переживают
 * перечитывание по новой цене.
 *
 * @remarks Шаг считается в рендере из удержанного состояния и сразу же
 * сохраняет его следующее значение; лишний рендер возможен только на смене
 * удержанных цифр. Без тестов хука (нет testing-library) — проверяется
 * через e2e tier1 (07-trade-gating) и юнит-тестами шага.
 */
export function useHeldPreview(
  key: string,
  fresh: PreviewFigures,
  inFlight: boolean,
  refreshing: boolean,
): ShownFigures {
  const [held, setHeld] = useState<HeldFigures | undefined>(undefined);
  const step = holdPreviewStep(held, key, fresh, inFlight, refreshing);

  // Подстройка состояния в рендере (приём из документации React): эффект с
  // setState дал бы лишний кадр с прежним удержанным значением.
  if (step.held !== held) setHeld(step.held);

  return step.shown;
}

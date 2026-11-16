/**
 * Mirror of the backend's SEVERITY_CONFIG (backend/api/src/config/reports.ts), used ONLY to
 * explain a stored score. The backend computes and stores the score; the frontend never does.
 * SeverityExplanation re-adds the parts and hides the breakdown if they do not match the stored
 * score, so a change on the backend can never make this page show invented numbers.
 */
export const SEVERITY_EXPLAINER = {
  classWeights: { pothole: 1.0, alligator_crack: 0.8, longitudinal_crack: 0.5, transverse_crack: 0.5 } as Readonly<Record<string, number>>,
  unknownClassWeight: 1.0,
  thresholds: { medium: 0.05, high: 0.15 },
} as const;

export function classWeight(className: string): number {
  return SEVERITY_EXPLAINER.classWeights[className] ?? SEVERITY_EXPLAINER.unknownClassWeight;
}

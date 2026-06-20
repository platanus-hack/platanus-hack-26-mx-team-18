export const STATE_CODES = {
  JAL: "JAL",
  SIN: "SIN",
} as const;

export type StateCode = (typeof STATE_CODES)[keyof typeof STATE_CODES];

export const STATES = [
  { code: STATE_CODES.JAL, name: "Jalisco" },
  { code: STATE_CODES.SIN, name: "Sinaloa" },
] as const;

export function getStateName(code: StateCode): string {
  return STATES.find((s) => s.code === code)?.name ?? code;
}

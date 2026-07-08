/** Static demo lines — mirrors packages/vapi/demo-lines.ts for landing pages */
export interface DemoLine {
  areaCode: string;
  number: string;
  label: string;
  states: string[];
}

export const DEMO_LINES: DemoLine[] = [
  { areaCode: "813", number: "+18135180562", label: "Tampa", states: ["FL"] },
  { areaCode: "513", number: "+15138227392", label: "Cincinnati", states: ["OH", "KY"] },
  { areaCode: "405", number: "+14058042346", label: "Oklahoma City", states: ["OK", "TX", "KS"] },
  { areaCode: "209", number: "+12094482258", label: "Central California", states: ["CA", "NV", "AZ"] },
  { areaCode: "228", number: "+12285884642", label: "Gulf Coast", states: ["MS", "LA", "AL"] },
];

export function formatPhoneDisplay(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  const national = digits.length === 11 ? digits.slice(1) : digits;
  if (national.length !== 10) return e164;
  return `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`;
}

export const DEFAULT_DEMO_LINE = DEMO_LINES[0]!;

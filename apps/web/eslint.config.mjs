import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  { ignores: [".next/**", ".next-preview/**", ".next-preview-*/**", ".next-build/**", "node_modules/**", "playwright-report/**", "test-results/**", "public/maplibre/**", "next-env.d.ts"] },
];

export default config;

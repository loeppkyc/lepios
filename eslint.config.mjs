import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts']),
  {
    rules: {
      // Catch accidental debug output in production paths
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-debugger': 'error',

      // TypeScript hygiene — any and ts-ignore require justification
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-ignore': 'allow-with-description',
          'ts-expect-error': 'allow-with-description',
        },
      ],

      // Prefer explicit return types on exported functions
      '@typescript-eslint/explicit-module-boundary-types': 'off',
    },
  },
  {
    // CLI scripts are not Next.js production code — relax console and unused-var rules
    files: ['scripts/**/*.mjs', 'scripts/**/*.js'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  {
    // F22 — Cron-secret auth via shared helper. No inline auth gates in app/api/**.
    // Use requireCronSecret() from @/lib/auth/cron-secret instead of reading
    // process.env.CRON_SECRET directly. Helper itself lives in lib/auth/ so it
    // is exempt by file scope. The notifications-drain-tick forwarding case
    // gets an inline eslint-disable-next-line with a justifying comment.
    files: ['app/api/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "MemberExpression[object.object.name='process'][object.property.name='env'][property.name='CRON_SECRET']",
          message:
            'Use requireCronSecret() from @/lib/auth/cron-secret instead of reading process.env.CRON_SECRET directly. (F22)',
        },
      ],
    },
  },
])

export default eslintConfig

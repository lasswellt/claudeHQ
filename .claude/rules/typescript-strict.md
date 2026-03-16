---
globs: "packages/**/*.ts"
---
# TypeScript Strict Rules

- No `any` types — use `unknown` with type guards if the source type is uncertain
- No `@ts-ignore` or `@ts-expect-error` without an explanatory comment
- Explicit return types on all exported functions
- Proper Zod schema usage: `z.infer<typeof schema>` for type derivation
- No implicit `any` from untyped third-party libraries — add type declarations
- Use `satisfies` for compile-time checks without widening: `const x = {...} satisfies Config`
- Prefer `interface` for object shapes, `type` for unions/intersections

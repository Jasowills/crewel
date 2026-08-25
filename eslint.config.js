import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/", "node_modules/", ".scratch/", ".husky/"] },
  ...tseslint.configs.recommended
);

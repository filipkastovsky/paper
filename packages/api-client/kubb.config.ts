import { defineConfig } from "@kubb/core";
import { pluginClient } from "@kubb/plugin-client";
import { pluginMsw } from "@kubb/plugin-msw";
import { pluginOas } from "@kubb/plugin-oas";
import { pluginReactQuery } from "@kubb/plugin-react-query";
import { pluginTs } from "@kubb/plugin-ts";
import { pluginZod } from "@kubb/plugin-zod";

// All `*.importPath` values are relative to the generated file inside
// packages/api-client/src/{client,hooks}/<file>.ts — so `../../http-client`
// resolves to packages/api-client/http-client.ts (hand-written, kept outside
// `src/` because kubb's `clean: true` wipes the src/ tree on every regen).

export default defineConfig({
  root: ".",
  input: { path: "./openapi.json" },
  output: { path: "./src", clean: true },
  plugins: [
    pluginOas({ validate: true }),
    pluginTs({ output: { path: "types" } }),
    pluginZod({ output: { path: "zod" }, typed: true }),
    pluginClient({
      output: { path: "client" },
      client: "fetch",
      importPath: "../../http-client.ts",
    }),
    pluginReactQuery({
      output: { path: "hooks" },
      client: "fetch",
      importPath: "../../http-client.ts",
      mutation: { methods: ["post", "put", "patch", "delete"] },
    }),
    pluginMsw({ output: { path: "msw" }, handlers: true }),
  ],
});

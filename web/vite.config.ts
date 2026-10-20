import { defineConfig } from "vite";

export default defineConfig({
	// Relative asset paths, so the build also works when hosted under a sub-path.
	base: "./",
	build: { target: "es2022" },
});

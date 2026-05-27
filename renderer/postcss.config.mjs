/** @type {import('postcss-load-config').Config} */
const config = {
  plugins: {
    // Explicit path — Tailwind's auto-discovery sometimes misses the
    // config when Next.js is invoked from the project root with
    // `next dev renderer` (cwd vs project-dir mismatch).
    tailwindcss: { config: './tailwind.config.js' },
    autoprefixer: {},
  },
};

export default config;

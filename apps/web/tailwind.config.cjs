const werfPreset = require('@werf/ui/tailwind');

/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [werfPreset],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
};

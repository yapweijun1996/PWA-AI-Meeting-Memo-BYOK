import preferences from "../../../src/appearance-preferences.json" with { type: "json" };
export const paletteChoices = Object.keys(preferences.palette.options);

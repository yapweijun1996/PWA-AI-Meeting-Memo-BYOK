import type { Plugin } from "vite";

export function readBrowserChromeColors(css: string): { light: string; dark: string };
export function browserChromePlugin(): Plugin;

export function createAppearanceBootstrap(
  colors: {light: string; dark: string},
  preferences: {theme: {key: string; default: string; values: string[]}; palette: {key: string; default: string; values: string[]}},
): string;

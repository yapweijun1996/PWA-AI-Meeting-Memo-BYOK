import type { Plugin } from "vite";

export function readBrowserChromeColors(css: string): { light: string; dark: string };
export function browserChromePlugin(): Plugin;

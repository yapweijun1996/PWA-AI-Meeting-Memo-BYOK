import { readFileSync } from "node:fs";
import { parse } from "postcss";
import { expect, it } from "vitest";

it("hides the topbar language value at the desktop breakpoint and on small phones", () => {
  const sheet = parse(readFileSync("src/components/ChoiceMenu.css", "utf8"));
  const hiddenAt: string[] = [];
  sheet.walkAtRules("media", media => {
    media.walkRules(".topbar-language .choice-menu-value", rule => {
      rule.walkDecls("display", declaration => {
        if (declaration.value === "none") hiddenAt.push(...media.params.split(",").map(query => query.trim()));
      });
    });
  });

  expect(hiddenAt.sort()).toEqual(["(max-width: 600px)", "(min-width: 761px)"]);
});

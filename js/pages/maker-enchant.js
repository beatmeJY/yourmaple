import { render as renderMaker } from "./maker.js";

export async function render(root) {
  await renderMaker(root, "enchant");
}
